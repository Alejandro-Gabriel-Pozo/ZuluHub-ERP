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
  crearTransacciones,
  type SinTablas,
  type TransaccionesDePostgres,
} from "../../src/adaptadores/postgres/transacciones";
import { REGLAS_DE_PLATAFORMA } from "../../src/capacidades/permisos/plataforma";
import { crearRepositorioDeListas, type ListasDb } from "../../src/modulos/listas/publico";
import {
  crearCasosDeUsoDeListas,
  type CasosDeUsoDeListas,
} from "../../src/plataforma/casos-de-uso/listas-del-sistema";
import type { TxDeListas } from "../../src/plataforma/casos-de-uso/listas-comun";
import {
  crearConsultasDeListas,
  type ConsultasDeListas,
  type TxDeConsultasDeListas,
} from "../../src/plataforma/consultas/consultas-de-listas";
import type { BaseDePruebas } from "./global";

/**
 * Apoyo de las pruebas de integración de las listas del sistema (e3 §3.7): arma las transacciones con lo que armaría la composición
 * (el repositorio de listas, la autorización, la auditoría de plataforma y la idempotencia) sobre los roles reales, y con ellas los
 * casos de uso y la consulta. Las listas son GLOBALES: toda prueba usa una base propia (`crearBaseAparte`) para no cambiar las
 * semillas de las demás. El escenario lo prepara el cliente del DUEÑO; lo que se prueba pasa por el rol de plataforma y su contexto
 * firmado. Los actores y las claves son los de `marcas-y-planes-apoyo.ts` (el ADMIN y el SOPORTE sembrados en toda base de prueba).
 */

export type TxDeListasDePrueba = TxDeListas &
  TxDeConsultasDeListas &
  Readonly<{
    /** Consultas de verificación y fallas provocadas, sin tipar. */
    db: Kysely<SinTablas>;
  }>;

/**
 * `ajustar` envuelve lo que recibe el trabajo (para inyectar una barrera o una falla en las pruebas de concurrencia y de atomicidad);
 * sin él, es exactamente lo que armaría la composición.
 */
export function crearEntornoDeListas(
  base: BaseDePruebas,
  maximoDeConexiones = 6,
  ajustar: (tx: TxDeListasDePrueba) => TxDeListasDePrueba = (tx) => tx,
): TransaccionesDePostgres<TxDeListasDePrueba> {
  return crearTransacciones<TxDeListasDePrueba>({
    urls: {
      OPERATIVO: base.app,
      GRUPO: base.grupo,
      PLATAFORMA: base.plataforma,
      TRABAJOS: base.trabajos,
    },
    armar: (db, contexto) =>
      ajustar({
        db,
        listas: crearRepositorioDeListas(db.withTables<ListasDb>()),
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

export const crearCasosDeListas = (
  entorno: TransaccionesDePostgres<TxDeListasDePrueba>,
): CasosDeUsoDeListas =>
  crearCasosDeUsoDeListas({ transacciones: entorno, reglas: REGLAS_DE_PLATAFORMA });

export const crearConsultasDeListasDePrueba = (
  entorno: TransaccionesDePostgres<TxDeListasDePrueba>,
): ConsultasDeListas =>
  crearConsultasDeListas({ transacciones: entorno, reglas: REGLAS_DE_PLATAFORMA });

export type FilaDeValor = Readonly<{
  id: string;
  lista: string;
  nombre: string;
  activo: boolean;
  fija: boolean;
  version: number;
}>;

/** Los valores de las listas tal como están guardados, vistos con el cliente del dueño (todos, por lista y nombre). */
export async function valoresGuardados(dueno: pg.Client, lista?: string): Promise<FilaDeValor[]> {
  return (
    await dueno.query<FilaDeValor>(
      `select id, lista, nombre, activo, fija, version from valor_de_lista
        where ($1::text is null or lista = $1) order by lista, fija, nombre collate valor_de_lista_nombre_ci`,
      [lista ?? null],
    )
  ).rows;
}

export async function valorPorNombre(
  dueno: pg.Client,
  lista: string,
  nombre: string,
): Promise<FilaDeValor> {
  const fila = (
    await dueno.query<FilaDeValor>(
      "select id, lista, nombre, activo, fija, version from valor_de_lista where lista = $1 and nombre = $2",
      [lista, nombre],
    )
  ).rows[0];
  if (fila === undefined) throw new Error(`no hay «${nombre}» en ${lista}`);
  return fila;
}

/** Lo que dejan los casos de listas: filas de valores, constancias de plataforma de listas y claves de idempotencia de listas. */
export async function huellaDeListas(dueno: pg.Client) {
  const n = async (texto: string) =>
    Number(((await dueno.query(texto)).rows[0] as { n: string }).n);
  return {
    valores: await n("select count(*)::int as n from valor_de_lista"),
    cambios: await n("select coalesce(sum(version), 0)::int as n from valor_de_lista"),
    auditoria: await n(
      "select count(*)::int as n from auditoria_plataforma where entidad = 'valor_de_lista'",
    ),
    claves: await n(
      "select count(*)::int as n from idempotencia_plataforma where operacion like 'listas.%'",
    ),
  };
}
