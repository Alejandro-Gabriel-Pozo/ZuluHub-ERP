/**
 * La forma del pedido de cambiar los precios de varias medidas a la vez (A13): lo que se puede decidir sin base. Puro.
 *  - Un tope de medidas por pedido: una cota para no abrir una transacción enorme (un producto real tiene un puñado).
 *  - Una medida repetida en el pedido se rechaza antes de escribir (dos precios para la misma medida no tienen sentido; el segundo ni siquiera vería la fila del primero).
 *  - Un `precioId` repetido se rechaza antes de escribir (es la clave de idempotencia de SU cambio: dos cambios no pueden compartirla).
 * Chequeo: `pedido-de-precios-por-medida.test.ts`.
 */

export const MAXIMO_DE_MEDIDAS_POR_PEDIDO = 50;

export type ErrorDeLosCambiosDePrecios = "OPCION_INVALIDA" | "ID_REUTILIZADO";

export function revisarLosCambiosDePrecios(
  cambios: ReadonlyArray<Readonly<{ precioId: string; opcionId: string }>>,
): ErrorDeLosCambiosDePrecios | null {
  if (cambios.length > MAXIMO_DE_MEDIDAS_POR_PEDIDO) return "OPCION_INVALIDA";
  if (new Set(cambios.map((c) => c.opcionId)).size !== cambios.length) return "OPCION_INVALIDA";
  if (new Set(cambios.map((c) => c.precioId)).size !== cambios.length) return "ID_REUTILIZADO";
  return null;
}
