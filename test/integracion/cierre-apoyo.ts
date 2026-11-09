import { sql } from "kysely";
import type pg from "pg";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import {
  crearCasosDeUsoDeCierre,
  crearConsultasDeCierre,
  jornadaDeSucursal,
  type AporteAlCierreDelDia,
  type ControlDelDia,
  type ErrorDeJornadaNoAbierta,
  type ErrorDeJornadaNoEnAuditoria,
  type JornadaRef,
  type ReconocimientoDeControl,
} from "../../src/modulos/cierre/publico";
import {
  personaId,
  sucursalId,
  type EmpresaId,
  type PersonaId,
  type SucursalId,
  type TenantId,
} from "../../src/primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../src/primitivas/resultado/resultado";
import { fechaCivilDesdeTexto, type FechaCivil } from "../../src/primitivas/tiempo/fecha-civil";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import { comoEmpresa, crearEmpresaActiva, type TxDePrueba } from "./entorno";
import {
  crearAsignacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
  sucursalDe,
  type RolDePrueba,
} from "./fixtures-identidad";
import { asignarPlan, crearPlanPublicado } from "./marcas-apoyo";

/**
 * Apoyo de las pruebas de integración del cierre del día (E3b): una empresa con los módulos del plan activados (el guard exige
 * `cierre` activo), su gerente u otro rol, y APORTES FALSOS de los módulos que todavía no existen (caja y ventas son de otras etapas).
 * Los aportes falsos usan nombres de módulos REALES y disponibles del catálogo (`facturacion`) o en desarrollo (`catalogo`): el cierre
 * decide con el catálogo real quién aporta.
 */

export const FECHA = "2026-11-09";
const H = (caracter: string) => caracter.repeat(64);

/** Una fecha de negocio ya validada (las pruebas pasan texto literal). */
function fechaDe(texto: string): FechaCivil {
  const fecha = fechaCivilDesdeTexto(texto);
  if (!fecha.ok) throw new Error(`fecha de prueba inválida: ${texto}`);
  return fecha.valor;
}

export type Mundo = Readonly<{
  tenant: TenantId;
  empresa: EmpresaId;
  sucursal: SucursalId;
  persona: PersonaId;
  /** El contexto operativo de la persona, con el reloj real (las asignaciones de plan nacen vigentes según el reloj de la base). */
  ctx: () => ContextoOperativo;
}>;

export type OpcionesDeMundo = Readonly<{
  rol?: RolDePrueba;
  /** Módulos del plan (el techo). Por defecto, `cierre` y `facturacion`. */
  plan?: readonly string[];
  /** Módulos que la empresa activó. Por defecto, los del plan. */
  activados?: readonly string[];
  /** Solo para el operador: lo asigna a la sucursal de la empresa (por defecto, sin alcance). */
  asignarALaSucursal?: boolean;
}>;

export async function crearMundoDeCierre(
  entorno: TransaccionesDePostgres<TxDePrueba>,
  dueno: pg.Client,
  opciones: OpcionesDeMundo = {},
): Promise<Mundo> {
  const e = await crearEmpresaActiva(entorno);
  const persona = await crearPersonaDeBase(dueno);
  await crearMembresiaDeBase(dueno, e.empresa, persona.id, opciones.rol ?? "GERENTE");
  const plan = opciones.plan ?? ["cierre", "facturacion"];
  const { version } = await crearPlanPublicado(dueno, { modulos: [...plan] });
  await asignarPlan(dueno, e.tenant, version, { desdeSegundos: -30 });
  for (const modulo of opciones.activados ?? plan) {
    await dueno.query("insert into modulo_de_empresa (empresa_id, modulo) values ($1, $2)", [
      e.empresa,
      modulo,
    ]);
  }
  const sucursal = await sucursalDe(dueno, e.empresa);
  if (opciones.asignarALaSucursal === true) {
    await crearAsignacionDeBase(dueno, e.empresa, persona.id, sucursal);
  }
  const id = personaId(persona.id);
  return {
    tenant: e.tenant,
    empresa: e.empresa,
    sucursal: sucursalId(sucursal),
    persona: id,
    ctx: () => ({ ...comoEmpresa(e.empresa, id), ahora: new Date() }),
  };
}

/** Otra sucursal de la empresa (la inserta el dueño de la base). */
export async function otraSucursal(
  dueno: pg.Client,
  empresa: EmpresaId,
  nombre: string,
): Promise<SucursalId> {
  const { rows } = await dueno.query<{ id: string }>(
    "insert into sucursal (empresa_id, nombre) values ($1, $2) returning id",
    [empresa, nombre],
  );
  return sucursalId(rows[0]?.id as string);
}

/** La jornada, creada como la crea quien tiene actividad (el dueño de la base evade RLS: sirve para dejar listo el escenario). */
export async function crearJornada(
  dueno: pg.Client,
  mundo: Pick<Mundo, "empresa" | "sucursal">,
  fecha: string = FECHA,
): Promise<void> {
  await dueno.query(
    "insert into jornada_de_sucursal (empresa_id, sucursal_id, fecha_negocio) values ($1, $2, $3) on conflict do nothing",
    [mundo.empresa, mundo.sucursal, fecha],
  );
}

export const control = (
  clave: string,
  severidad: ControlDelDia["severidad"],
  cantidad: number,
  detalle = "a",
  referencias: readonly string[] = [],
): ControlDelDia => ({
  modulo: clave.split(".")[0] as string,
  clave,
  severidad,
  cantidad,
  huellaDelDetalle: H(detalle),
  referencias,
});

/**
 * Un aporte falso, controlado desde la prueba: devuelve los `controles` e `impedimentos` que se le fijan y cuenta cuántas veces congeló y con
 * qué reconocidos. Puede fallar al leer (`APORTE_NO_DISPONIBLE`), al congelar o lanzar, para probar la atomicidad.
 */
export type AporteFalso = AporteAlCierreDelDia<TxDePrueba> & {
  controlesActuales: ControlDelDia[];
  impedimentosActuales: ControlDelDia[];
  falla: "NINGUNA" | "AL_LEER" | "AL_CONGELAR" | "LANZA_AL_CONGELAR" | "DEVUELVE_BASURA";
  congelaciones: ReconocimientoDeControl[][];
  /** Lo que hace además al congelar, dentro de la transacción del cierre (para probar que se revierte todo junto). */
  alCongelar: ((tx: TxDePrueba) => Promise<void>) | null;
};

export function aporteFalso(modulo: string, controles: ControlDelDia[] = []): AporteFalso {
  const aporte: AporteFalso = {
    modulo,
    controlesActuales: controles,
    impedimentosActuales: [],
    falla: "NINGUNA",
    congelaciones: [],
    alCongelar: null,
    impedimentos() {
      if (aporte.falla === "AL_LEER") return Promise.resolve(err("APORTE_NO_DISPONIBLE" as const));
      return Promise.resolve(ok(aporte.impedimentosActuales));
    },
    controles() {
      if (aporte.falla === "AL_LEER") return Promise.resolve(err("APORTE_NO_DISPONIBLE" as const));
      if (aporte.falla === "DEVUELVE_BASURA") {
        return Promise.resolve(ok([{ ...control(`${modulo}.x`, "INFORMA", 1), cantidad: -1 }]));
      }
      return Promise.resolve(ok(aporte.controlesActuales));
    },
    async congelarEnTx(tx, _contexto, _jornada, reconocidos) {
      aporte.congelaciones.push([...reconocidos]);
      if (aporte.alCongelar !== null) await aporte.alCongelar(tx);
      if (aporte.falla === "AL_CONGELAR") return err("APORTE_NO_DISPONIBLE" as const);
      if (aporte.falla === "LANZA_AL_CONGELAR") throw new Error("falla inesperada de un aporte");
      return ok(null);
    },
  };
  return aporte;
}

/** Los casos de uso y las consultas del cierre sobre las transacciones de prueba, con los aportes dados. */
export function armarCierre(
  entorno: TransaccionesDePostgres<TxDePrueba>,
  aportes: readonly AporteAlCierreDelDia<TxDePrueba>[],
) {
  const dependencias = { transacciones: entorno, reglas: REGLAS_DE_EMPRESA, aportes };
  return {
    casos: crearCasosDeUsoDeCierre<TxDePrueba>(dependencias),
    consultas: crearConsultasDeCierre<TxDePrueba>(dependencias),
  };
}

/**
 * Una «actividad» de la sucursal (como una sesión de caja o una corrección de medio, que todavía no existen): una tabla de prueba que
 * lleva lo registrado en una jornada. Sirve para las carreras entre quien registra actividad y quien cierra el día.
 */
export async function prepararTablaDeActividad(dueno: pg.Client): Promise<void> {
  await dueno.query(
    `create table if not exists prueba_actividad (
       id bigint generated always as identity primary key,
       empresa_id uuid not null, sucursal_id uuid not null, fecha_negocio date not null,
       tipo text not null, abierta boolean not null default true)`,
  );
  await dueno.query("grant select, insert, update on prueba_actividad to pedernal_app");
}

const contarActividad = async (
  tx: TxDePrueba,
  j: JornadaRef,
  tipo: "sesion" | "correccion",
): Promise<number> => {
  const { rows } = await sql<{ n: string }>`
    select count(*)::text as n from prueba_actividad
     where empresa_id = ${j.empresaId} and sucursal_id = ${j.sucursalId} and fecha_negocio = ${j.fechaDeNegocio}::date
       and tipo = ${tipo} and (${tipo} = 'correccion' or abierta)`.execute(tx.db);
  return Number(rows[0]?.n ?? 0);
};

/**
 * Un aporte cuyos controles salen de `prueba_actividad`: las «sesiones» abiertas son un impedimento (como caja) y las «correcciones»
 * solo informan. Al congelar no escribe nada propio: el cierre guarda la cantidad vista en su foto de controles.
 */
export function aporteDeActividad(modulo: string): AporteAlCierreDelDia<TxDePrueba> {
  const sesiones = async (tx: TxDePrueba, j: JornadaRef) =>
    control(`${modulo}.sesiones_sin_cerrar`, "BLOQUEA", await contarActividad(tx, j, "sesion"));
  return {
    modulo,
    async impedimentos(tx, j) {
      return ok([await sesiones(tx, j)]);
    },
    async controles(tx, j) {
      return ok([
        await sesiones(tx, j),
        control(`${modulo}.correcciones`, "INFORMA", await contarActividad(tx, j, "correccion")),
      ]);
    },
    congelarEnTx: () => Promise.resolve(ok(null)),
  };
}

/** Quien tiene actividad: asegura la jornada abierta y registra una «sesión» (hace lo que haría caja al abrir sesión). */
export async function registrarActividad(
  tx: TxDePrueba,
  mundo: Pick<Mundo, "empresa" | "sucursal">,
  fecha: string = FECHA,
): Promise<Resultado<null, ErrorDeJornadaNoAbierta>> {
  const asegurada = await jornadaDeSucursal.asegurarAbiertaEnTx(
    tx,
    mundo.empresa,
    mundo.sucursal,
    fechaDe(fecha),
  );
  if (!asegurada.ok) return asegurada;
  await sql`insert into prueba_actividad (empresa_id, sucursal_id, fecha_negocio, tipo)
            values (${mundo.empresa}, ${mundo.sucursal}, ${fecha}::date, 'sesion')`.execute(tx.db);
  return ok(null);
}

/** Una «corrección» (como corregir el medio de un cobro): solo vale con la jornada en auditoría. */
export async function registrarCorreccion(
  tx: TxDePrueba,
  mundo: Pick<Mundo, "empresa" | "sucursal">,
  fecha: string = FECHA,
): Promise<Resultado<null, ErrorDeJornadaNoEnAuditoria>> {
  const exigida = await jornadaDeSucursal.exigirEnAuditoriaEnTx(
    tx,
    mundo.empresa,
    mundo.sucursal,
    fechaDe(fecha),
  );
  if (!exigida.ok) return exigida;
  await sql`insert into prueba_actividad (empresa_id, sucursal_id, fecha_negocio, tipo)
            values (${mundo.empresa}, ${mundo.sucursal}, ${fecha}::date, 'correccion')`.execute(
    tx.db,
  );
  return ok(null);
}
