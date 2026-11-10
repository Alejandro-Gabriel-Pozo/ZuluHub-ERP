import { randomUUID } from "node:crypto";
import pg from "pg";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA, type ReglasDeEmpresa } from "../../src/capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import {
  crearCasosDeUsoDeStock,
  crearConsultasDeStock,
  crearPuertosDeStock,
  crearRepositoriosDeStock,
  type RepositoriosDeStock,
} from "../../src/modulos/stock/publico";
import { huellaDeComando } from "../../src/modulos/stock/dominio/huella";
import { agotadaEnElResultado, repetirSiAgotada } from "./concurrencia-apoyo";
import { articuloDeBase, depositoDeBase, escribirMovimiento, existenciaDe } from "./stock-apoyo";
import {
  personaId,
  sucursalId,
  type EmpresaId,
  type PersonaId,
  type SucursalId,
} from "../../src/primitivas/identificadores/marca";
import { ok } from "../../src/primitivas/resultado/resultado";
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

/**
 * Apoyo de las pruebas de integración de los casos de uso de stock (E5): las dependencias REALES sobre una base propia (SERIALIZABLE aborta por
 * falsos positivos cuando otros archivos escriben las mismas tablas), con el módulo `stock` ACTIVO para la empresa de prueba (el módulo real
 * está `en_desarrollo`: se inyectan `reglas` con `stock` disponible y la autorización suma el módulo a los activados; el ROL y el ALCANCE salen
 * de la base, como siempre). Lo que se prueba pasa por el rol real de la aplicación y por los casos de uso; el SQL del dueño solo arma el
 * escenario.
 */

const REGLAS_DE_PRUEBA: ReglasDeEmpresa = {
  catalogo: {
    ...CATALOGO_DE_MODULOS,
    catalogo: { ...CATALOGO_DE_MODULOS.catalogo, estado: "disponible" },
    stock: { ...CATALOGO_DE_MODULOS.stock, estado: "disponible" },
  },
  permisos: PERMISOS_DE_EMPRESA,
};

export type EscenarioDeStock = Readonly<{
  empresa: string;
  empresaId: EmpresaId;
  /** La sucursal que trae la empresa de prueba («Casa central») y otra más («Norte»). */
  sucursal: SucursalId;
  otraSucursal: SucursalId;
  gerente: ContextoOperativo;
  administrador: ContextoOperativo;
  /** Un administrador cuyo alcance se FIJA en «Casa central» (`alcances`): hoy el rol administrador tiene TODAS. */
  administradorDeUnaSucursal: ContextoOperativo;
  /** Asignado a «Casa central»: no maneja depósitos (la matriz lo dice) y solo ve lo de su sucursal. */
  operador: ContextoOperativo;
  personaDelGerente: PersonaId;
}>;

type TxDePruebaConStock = TxDePrueba & RepositoriosDeStock;

export async function montarStock(
  base: BaseDePruebas,
  opciones: Readonly<{ reglas?: ReglasDeEmpresa; conexiones?: number }> = {},
) {
  const propia = await crearBaseAparte(base);
  /** El alcance de sucursales que la base le da a cada rol (TODAS a gerente y administrador); una prueba lo fija acá para el restringido. */
  const alcances = new Map<string, readonly SucursalId[]>();
  /** Módulos que la autorización deja de sumar (para probar el módulo apagado). */
  const sinModulos = new Set<string>();
  /** Perillas que los derechos de uso muestran ENCENDIDAS (el plan de las pruebas no las enciende: ninguna empresa tiene extras). */
  const perillasEncendidas = new Set<string>();
  /** La barrera de la ronda en curso: cada transacción espera tras leer su autorización hasta que llegaron todas. */
  let barrera: () => Promise<void> = () => Promise.resolve();
  const entorno = crearEntornoDePrueba(propia.base, opciones.conexiones ?? 12, (tx) => {
    let primera = true;
    return {
      ...tx,
      ...crearRepositoriosDeStock(tx.db),
      derechos: {
        ...tx.derechos,
        deLaEmpresa: async (contexto) => {
          const reales = await tx.derechos.deLaEmpresa(contexto);
          if (perillasEncendidas.size === 0) return reales;
          return {
            ...reales,
            perillas: new Map(
              [...reales.perillas].map(([perilla, valor]) => [
                perilla,
                perillasEncendidas.has(perilla) && valor.tipo === "INTERRUPTOR"
                  ? { ...valor, encendida: true }
                  : valor,
              ]),
            ),
          };
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
          const sumados = ["catalogo", "stock"].filter((m) => !sinModulos.has(m));
          return {
            ...datos,
            modulosActivados: [...datos.modulosActivados, ...sumados],
            modulosHabilitados: [...datos.modulosHabilitados, ...sumados],
          };
        },
      },
    };
  }) as unknown as TransaccionesDePostgres<TxDePruebaConStock>;
  const dueno = new pg.Client({ connectionString: propia.base.dueno });
  await dueno.connect();
  const reglas = opciones.reglas ?? REGLAS_DE_PRUEBA;
  const casos = crearCasosDeUsoDeStock({ transacciones: entorno, reglas });
  /** Los puertos de stock tal como los recibiría ventas de la composición (T12), y la transacción del llamador sobre la que corren. */
  const puertos = crearPuertosDeStock({ reglas });
  const consultas = crearConsultasDeStock({
    transacciones: entorno,
    reglas,
  });

  const miembro = async (empresa: string, rol: RolDePrueba) => {
    const p = await crearPersonaDeBase(dueno);
    await crearMembresiaDeBase(dueno, empresa, p.id, rol);
    return p.id;
  };

  const escenario = async (): Promise<EscenarioDeStock> => {
    const e = await crearEmpresaActiva(entorno);
    const sucursal = sucursalId(await sucursalDe(dueno, e.empresa));
    const { rows } = await dueno.query<{ id: string }>(
      "insert into sucursal (empresa_id, nombre) values ($1, 'Norte') returning id",
      [e.empresa],
    );
    const otraSucursal = sucursalId(rows[0]?.id as string);
    const gerente = personaId(await miembro(e.empresa, "GERENTE"));
    const administrador = personaId(await miembro(e.empresa, "ADMINISTRADOR"));
    const unico = personaId(await miembro(e.empresa, "ADMINISTRADOR"));
    await crearAsignacionDeBase(dueno, e.empresa, unico, sucursal);
    alcances.set(unico, [sucursal]);
    const operador = personaId(await miembro(e.empresa, "OPERADOR"));
    await crearAsignacionDeBase(dueno, e.empresa, operador, sucursal);
    return {
      empresa: e.empresa,
      empresaId: e.empresa,
      sucursal,
      otraSucursal,
      gerente: comoEmpresa(e.empresa, gerente),
      administrador: comoEmpresa(e.empresa, administrador),
      administradorDeUnaSucursal: comoEmpresa(e.empresa, unico),
      operador: comoEmpresa(e.empresa, operador),
      personaDelGerente: gerente,
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
   * Una entrada al libro, escrita con el rol real de la aplicación y los repositorios de stock (lo que hará `registrarEntrada` en T5):
   * es la forma de que un depósito tenga existencia, o de que entre mercadería en medio de otra operación.
   */
  const entrar = async (
    contexto: ContextoOperativo,
    datos: Readonly<{ depositoId: string; articuloId: string; cantidad: string; clave?: string }>,
  ) => {
    const clave = datos.clave ?? `clave-${randomUUID()}`;
    return entorno.ejecutar({ contexto }, async (tx) => {
      // La transacción ya empezó (leyó el depósito) antes de esperar a las demás de su ronda: así dos que se pisan lo hacen de verdad.
      await tx.depositos.obtener(contexto.empresaId, datos.depositoId);
      await barrera();
      const movimiento = await tx.movimientosDeStock.registrar(
        contexto.empresaId,
        {
          clase: "ENTRADA",
          motivo: "COMPRA",
          detalle: null,
          origenTipo: "MANUAL",
          origenId: null,
          depositoId: datos.depositoId,
          accion: "stock.registrar_entrada",
          anulaA: null,
          conteoId: null,
          clave,
          huella: huellaDeComando(
            "entrada",
            [datos.depositoId],
            [[datos.articuloId, datos.cantidad]],
          ),
          hechoEn: contexto.ahora,
          fechaDeNegocio: null,
          registradoPor: contexto.personaId as PersonaId,
        },
        [
          {
            depositoId: datos.depositoId,
            articuloId: datos.articuloId,
            cantidad: datos.cantidad,
            composicionId: null,
            confirmoNegativo: false,
          },
        ],
      );
      return ok(movimiento);
    });
  };

  /** Un depósito de la empresa de prueba armado con SQL del dueño (el escenario, no lo que se prueba). */
  const deposito = (
    e: Pick<EscenarioDeStock, "empresa" | "sucursal">,
    datos: Parameters<typeof depositoDeBase>[2] = {},
  ) => depositoDeBase(dueno, e, datos);
  /** Un producto controlado con su artículo (materia prima en unidades, salvo que se pida otra cosa), armado con SQL del dueño. */
  const articulo = (
    e: Pick<EscenarioDeStock, "empresa">,
    datos: Parameters<typeof articuloDeBase>[2] = {},
  ) => articuloDeBase(dueno, e, datos);
  const existencia = (depositoId: string, articuloId: string) =>
    existenciaDe(dueno, depositoId, articuloId);
  /** El nivel del control `stock.existencia_negativa` de la empresa (o de una sucursal): no admite borrado, así que se cambia con UPSERT. */
  const fijarNivel = async (
    empresa: string,
    nivel: "PERMITIR" | "AVISAR" | "BLOQUEAR",
    sucursal: string | null = null,
  ) => {
    await dueno.query(
      `insert into nivel_de_control (empresa_id, sucursal_id, control, nivel) values ($1, $2, 'stock.existencia_negativa', $3)
       on conflict on constraint nivel_de_control_uk do update set nivel = excluded.nivel`,
      [empresa, sucursal, nivel],
    );
  };

  /**
   * Una salida por venta escrita por SQL del dueño (la escribirá el puerto de ventas, E5-T7): deja un movimiento de otro módulo (origen
   * `EJEMPLAR_DE_TICKET`) para probar lo que depende del origen. Devuelve el id del movimiento.
   */
  const ventaPorSql = async (
    datos: Readonly<{
      empresa: string;
      depositoId: string;
      articuloId: string;
      persona: string;
      ejemplarId?: string;
      /** Positiva: el renglón de una salida resta. */
      cantidad?: string;
    }>,
  ): Promise<{ movimientoId: string; ejemplarId: string }> => {
    const ejemplarId = datos.ejemplarId ?? randomUUID();
    await dueno.query("begin");
    try {
      const escrito = await escribirMovimiento(
        async (texto, parametros) => {
          const r = await dueno.query(texto, parametros);
          return { ok: true, filas: r.rowCount ?? 0, rows: r.rows as Record<string, unknown>[] };
        },
        datos.empresa,
        {
          clase: "SALIDA",
          motivo: "VENTA",
          deposito: datos.depositoId,
          persona: datos.persona,
          accion: "cuentas.cerrar",
          origen: { tipo: "EJEMPLAR_DE_TICKET", id: ejemplarId },
          fechaDeNegocio: "2026-10-11",
          renglones: [{ articulo: datos.articuloId, cantidad: `-${datos.cantidad ?? "1"}` }],
        },
      );
      await dueno.query("commit");
      return { movimientoId: escrito.id, ejemplarId };
    } catch (error) {
      await dueno.query("rollback");
      throw error;
    }
  };

  return {
    propia,
    entorno,
    dueno,
    ventaPorSql,
    deposito,
    articulo,
    existencia,
    fijarNivel,
    alcances,
    armarBarrera: (participantes: number) => {
      barrera = crearBarrera(participantes);
    },
    /** Para el trabajo de una prueba que corre en su propia transacción y tiene que sumarse a la ronda. */
    esperarBarrera: () => barrera(),
    soltarBarrera: () => {
      barrera = () => Promise.resolve();
    },
    /** Apaga un módulo para la autorización (queda «no activo»): el rol y la base siguen igual. */
    apagarModulo: (modulo: "stock" | "catalogo") => {
      sinModulos.add(modulo);
    },
    encenderModulos: () => {
      sinModulos.clear();
    },
    casos,
    consultas,
    puertos,
    encenderPerilla: (perilla: "composiciones_con_perdida" | "subcomposiciones") => {
      perillasEncendidas.add(perilla);
    },
    apagarPerillas: () => {
      perillasEncendidas.clear();
    },
    escenario,
    filas,
    contar,
    auditoria,
    entrar,
    cerrar: async () => {
      await dueno.end();
      await entorno.cerrar();
      await propia.destruir();
    },
  };
}

export type MontajeDeStock = Awaited<ReturnType<typeof montarStock>>;

/** Un `ok` esperado: si falla, el mensaje dice por qué (los errores son datos, no excepciones). */
export function valorDe<T, E>(r: Readonly<{ ok: true; valor: T } | { ok: false; error: E }>): T {
  if (!r.ok) throw new Error(`se esperaba ok y vino ${JSON.stringify(r.error)}`);
  return r.valor;
}

/** Un id nuevo: lo que manda la pantalla (idempotencia) al crear algo. */
export const nuevoId = (): string => randomUUID();

/** Un nombre al azar de depósito (sin dígitos: la lista de permitidos los admite, pero así no se confunden con un número). */
export const nombreDeDeposito = (prefijo = "Deposito"): string =>
  `${prefijo} ${randomUUID()
    .slice(0, 8)
    .replace(/[0-9]/g, (d) => "abcdefghij"[Number(d)] ?? "x")}`;

/** Las rondas de las pruebas de concurrencia (`PEDERNAL_RONDAS`, 3 por defecto: el CI tiene un tope de tiempo ajustado). */
export const RONDAS = (() => {
  const crudo = process.env["PEDERNAL_RONDAS"];
  const n = crudo === undefined ? 3 : Number(crudo);
  return Number.isInteger(n) && n >= 1 ? n : 3;
})();

/** El pedido se repite si pierde por agotamiento de reintentos: es el mismo pedido, seguro por su identidad (clave o id). */
export const firme = <R extends { readonly ok: boolean }>(trabajo: () => Promise<R>) =>
  repetirSiAgotada(trabajo, { esAgotada: (r) => agotadaEnElResultado(r as never) });

/** Pedidos a la vez, con la barrera armada: todos leyeron su autorización antes de que cualquiera escriba. Se alterna cuál sale primero. */
export async function aLaVez<T>(
  c: MontajeDeStock,
  pedidos: ReadonlyArray<() => Promise<T>>,
  ronda: number,
): Promise<T[]> {
  c.armarBarrera(pedidos.length);
  try {
    const orden = ronda % 2 === 0 ? [...pedidos] : [...pedidos].reverse();
    return await Promise.all(orden.map((p) => p()));
  } finally {
    c.soltarBarrera();
  }
}

/** Cuántos resultados fueron `ok`. */
export const soloOk = <R extends { readonly ok: boolean }>(resultados: readonly R[]): number =>
  resultados.filter((r) => r.ok).length;
