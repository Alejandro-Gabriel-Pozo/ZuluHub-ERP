/**
 * Las direcciones de «Compras» (Compras PR 3): la lista y la ficha de una compra. El id de la ficha es un UUID que sale de la consulta del servidor, nunca de un texto libre.
 * Las direcciones del filtro y de «Página siguiente» se arman acá, una sola vez: lo que la dirección lleva es lo que el servidor aplicó (`entradas-de-compras.ts`), no lo que se tipeó.
 */

export const RUTA_DE_COMPRAS = "/compras";

export const RUTA_DEL_NIVEL_DE_COMPRAS = `${RUTA_DE_COMPRAS}/nivel`;
/** «Nueva compra» (Compras PR 6b). */
export const RUTA_DE_NUEVA_COMPRA = `${RUTA_DE_COMPRAS}/nueva`;

export const rutaDeLaCompra = (recepcionId: string): string => `${RUTA_DE_COMPRAS}/${recepcionId}`;

/** El formulario de «Corregir» una línea de la compra (Compras PR 10): el número de línea es un entero que sale de la ficha. */
export const rutaDeCorregirLaLinea = (recepcionId: string, linea: number): string =>
  `${rutaDeLaCompra(recepcionId)}/corregir/${String(linea)}`;

export type FiltroAplicado = Readonly<{
  estado: "TODAS" | "SIN_FACTURAR";
  desde: string | null;
  hasta: string | null;
}>;

/** La lista con este filtro (solo lo que se aparta del valor por defecto) y, si sigue, la página. */
export function direccionDeLaLista(filtro: FiltroAplicado, despues: string | null): string {
  const pares: [string, string][] = [];
  if (filtro.estado !== "TODAS") pares.push(["estado", filtro.estado]);
  if (filtro.desde !== null) pares.push(["desde", filtro.desde]);
  if (filtro.hasta !== null) pares.push(["hasta", filtro.hasta]);
  if (despues !== null) pares.push(["despues", despues]);
  return pares.length === 0
    ? RUTA_DE_COMPRAS
    : `${RUTA_DE_COMPRAS}?${new URLSearchParams(pares).toString()}`;
}
