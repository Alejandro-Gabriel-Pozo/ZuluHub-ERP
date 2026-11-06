import { sql, type Kysely } from "kysely";
import type { FiscalDb } from "./tablas";

/** Las ayudas comunes de los repositorios fiscales (altas con `id` de la aplicación, valores de la base). Salieron de `repositorios.ts` al partirlo: viven en una hoja para que los repositorios que las usan no se importen en círculo. */

/** Un alta con `id` de la aplicación: `creado: false` es que ya existía (la repetición es un éxito). */
export type ResultadoDeAlta<T> = Readonly<{ creado: boolean; valor: T }>;

/** El `id` está tomado por algo que esta empresa no puede ver (o por otra clase de fila). */
export type ErrorDeAlta = "ID_EN_USO";

/**
 * Un valor de la base que el CHECK correspondiente no deja pasar: si llega otro, algo se rompió.
 * Lo comparten los repositorios de la facturación (comprobantes, intentos, certificados).
 */
export function exigir<T>(valor: T | null, nombre: string): T {
  if (valor === null) throw new RangeError(`${nombre} vacío en la base`);
  return valor;
}

export function deLaLista<T extends string>(lista: readonly T[], valor: string, nombre: string): T {
  const encontrado = lista.find((v) => v === valor);
  if (encontrado === undefined) throw new RangeError(`${nombre} desconocido en la base: ${valor}`);
  return encontrado;
}

/**
 * Serializa dos altas con el MISMO `id` (`pg_advisory_xact_lock`, se libera al terminar la
 * transacción). `ON CONFLICT (id) DO NOTHING` solo absorbe el conflicto del `id`: dos altas
 * simultáneas de la misma fila chocan además en las OTRAS únicas que ella tiene (el par `(id,
 * empresa_id)`, el número del punto de venta, el borrador único del emisor) y la perdedora recibía
 * un error de unicidad en vez del «ya estaba», tanto bajo READ COMMITTED como bajo SERIALIZABLE
 * (se comprobó contra la base real). Con el bloqueo, la segunda espera a que la primera termine, ve
 * su fila y no hace nada (bajo SERIALIZABLE, además, el adaptador repite el trabajo si el motor
 * aborta con 40001).
 */
export async function serializarAltaDeId(
  db: Kysely<FiscalDb>,
  tabla: string,
  id: string,
): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`pedernal.fiscal.alta.${tabla}:${id}`}, 0))`.execute(
    db,
  );
}
