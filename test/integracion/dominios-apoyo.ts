import type { Kysely } from "kysely";
import type pg from "pg";
import {
  crearAuditoriaDePlataformaDePostgres,
  type AuditoriaDePlataformaDb,
} from "../../src/adaptadores/postgres/auditoria-de-plataforma";
import {
  crearAutorizacionDePlataformaDePostgres,
  type AutorizacionDePlataformaDb,
} from "../../src/adaptadores/postgres/autorizacion-de-plataforma";
import {
  crearIdempotenciaDePostgres,
  type IdempotenciaDb,
} from "../../src/adaptadores/postgres/idempotencia";
import {
  crearReferenciasDeErrorDePostgres,
  type ReferenciasDeErrorDb,
} from "../../src/adaptadores/postgres/referencias-de-error";
import {
  crearTransacciones,
  type SinTablas,
  type TransaccionesDePostgres,
} from "../../src/adaptadores/postgres/transacciones";
import { REGLAS_DE_PLATAFORMA } from "../../src/capacidades/permisos/plataforma";
import { crearRepositorioDeDominios, type DominiosDb } from "../../src/modulos/marcas/publico";
import {
  crearCasosDeUsoDeDominios,
  type CasosDeUsoDeDominios,
} from "../../src/plataforma/casos-de-uso/dominios";
import type { TxDeDominios } from "../../src/plataforma/casos-de-uso/dominios-comun";
import {
  armarRegistrarReferenciaDeError,
  type TxDeReferencias,
} from "../../src/plataforma/casos-de-uso/registrar-referencia";
import type { ContextoDePlataforma } from "../../src/contexto/contexto";
import type { AdminPlataformaId } from "../../src/primitivas/identificadores/marca";
import { SOPORTE_DE_PRUEBA } from "./admins-de-prueba";
import type { BaseDePruebas } from "./global";
import { plataformaEn } from "./soporte-datos";
import { AHORA_DE_PRUEBA } from "./entorno";

/**
 * Apoyo de las pruebas de integración de los dominios de plataforma (M4a): arma las transacciones con lo
 * que armaría la composición real (el repositorio de dominios, la autorización, la auditoría, la
 * idempotencia y las referencias de error de plataforma) sobre los roles reales, y con ellas los casos de
 * uso. Todo escenario se prepara con el cliente del DUEÑO (`marcas-apoyo.ts`); lo que se prueba pasa por
 * el rol de plataforma y su contexto firmado.
 */

export type TxDeDominiosDePrueba = TxDeDominios &
  TxDeReferencias &
  Readonly<{
    /** Consultas de verificación y fallas provocadas, sin tipar. */
    db: Kysely<SinTablas>;
  }>;

/**
 * `ajustar` envuelve lo que recibe el trabajo (para inyectar una barrera, una vista vieja o una falla en
 * las pruebas de concurrencia y atomicidad); sin él, es exactamente lo que armaría la composición.
 */
export function crearEntornoDeDominios(
  base: BaseDePruebas,
  maximoDeConexiones = 5,
  ajustar: (tx: TxDeDominiosDePrueba) => TxDeDominiosDePrueba = (tx) => tx,
): TransaccionesDePostgres<TxDeDominiosDePrueba> {
  return crearTransacciones<TxDeDominiosDePrueba>({
    urls: {
      OPERATIVO: base.app,
      GRUPO: base.grupo,
      PLATAFORMA: base.plataforma,
      TRABAJOS: base.trabajos,
    },
    armar: (db, contexto) =>
      ajustar({
        db,
        dominios: crearRepositorioDeDominios(db.withTables<DominiosDb>()),
        autorizacionDePlataforma: crearAutorizacionDePlataformaDePostgres(
          db.withTables<AutorizacionDePlataformaDb>(),
        ),
        auditoriaDePlataforma: crearAuditoriaDePlataformaDePostgres(
          db.withTables<AuditoriaDePlataformaDb>(),
          contexto,
        ),
        idempotencia: crearIdempotenciaDePostgres(db.withTables<IdempotenciaDb>(), contexto),
        referenciasDeError: crearReferenciasDeErrorDePostgres(
          db.withTables<ReferenciasDeErrorDb>(),
        ),
      }),
    maximoDeConexiones,
    clave: base.clave,
  });
}

export const crearCasosDeDominios = (
  entorno: TransaccionesDePostgres<TxDeDominiosDePrueba>,
): CasosDeUsoDeDominios =>
  crearCasosDeUsoDeDominios({ transacciones: entorno, reglas: REGLAS_DE_PLATAFORMA });

/** Registra la referencia de un rechazo, como lo hace la puerta DESPUÉS de que el caso de uso se revirtió. */
export const crearRegistroDeReferencias = (
  entorno: TransaccionesDePostgres<TxDeDominiosDePrueba>,
  azar: () => Uint8Array = () => crypto.getRandomValues(new Uint8Array(4)),
) => armarRegistrarReferenciaDeError({ transacciones: entorno, azar });

/** Cuántas filas tiene cada tabla que un caso de dominios puede escribir, para comparar antes y después. */
export type Huella = Readonly<{
  dominios: number;
  auditoria: number;
  claves: number;
  referencias: number;
}>;

export async function huellaDeEscrituras(dueno: pg.Client): Promise<Huella> {
  const n = async (texto: string) =>
    Number(((await dueno.query(texto)).rows[0] as { n: string }).n);
  return {
    dominios: await n("select count(*)::int as n from dominio"),
    auditoria: await n(
      "select count(*)::int as n from auditoria_plataforma where accion like 'DOMINIO\\_%'",
    ),
    claves: await n("select count(*)::int as n from idempotencia_plataforma"),
    referencias: await n("select count(*)::int as n from referencia_de_error"),
  };
}

/** La fila de dominio tal como está en la base, con las columnas que importan. */
export type FilaDeDominio = Readonly<{
  id: string;
  host: string;
  superficie: string;
  estado: string;
  verificado_en: Date | null;
  motivo: string | null;
  titular: string;
  es_canonico: boolean;
  duenio_marca_id: string | null;
  duenio_empresa_id: string | null;
  marca_id: string;
  registrado_por: string;
  version: number;
}>;

export async function filaDeDominio(dueno: pg.Client, id: string): Promise<FilaDeDominio> {
  const { rows } = await dueno.query<FilaDeDominio>("select * from dominio where id = $1", [id]);
  const fila = rows[0];
  if (fila === undefined) throw new Error(`no hay un dominio ${id}`);
  return fila;
}

export type FilaDeAuditoria = Readonly<{
  id: string;
  actor: string;
  accion: string;
  entidad: string;
  entidad_id: string;
  antes: Record<string, unknown> | null;
  despues: Record<string, unknown> | null;
  creado_en: Date;
}>;

/** Las constancias de auditoría de un dominio, en orden. */
export async function auditoriaDeDominio(
  dueno: pg.Client,
  dominioId: string,
): Promise<FilaDeAuditoria[]> {
  return (
    await dueno.query<FilaDeAuditoria>(
      "select * from auditoria_plataforma where entidad = 'dominio' and entidad_id = $1 order by id",
      [dominioId],
    )
  ).rows;
}

// ---- los actores de plataforma de las pruebas, con su tipo exacto (los casos de uso no reciben otro) ----

/** El ADMIN sembrado en toda base de prueba. */
export const comoAdminDePlataforma = (): ContextoDePlataforma => plataformaEn(AHORA_DE_PRUEBA);
export const comoSoporteDePlataforma = (): ContextoDePlataforma =>
  plataformaEn(AHORA_DE_PRUEBA, { tipo: "ADMIN", id: SOPORTE_DE_PRUEBA });
export const comoAdministradorDe = (id: AdminPlataformaId): ContextoDePlataforma =>
  plataformaEn(AHORA_DE_PRUEBA, { tipo: "ADMIN", id });
export const comoElSistema = (): ContextoDePlataforma =>
  plataformaEn(AHORA_DE_PRUEBA, { tipo: "SISTEMA", proceso: "barrido-de-altas" });
