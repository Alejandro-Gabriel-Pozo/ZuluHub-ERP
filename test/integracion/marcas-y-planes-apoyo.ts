import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type pg from "pg";
import {
  crearAuditoriaDePostgres,
  type AuditoriaDb,
} from "../../src/adaptadores/postgres/auditoria";
import {
  crearAuditoriaDePlataformaDePostgres,
  type AuditoriaDePlataformaDb,
} from "../../src/adaptadores/postgres/auditoria-de-plataforma";
import {
  crearAutorizacionDePlataformaDePostgres,
  type AutorizacionDePlataformaDb,
} from "../../src/adaptadores/postgres/autorizacion-de-plataforma";
import { crearLecturaDeDerechosDeUso } from "../../src/adaptadores/postgres/derechos-de-uso";
import {
  crearIdempotenciaDePostgres,
  type IdempotenciaDb,
} from "../../src/adaptadores/postgres/idempotencia";
import {
  crearTransacciones,
  type SinTablas,
  type TransaccionesDePostgres,
} from "../../src/adaptadores/postgres/transacciones";
import { REGLAS_DE_PLATAFORMA } from "../../src/capacidades/permisos/plataforma";
import type { ContextoDePlataforma } from "../../src/contexto/contexto";
import {
  crearRepositorioDeMarcas,
  type DominiosDb,
  type MarcasDb,
} from "../../src/modulos/marcas/publico";
import {
  crearLecturaDePlanes,
  crearRepositorioDePlanes,
  type PlanesDb,
  type PlanesDePlataformaDb,
} from "../../src/modulos/planes/publico";
import {
  crearCasosDeUsoDeMarcasYPlanes,
  type CasosDeUsoDeMarcasYPlanes,
} from "../../src/plataforma/casos-de-uso/marcas-y-planes";
import type { TxDeMarcasYPlanes } from "../../src/plataforma/casos-de-uso/marcas-y-planes-comun";
import {
  crearConsultasDeMarcasYPlanes,
  type ConsultasDeMarcasYPlanes,
} from "../../src/plataforma/consultas/consultas-de-marcas-y-planes";
import type { AdminPlataformaId } from "../../src/primitivas/identificadores/marca";
import type { Resultado } from "../../src/primitivas/resultado/resultado";
import { MODULOS_DE_PRUEBA, PERILLAS_DE_PRUEBA } from "../utilidades/planes";
import { SOPORTE_DE_PRUEBA } from "./admins-de-prueba";
import type { BaseDePruebas } from "./global";
import { plataformaEn } from "./soporte-datos";

/**
 * Apoyo de las pruebas de integración de los casos de uso y las consultas de plataforma sobre marcas,
 * planes, ajustes y módulos de empresa (M5): arma las transacciones con lo que armaría la composición (los
 * repositorios, la lectura de derechos, la autorización, la auditoría de plataforma y de empresa y la
 * idempotencia) sobre los roles reales, y con ellas los casos de uso. Todo escenario se prepara con el
 * cliente del DUEÑO (`marcas-apoyo.ts`); lo que se prueba pasa por el rol de plataforma y su contexto
 * firmado.
 *
 * El reloj: las asignaciones, los ajustes y las versiones de marca tienen una restricción contra el reloj
 * de la BASE (`vigente_desde >= creado_en - 1 minuto`), así que estas pruebas viven del reloj real: todo
 * contexto se arma con `new Date()`.
 */

export type TxDeMarcasYPlanesDePrueba = TxDeMarcasYPlanes &
  Readonly<{
    /** Consultas de verificación y fallas provocadas, sin tipar. */
    db: Kysely<SinTablas>;
  }>;

/** Los catálogos de prueba (los reales traen un solo módulo disponible y casi ninguna perilla). */
const CATALOGOS_DE_PRUEBA = {
  catalogoDeModulos: MODULOS_DE_PRUEBA,
  catalogoDePerillas: PERILLAS_DE_PRUEBA,
} as const;

/**
 * `ajustar` envuelve lo que recibe el trabajo (para inyectar una barrera, una vista vieja o una falla en
 * las pruebas de concurrencia y atomicidad); sin él, es exactamente lo que armaría la composición.
 */
export function crearEntornoDeMarcasYPlanes(
  base: BaseDePruebas,
  maximoDeConexiones = 6,
  ajustar: (tx: TxDeMarcasYPlanesDePrueba) => TxDeMarcasYPlanesDePrueba = (tx) => tx,
): TransaccionesDePostgres<TxDeMarcasYPlanesDePrueba> {
  return crearTransacciones<TxDeMarcasYPlanesDePrueba>({
    urls: {
      OPERATIVO: base.app,
      GRUPO: base.grupo,
      PLATAFORMA: base.plataforma,
      TRABAJOS: base.trabajos,
    },
    armar: (db, contexto) =>
      ajustar({
        db,
        marcas: crearRepositorioDeMarcas(db.withTables<MarcasDb & DominiosDb>()),
        planes: crearRepositorioDePlanes(db.withTables<PlanesDePlataformaDb>()),
        derechos: crearLecturaDeDerechosDeUso(
          crearLecturaDePlanes(db.withTables<PlanesDb>()),
          CATALOGOS_DE_PRUEBA,
        ),
        auditoriaDeEmpresa: crearAuditoriaDePostgres(db.withTables<AuditoriaDb>()),
        autorizacionDePlataforma: crearAutorizacionDePlataformaDePostgres(
          db.withTables<AutorizacionDePlataformaDb>(),
        ),
        auditoriaDePlataforma: crearAuditoriaDePlataformaDePostgres(
          db.withTables<AuditoriaDePlataformaDb>(),
          contexto,
        ),
        idempotencia: crearIdempotenciaDePostgres(db.withTables<IdempotenciaDb>(), contexto),
      }),
    maximoDeConexiones,
    clave: base.clave,
  });
}

export const crearCasosDeMarcasYPlanes = (
  entorno: TransaccionesDePostgres<TxDeMarcasYPlanesDePrueba>,
): CasosDeUsoDeMarcasYPlanes =>
  crearCasosDeUsoDeMarcasYPlanes({
    transacciones: entorno,
    reglas: REGLAS_DE_PLATAFORMA,
    ...CATALOGOS_DE_PRUEBA,
  });

export const crearConsultasDeMarcasYPlanesDePrueba = (
  entorno: TransaccionesDePostgres<TxDeMarcasYPlanesDePrueba>,
): ConsultasDeMarcasYPlanes =>
  crearConsultasDeMarcasYPlanes({
    transacciones: entorno,
    reglas: REGLAS_DE_PLATAFORMA,
    ...CATALOGOS_DE_PRUEBA,
  });

// ---- los actores de plataforma, con el reloj real ----

/** El ADMIN sembrado en toda base de prueba, ahora. */
export const comoAdminAhora = (): ContextoDePlataforma => plataformaEn(new Date());
export const comoSoporteAhora = (): ContextoDePlataforma =>
  plataformaEn(new Date(), { tipo: "ADMIN", id: SOPORTE_DE_PRUEBA });
export const comoAdministradorAhora = (id: AdminPlataformaId): ContextoDePlataforma =>
  plataformaEn(new Date(), { tipo: "ADMIN", id });
export const comoElSistemaAhora = (): ContextoDePlataforma =>
  plataformaEn(new Date(), { tipo: "SISTEMA", proceso: "barrido-de-altas" });
/** Un contexto con una hora dada (para fijar lo que es «hoy» en una prueba). */
export const enLaHora = (ahora: Date): ContextoDePlataforma => plataformaEn(ahora);

/** Una hora relativa a ahora: `+3600` es dentro de una hora, `-30` hace 30 segundos. */
export const desdeAhora = (segundos: number): Date => new Date(Date.now() + segundos * 1000);

/** Una clave de idempotencia válida y única. */
export const clave = (): string => `clave-${randomUUID().replaceAll("-", "").slice(0, 24)}`;

export function exito<T>(r: Resultado<T, unknown>): T {
  if (!r.ok) throw new Error(`tenía que salir bien: ${JSON.stringify(r.error)}`);
  return r.valor;
}
export function falla<T>(r: Resultado<T, unknown>): unknown {
  if (r.ok) throw new Error("tenía que fallar");
  return r.error;
}

// ---- lo que dejan los casos de uso, visto con el cliente del dueño ----

export type Huella = Readonly<{
  marcas: number;
  versionesDeMarca: number;
  planes: number;
  versionesDePlan: number;
  asignaciones: number;
  ajustes: number;
  modulos: number;
  auditoriaDePlataforma: number;
  auditoriaDeEmpresa: number;
  claves: number;
}>;

/** Cuántas filas tiene cada tabla que un caso de marcas y planes puede escribir, para comparar antes y después. */
export async function huellaDeEscrituras(dueno: pg.Client): Promise<Huella> {
  const n = async (tabla: string, donde = "true") =>
    Number(
      (
        (await dueno.query(`select count(*)::int as n from ${tabla} where ${donde}`)).rows[0] as {
          n: string;
        }
      ).n,
    );
  return {
    marcas: await n("marca"),
    versionesDeMarca: await n("version_de_marca"),
    planes: await n("plan"),
    versionesDePlan: await n("version_de_plan"),
    asignaciones: await n("plan_de_tenant"),
    ajustes: await n("ajuste_de_perilla"),
    modulos: await n("modulo_de_empresa"),
    auditoriaDePlataforma: await n("auditoria_plataforma"),
    auditoriaDeEmpresa: await n("auditoria_empresa"),
    claves: await n("idempotencia_plataforma"),
  };
}

export type FilaDeAuditoriaDePlataforma = Readonly<{
  id: string;
  actor: string;
  accion: string;
  entidad: string;
  entidad_id: string;
  antes: Record<string, unknown> | null;
  despues: Record<string, unknown> | null;
  creado_en: Date;
}>;

/** Las constancias de auditoría de plataforma de una entidad, en orden. */
export async function auditoriaDePlataformaDe(
  dueno: pg.Client,
  entidad: string,
  entidadId: string,
): Promise<FilaDeAuditoriaDePlataforma[]> {
  return (
    await dueno.query<FilaDeAuditoriaDePlataforma>(
      "select * from auditoria_plataforma where entidad = $1 and entidad_id = $2 order by id",
      [entidad, entidadId],
    )
  ).rows;
}

export type FilaDeAuditoriaDeEmpresa = Readonly<{
  id: string;
  empresa_id: string;
  actor_persona_id: string | null;
  accion: string;
  entidad: string;
  entidad_id: string;
  antes: Record<string, unknown> | null;
  despues: Record<string, unknown> | null;
}>;

/** Las constancias de auditoría de una empresa por acción, en orden. */
export async function auditoriaDeEmpresaDe(
  dueno: pg.Client,
  empresa: string,
  accion: string,
): Promise<FilaDeAuditoriaDeEmpresa[]> {
  return (
    await dueno.query<FilaDeAuditoriaDeEmpresa>(
      "select * from auditoria_empresa where empresa_id = $1 and accion = $2 order by id",
      [empresa, accion],
    )
  ).rows;
}

export async function cuenta(
  dueno: pg.Client,
  texto: string,
  parametros: unknown[] = [],
): Promise<number> {
  return Number(((await dueno.query(texto, parametros)).rows[0] as { n: string }).n);
}
