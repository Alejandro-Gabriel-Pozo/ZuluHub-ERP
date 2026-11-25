/**
 * Dos ayudas de la exportación de compras, aparte para probarlas solas: agrupar una lista por clave en UNA pasada (filtrar la lista entera por cada elemento es una cuenta cuadrática:
 * 20.000 compras tardaban ~12 s de CPU) y leer por lote de a `TAMANO_DE_TANDA_DE_LOS_IDS` ids (una consulta con más de 65.535 parámetros no se puede armar). Chequeo: `exportar-compras-apoyo.test.ts`.
 */
export const TAMANO_DE_TANDA_DE_LOS_IDS = 5000;

/** Los elementos agrupados por clave, una sola pasada. */
export function agrupar<T>(
  elementos: readonly T[],
  clave: (e: T) => string,
): ReadonlyMap<string, readonly T[]> {
  const grupos = new Map<string, T[]>();
  for (const e of elementos) {
    const k = clave(e);
    const lista = grupos.get(k);
    if (lista === undefined) grupos.set(k, [e]);
    else lista.push(e);
  }
  return grupos;
}

/** Las consultas por lote de a `TAMANO_DE_TANDA_DE_LOS_IDS` ids (el tope de parámetros de una consulta es 65.535). */
export async function enTandas<I, R>(
  ids: readonly I[],
  leer: (ids: readonly I[]) => Promise<readonly R[]>,
): Promise<R[]> {
  const todo: R[] = [];
  for (let i = 0; i < ids.length; i += TAMANO_DE_TANDA_DE_LOS_IDS) {
    todo.push(...(await leer(ids.slice(i, i + TAMANO_DE_TANDA_DE_LOS_IDS))));
  }
  return todo;
}
