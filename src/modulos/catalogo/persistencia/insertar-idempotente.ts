/**
 * Alta idempotente por `id` que deja pasar la unicidad ajena. `ON CONFLICT (id) DO NOTHING` solo cubre el índice de `id`: si dos pedidos
 * idénticos corren a la vez, el segundo puede chocar con el índice secundario `(id, empresa_id)` y volver como error de unicidad en
 * vez de «ya existía» (visto en el CI con dos altas simultáneas del mismo producto). Acá el primer intento usa `ON CONFLICT DO NOTHING`
 * sin objetivo (cubre cualquier unicidad; bajo serializable, un choque con una fila que esta transacción no ve aborta por serialización y
 * el adaptador repite el pedido, que ya ve la fila). Si no insertó: con el `id` ya guardado es una repetición (devuelve `undefined`); si
 * no, el choque fue contra OTRA restricción (nombre, código, un precio con la misma vigencia) y se repite el alta sin `ON CONFLICT` para
 * que la base lance esa restricción tal cual, y la traduzca el caso de uso (`ERRORES_DE_CATALOGO_POR_RESTRICCION`).
 * Previene: una repetición simultánea que devuelve error y no `yaExistia`, y un nombre repetido tragado en silencio.
 */
export async function insertarIdempotente<Fila>(
  intentar: () => Promise<Fila | undefined>,
  yaExiste: () => Promise<boolean>,
  insertarEstricto: () => Promise<Fila>,
): Promise<Fila | undefined> {
  const fila = await intentar();
  if (fila !== undefined) return fila;
  if (await yaExiste()) return undefined;
  return insertarEstricto();
}
