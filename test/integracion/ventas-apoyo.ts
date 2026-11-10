import { randomUUID } from "node:crypto";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA, type ReglasDeEmpresa } from "../../src/capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import { crearCasosDeUsoDeCaja } from "../../src/modulos/caja/publico";
import { crearCasosDeUsoDeCierre, crearConsultasDeCierre } from "../../src/modulos/cierre/publico";
import {
  aporteDeVentas,
  crearCasosDeUsoDeVentas,
  crearConsultasDeVentas,
} from "../../src/modulos/ventas/publico";
import { sucursalId, type SucursalId } from "../../src/primitivas/identificadores/marca";
import {
  comoEmpresa,
  crearBarrera,
  crearBaseAparte,
  crearEmpresaActiva,
  crearEntornoDePrueba,
} from "./entorno";
import { opcionDeBase, grupoDeBase, precioDeBase, productoDeBase } from "./catalogo-apoyo";
import {
  crearAsignacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
  sucursalDe,
  type RolDePrueba,
} from "./fixtures-identidad";
import type { BaseDePruebas } from "./global";
import pg from "pg";
import { personaId } from "../../src/primitivas/identificadores/marca";

/**
 * Apoyo de las pruebas de integración de ventas (E4 fase A): una base propia, el entorno con `catalogo`, `ventas` y `cierre` ACTIVOS para
 * la empresa (los módulos reales están en desarrollo: se inyectan `reglas` con ventas y catálogo disponibles y la autorización suma los
 * módulos; el ROL y el ALCANCE salen de la base, como siempre), los casos de uso y consultas de ventas, los del cierre con el aporte de
 * ventas registrado, y atajos del dueño de la base (que evade RLS) solo para armar el escenario. Lo que se prueba pasa por el rol real.
 */
const AHORA = "2026-11-09T15:00:00Z"; // 12:00 en Argentina: jornada del 2026-11-09
export const FECHA_DE_NEGOCIO = "2026-11-09";

const REGLAS_DE_PRUEBA: ReglasDeEmpresa = {
  catalogo: {
    ...CATALOGO_DE_MODULOS,
    catalogo: { ...CATALOGO_DE_MODULOS.catalogo, estado: "disponible" },
    caja: { ...CATALOGO_DE_MODULOS.caja, estado: "disponible" },
    ventas: { ...CATALOGO_DE_MODULOS.ventas, estado: "disponible" },
  },
  permisos: PERMISOS_DE_EMPRESA,
};

export type EscenarioDeVentas = Readonly<{
  empresa: string;
  sucursal: SucursalId;
  otraSucursal: SucursalId;
  gerente: ContextoOperativo;
  administrador: ContextoOperativo;
  /** Un operador asignado SOLO a la sucursal principal. */
  operador: ContextoOperativo;
  personaDelOperador: string;
  /** Un producto vendible a $1000 sin variante ni opciones, con precio de la empresa. */
  producto: string;
}>;

export async function montarVentas(
  base: BaseDePruebas,
  opciones: Readonly<{ conexiones?: number }> = {},
) {
  const propia = await crearBaseAparte(base);
  let barrera: () => Promise<void> = () => Promise.resolve();
  const entorno = crearEntornoDePrueba(propia.base, opciones.conexiones ?? 12, (tx) => {
    let primera = true;
    return {
      ...tx,
      autorizacion: {
        ...tx.autorizacion,
        delActor: async (contexto) => {
          const datos = await tx.autorizacion.delActor(contexto);
          if (primera) {
            primera = false;
            await barrera();
          }
          return datos.rol === null
            ? datos
            : {
                ...datos,
                modulosActivados: [
                  ...datos.modulosActivados,
                  "catalogo",
                  "ventas",
                  "cierre",
                  "caja",
                ],
                modulosHabilitados: [
                  ...datos.modulosHabilitados,
                  "catalogo",
                  "ventas",
                  "cierre",
                  "caja",
                ],
              };
        },
      },
    };
  });
  const dueno = new pg.Client({ connectionString: propia.base.dueno });
  await dueno.connect();
  const reglas = REGLAS_DE_PRUEBA;
  const casos = crearCasosDeUsoDeVentas({ transacciones: entorno, reglas });
  const consultas = crearConsultasDeVentas({ transacciones: entorno, reglas });
  const caja = crearCasosDeUsoDeCaja({ transacciones: entorno, reglas });
  const cierre = crearCasosDeUsoDeCierre({
    transacciones: entorno,
    reglas,
    aportes: [aporteDeVentas],
  });
  const consultasDeCierre = crearConsultasDeCierre({
    transacciones: entorno,
    reglas,
    aportes: [aporteDeVentas],
  });

  const miembro = async (empresa: string, rol: RolDePrueba) => {
    const p = await crearPersonaDeBase(dueno);
    await crearMembresiaDeBase(dueno, empresa, p.id, rol);
    return p.id;
  };

  /** Un producto vendible con precio de la empresa (vigente desde antes de `AHORA`). */
  const productoVendible = async (
    empresa: string,
    precio: string | null,
    datos: Parameters<typeof productoDeBase>[2] = {},
  ) => {
    const id = await productoDeBase(dueno, empresa, datos);
    await precioDeBase(dueno, { empresa, producto: id, precio, desde: "2026-01-01T00:00:00Z" });
    return id;
  };

  const escenario = async (): Promise<EscenarioDeVentas> => {
    const e = await crearEmpresaActiva(entorno);
    const sucursal = sucursalId(await sucursalDe(dueno, e.empresa));
    const { rows } = await dueno.query<{ id: string }>(
      "insert into sucursal (empresa_id, nombre) values ($1, 'Norte') returning id",
      [e.empresa],
    );
    const otra = sucursalId(rows[0]?.id as string);
    const gerente = personaId(await miembro(e.empresa, "GERENTE"));
    const administrador = personaId(await miembro(e.empresa, "ADMINISTRADOR"));
    const operador = personaId(await miembro(e.empresa, "OPERADOR"));
    await crearAsignacionDeBase(dueno, e.empresa, operador, sucursal);
    const ahora = new Date(AHORA);
    return {
      empresa: e.empresa,
      sucursal,
      otraSucursal: otra,
      gerente: { ...comoEmpresa(e.empresa, gerente), ahora },
      administrador: { ...comoEmpresa(e.empresa, administrador), ahora },
      operador: { ...comoEmpresa(e.empresa, operador), ahora },
      personaDelOperador: operador,
      producto: await productoVendible(e.empresa, "1000"),
    };
  };

  /**
   * Una caja con sesión ABIERTA en la sucursal (la apertura es el caso de uso real de caja: jornada, sesión y fondo) y los medios de la empresa.
   * Con la hora de `contexto.ahora` fija la jornada de la sesión.
   */
  const cajaAbierta = async (
    e: EscenarioDeVentas,
    opciones: Readonly<{
      sucursal?: SucursalId;
      contexto?: ContextoOperativo;
      fondo?: string;
    }> = {},
  ) => {
    const sucursal = opciones.sucursal ?? e.sucursal;
    const { rows } = await dueno.query<{ id: string }>(
      "insert into caja (empresa_id, sucursal_id, nombre) values ($1, $2, $3) returning id",
      [e.empresa, sucursal, `Caja ${randomUUID().slice(0, 8)}`],
    );
    const cajaId = rows[0]?.id as string;
    const medios: Record<string, string> = {};
    for (const tipo of ["EFECTIVO", "TARJETA_DEBITO", "TRANSFERENCIA", "QR"]) {
      await dueno.query(
        "insert into medio_de_pago (empresa_id, tipo) values ($1, $2) on conflict do nothing",
        [e.empresa, tipo],
      );
      medios[tipo] = (
        await dueno.query<{ id: string }>(
          "select id from medio_de_pago where empresa_id = $1 and tipo = $2 and nombre is null",
          [e.empresa, tipo],
        )
      ).rows[0]?.id as string;
    }
    const sesion = valorDe(
      await caja.abrirSesion(opciones.contexto ?? e.gerente, {
        claveDeIdempotencia: nuevaClave(),
        sucursalId: sucursal,
        cajaId,
        fondoInicial: { moneda: "ARS", monto: opciones.fondo ?? "0.00" },
      }),
    );
    return { cajaId, sesionId: sesion.sesionId, fechaDeNegocio: sesion.fechaDeNegocio, medios };
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

  return {
    propia,
    entorno,
    dueno,
    casos,
    consultas,
    caja,
    cajaAbierta,
    cierre,
    consultasDeCierre,
    escenario,
    productoVendible,
    grupoDeBase: (empresa: string, producto: string, datos?: Parameters<typeof grupoDeBase>[3]) =>
      grupoDeBase(dueno, empresa, producto, datos),
    opcionDeBase: (
      empresa: string,
      producto: string,
      grupo: string,
      datos?: Parameters<typeof opcionDeBase>[4],
    ) => opcionDeBase(dueno, empresa, producto, grupo, datos),
    precio: (datos: Parameters<typeof precioDeBase>[1]) => precioDeBase(dueno, datos),
    filas,
    contar,
    auditoria,
    armarBarrera: (participantes: number) => {
      barrera = crearBarrera(participantes);
    },
    soltarBarrera: () => {
      barrera = () => Promise.resolve();
    },
    cerrar: async () => {
      await dueno.end();
      await entorno.cerrar();
      await propia.destruir();
    },
  };
}

export type MundoDeVentas = Awaited<ReturnType<typeof montarVentas>>;

/** Un `ok` esperado: si falla, el mensaje dice por qué (los errores son datos, no excepciones). */
export function valorDe<T, E>(r: Readonly<{ ok: true; valor: T } | { ok: false; error: E }>): T {
  if (!r.ok) throw new Error(`se esperaba ok y vino ${JSON.stringify(r.error)}`);
  return r.valor;
}

/** Un id nuevo: lo que manda la pantalla (idempotencia) al crear algo. */
export const nuevoId = (): string => randomUUID();
export const nuevaClave = (): string => `clave-${randomUUID()}`;

/** Abre una cuenta y le agrega una línea del producto (atajo de las pruebas). */
export async function cuentaConLinea(
  m: MundoDeVentas,
  e: EscenarioDeVentas,
  contexto: ContextoOperativo = e.gerente,
  cantidad = "1",
) {
  const cuenta = nuevoId();
  valorDe(await m.casos.abrirCuenta(contexto, { cuentaId: cuenta, sucursalId: e.sucursal }));
  const linea = nuevoId();
  valorDe(
    await m.casos.agregarLinea(contexto, {
      cuentaId: cuenta,
      lineaId: linea,
      productoId: e.producto,
      opcionIds: [],
      cantidad,
    }),
  );
  return { cuenta, linea };
}
