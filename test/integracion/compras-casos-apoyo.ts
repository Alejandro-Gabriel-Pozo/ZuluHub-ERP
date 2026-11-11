import { randomUUID } from "node:crypto";
import pg from "pg";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA, type ReglasDeEmpresa } from "../../src/capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import { crearEgresoDeCaja } from "../../src/composicion/egreso-de-caja";
import { crearCasosDeUsoDeCaja } from "../../src/modulos/caja/publico";
import { crearCasosDeUsoDeCatalogo } from "../../src/modulos/catalogo/publico";
import {
  crearCasosDeUsoDeClientes,
  crearRepositoriosDeClientes,
  type RepositoriosDeClientes,
} from "../../src/modulos/clientes/publico";
import {
  crearCasosDeUsoDeCompras,
  crearConsultasDeCompras,
  crearRepositoriosDeCompras,
  type RepositoriosDeCompras,
} from "../../src/modulos/compras/publico";
import {
  crearCasosDeUsoDeStock,
  crearPuertosDeStock,
  crearRepositoriosDeStock,
  type RepositoriosDeStock,
} from "../../src/modulos/stock/publico";
import {
  personaId,
  sucursalId,
  type EmpresaId,
  type PersonaId,
  type SucursalId,
} from "../../src/primitivas/identificadores/marca";
import { productoDeBase, type ClaseDeUsoDePrueba } from "./catalogo-apoyo";
import {
  comoEmpresa,
  crearBarrera,
  crearBaseAparte,
  crearEmpresaActiva,
  crearEntornoDePrueba,
  type TxDePrueba,
} from "./entorno";
import {
  crearAsignacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
  sucursalDe,
  type RolDePrueba,
} from "./fixtures-identidad";
import type { BaseDePruebas } from "./global";
import { articuloDeBase, depositoDeBase, existenciaDe } from "./stock-apoyo";

/**
 * Apoyo de las pruebas de integración de los casos de uso de compras (E9): las dependencias REALES sobre una base propia (SERIALIZABLE aborta por falsos
 * positivos cuando otros archivos escriben las mismas tablas), con los módulos `catalogo`, `stock` y `compras` ACTIVOS para la empresa de prueba (el módulo
 * `compras` real está `en_desarrollo` hasta T12: se inyectan `reglas` con `compras` disponible y la autorización suma los módulos; el ROL y el ALCANCE salen
 * de la base, como siempre). Lo que se prueba pasa por el rol real de la aplicación y por los casos de uso; el SQL del dueño solo arma el escenario.
 */

const REGLAS_DE_PRUEBA: ReglasDeEmpresa = {
  catalogo: {
    ...CATALOGO_DE_MODULOS,
    catalogo: { ...CATALOGO_DE_MODULOS.catalogo, estado: "disponible" },
    stock: { ...CATALOGO_DE_MODULOS.stock, estado: "disponible" },
    compras: { ...CATALOGO_DE_MODULOS.compras, estado: "disponible" },
    caja: { ...CATALOGO_DE_MODULOS.caja, estado: "disponible" },
  },
  permisos: PERMISOS_DE_EMPRESA,
};

export type EscenarioDeCompras = Readonly<{
  empresa: string;
  empresaId: EmpresaId;
  /** La sucursal que trae la empresa de prueba («Casa central») y otra más («Norte»). */
  sucursal: SucursalId;
  otraSucursal: SucursalId;
  gerente: ContextoOperativo;
  administrador: ContextoOperativo;
  /** Asignado a «Casa central»: carga compras y facturas, no paga ni anula. */
  operador: ContextoOperativo;
  personaDelGerente: PersonaId;
  personaDelOperador: PersonaId;
}>;

type TxDePruebaConCompras = TxDePrueba &
  RepositoriosDeStock &
  RepositoriosDeClientes &
  RepositoriosDeCompras;

export async function montarCompras(
  base: BaseDePruebas,
  opciones: Readonly<{ reglas?: ReglasDeEmpresa; conexiones?: number }> = {},
) {
  const propia = await crearBaseAparte(base);
  /** El alcance de sucursales que la base le da a cada rol (TODAS a gerente y administrador); una prueba lo fija acá. */
  const alcances = new Map<string, readonly SucursalId[]>();
  /** Módulos que la autorización deja de sumar (para probar el módulo apagado). */
  const sinModulos = new Set<string>();
  /** La barrera de la ronda en curso: cada transacción espera tras leer su autorización hasta que llegaron todas. */
  let barrera: () => Promise<void> = () => Promise.resolve();
  /** Una falla inyectada en un punto de «Comprar y recibir» (para probar que no queda nada a medias). */
  let falla: "oferta" | "lineas" | null = null;
  const entorno = crearEntornoDePrueba(propia.base, opciones.conexiones ?? 12, (tx) => {
    let primera = true;
    const repos = crearRepositoriosDeCompras(tx.db);
    return {
      ...tx,
      ...crearRepositoriosDeStock(tx.db),
      ...crearRepositoriosDeClientes(tx.db),
      ...repos,
      ofertasDeProveedor: {
        ...repos.ofertasDeProveedor,
        registrar: (...argumentos: Parameters<typeof repos.ofertasDeProveedor.registrar>) => {
          if (falla === "oferta") throw new Error("falla inyectada en la oferta");
          return repos.ofertasDeProveedor.registrar(...argumentos);
        },
      },
      recepciones: {
        ...repos.recepciones,
        insertarLineas: (...argumentos: Parameters<typeof repos.recepciones.insertarLineas>) => {
          if (falla === "lineas") throw new Error("falla inyectada en las líneas");
          return repos.recepciones.insertarLineas(...argumentos);
        },
      },
      autorizacion: {
        ...tx.autorizacion,
        sucursalesDelActor: async (contexto, opcionesDeAlcance) => {
          const fijado = contexto.personaId === null ? undefined : alcances.get(contexto.personaId);
          return fijado ?? tx.autorizacion.sucursalesDelActor(contexto, opcionesDeAlcance);
        },
        delActor: async (contexto) => {
          const datos = await tx.autorizacion.delActor(contexto);
          if (primera) {
            primera = false;
            await barrera();
          }
          if (datos.rol === null) return datos;
          const sumados = ["catalogo", "stock", "compras", "caja"].filter(
            (m) => !sinModulos.has(m),
          );
          return {
            ...datos,
            modulosActivados: [...datos.modulosActivados, ...sumados],
            modulosHabilitados: [...datos.modulosHabilitados, ...sumados],
          };
        },
      },
    };
  }) as unknown as TransaccionesDePostgres<TxDePruebaConCompras>;
  const dueno = new pg.Client({ connectionString: propia.base.dueno });
  await dueno.connect();
  const reglas = opciones.reglas ?? REGLAS_DE_PRUEBA;
  const casos = crearCasosDeUsoDeCompras({
    transacciones: entorno,
    reglas,
    stock: crearPuertosDeStock({ reglas }),
    egresoDeCaja: crearEgresoDeCaja(),
  });
  const consultas = crearConsultasDeCompras({ transacciones: entorno, reglas });
  const clientes = crearCasosDeUsoDeClientes({ transacciones: entorno, reglas });
  const catalogoCasos = crearCasosDeUsoDeCatalogo({ transacciones: entorno, reglas });
  const stockCasos = crearCasosDeUsoDeStock({ transacciones: entorno, reglas });
  const cajaCasos = crearCasosDeUsoDeCaja({
    transacciones: entorno,
    reglas,
  });

  const miembro = async (empresa: string, rol: RolDePrueba) => {
    const p = await crearPersonaDeBase(dueno);
    await crearMembresiaDeBase(dueno, empresa, p.id, rol);
    return p.id;
  };

  const escenario = async (): Promise<EscenarioDeCompras> => {
    const e = await crearEmpresaActiva(entorno);
    const sucursal = sucursalId(await sucursalDe(dueno, e.empresa));
    const { rows } = await dueno.query<{ id: string }>(
      "insert into sucursal (empresa_id, nombre) values ($1, 'Norte') returning id",
      [e.empresa],
    );
    const otraSucursal = sucursalId(rows[0]?.id as string);
    const gerente = personaId(await miembro(e.empresa, "GERENTE"));
    const administrador = personaId(await miembro(e.empresa, "ADMINISTRADOR"));
    const operador = personaId(await miembro(e.empresa, "OPERADOR"));
    await crearAsignacionDeBase(dueno, e.empresa, operador, sucursal);
    return {
      empresa: e.empresa,
      empresaId: e.empresa,
      sucursal,
      otraSucursal,
      gerente: comoEmpresa(e.empresa, gerente),
      administrador: comoEmpresa(e.empresa, administrador),
      operador: comoEmpresa(e.empresa, operador),
      personaDelGerente: gerente,
      personaDelOperador: operador,
    };
  };

  const filas = async <T extends Record<string, unknown> = Record<string, unknown>>(
    texto: string,
    p: unknown[] = [],
  ) => (await dueno.query<T>(texto, p)).rows;
  const contar = async (texto: string, p: unknown[] = []) =>
    Number((await filas<{ n: string }>(texto, p))[0]?.n);
  const auditoria = (empresa: string, accion?: string) =>
    filas(
      `select accion, actor_persona_id, entidad, entidad_id, antes, despues from auditoria_empresa
        where empresa_id = $1 and ($2::text is null or accion = $2) order by id`,
      [empresa, accion ?? null],
    );

  /**
   * Una caja de la sucursal con el medio efectivo y su sesión ABIERTA (con la jornada y el fondo, por el caso de uso de caja, como lo haría la pantalla):
   * el escenario del pago en efectivo. `cerrarSesion` la deja `CERRADA` por SQL del dueño (solo para probar «caja cerrada»).
   */
  const cajaAbierta = async (
    e: Pick<EscenarioDeCompras, "empresa" | "sucursal" | "gerente">,
    fondo = "1000.00",
  ) => {
    await dueno.query(
      "insert into medio_de_pago (empresa_id, tipo) values ($1, 'EFECTIVO') on conflict do nothing",
      [e.empresa],
    );
    const { rows } = await dueno.query<{ id: string }>(
      "insert into caja (empresa_id, sucursal_id, nombre) values ($1, $2, $3) returning id",
      [e.empresa, e.sucursal, `Caja ${randomUUID().slice(0, 8)}`],
    );
    const cajaId = rows[0]?.id as string;
    const r = await cajaCasos.abrirSesion(e.gerente, {
      claveDeIdempotencia: randomUUID(),
      sucursalId: e.sucursal,
      cajaId,
      fondoInicial: { moneda: "ARS", monto: fondo },
    });
    if (!r.ok) throw new Error(`no se pudo abrir la caja: ${JSON.stringify(r.error)}`);
    return { cajaId, sesionId: r.valor.sesionId };
  };

  /** Un proveedor (empresa con el rol `PROVEEDOR`) dado de alta con el caso de uso del directorio, como lo haría la pantalla. */
  const proveedor = async (
    quien: ContextoOperativo,
    datos: Readonly<Record<string, unknown>> = {},
  ): Promise<string> => {
    const r = await clientes.crearParte(quien, {
      idempotencia: randomUUID(),
      naturaleza: "JURIDICA",
      nombre: `Proveedor ${randomUUID()
        .slice(0, 8)
        .replace(/[0-9]/g, (d) => "abcdefghij"[Number(d)] ?? "x")}`,
      roles: ["PROVEEDOR"],
      ...datos,
    });
    if (!r.ok) throw new Error(`no se pudo crear el proveedor: ${JSON.stringify(r.error)}`);
    return r.valor.parteId;
  };

  /** Un producto de la empresa armado con SQL del dueño (el escenario, no lo que se prueba). */
  const producto = (
    empresa: string,
    datos: Readonly<{ clase?: ClaseDeUsoDePrueba; unidadBase?: string; dimension?: string }> = {},
  ) =>
    productoDeBase(dueno, empresa, {
      clase: datos.clase ?? "MATERIA_PRIMA",
      ...(datos.unidadBase === undefined ? {} : { unidadBase: datos.unidadBase }),
      ...(datos.dimension === undefined ? {} : { dimension: datos.dimension }),
    });
  const deposito = (
    e: Pick<EscenarioDeCompras, "empresa" | "sucursal">,
    datos: Parameters<typeof depositoDeBase>[2] = {},
  ) => depositoDeBase(dueno, e, datos);
  const articulo = (
    e: Pick<EscenarioDeCompras, "empresa">,
    datos: Parameters<typeof articuloDeBase>[2] = {},
  ) => articuloDeBase(dueno, e, datos);
  const existencia = (depositoId: string, articuloId: string) =>
    existenciaDe(dueno, depositoId, articuloId);

  return {
    propia,
    entorno,
    reglas,
    dueno,
    casos,
    consultas,
    clientes,
    catalogoCasos,
    stockCasos,
    cajaCasos,
    cajaAbierta,
    escenario,
    proveedor,
    producto,
    deposito,
    articulo,
    existencia,
    filas,
    contar,
    auditoria,
    alcances,
    inyectarFalla: (punto: "oferta" | "lineas" | null) => {
      falla = punto;
    },
    armarBarrera: (participantes: number) => {
      barrera = crearBarrera(participantes);
    },
    soltarBarrera: () => {
      barrera = () => Promise.resolve();
    },
    /** Apaga un módulo para la autorización (queda «no activo»): el rol y la base siguen igual. */
    apagarModulo: (modulo: "stock" | "catalogo" | "compras") => {
      sinModulos.add(modulo);
    },
    encenderModulo: (modulo: "stock" | "catalogo" | "compras") => {
      sinModulos.delete(modulo);
    },
    cerrar: async () => {
      await dueno.end();
      await entorno.cerrar();
      await propia.destruir();
    },
  };
}

export type MontajeDeCompras = Awaited<ReturnType<typeof montarCompras>>;
