/**
 * Las direcciones de «Compras» (Compras PR 3): la lista y la ficha de una compra. El id de la ficha es un UUID que sale de la consulta del servidor, nunca de un texto libre.
 * Las direcciones del filtro y de «Página siguiente» se arman acá, una sola vez: lo que la dirección lleva es lo que el servidor aplicó (`entradas-de-compras.ts`), no lo que se tipeó.
 */

export const RUTA_DE_COMPRAS = "/compras";

export const RUTA_DEL_NIVEL_DE_COMPRAS = `${RUTA_DE_COMPRAS}/nivel`;
/** «Nueva compra» (Compras PR 6b). */
export const RUTA_DE_NUEVA_COMPRA = `${RUTA_DE_COMPRAS}/nueva`;

/** La descarga del archivo de compras (Excel) del período aplicado en la lista. */
const RUTA_DE_EXPORTAR_COMPRAS = `${RUTA_DE_COMPRAS}/exportar`;

export const rutaDeLaCompra = (recepcionId: string): string => `${RUTA_DE_COMPRAS}/${recepcionId}`;

/** El formulario de «Corregir» una línea de la compra (Compras PR 10): el número de línea es un entero que sale de la ficha. */
export const rutaDeCorregirLaLinea = (recepcionId: string, linea: number): string =>
  `${rutaDeLaCompra(recepcionId)}/corregir/${String(linea)}`;

/** «Declarar pago» de la factura de una compra (Compras PR 8). */
export const rutaDelPago = (recepcionId: string): string => `${rutaDeLaCompra(recepcionId)}/pago`;

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

/**
 * La dirección de la descarga con el período YA APLICADO en la lista (lo que el servidor tomó de la dirección, no lo que se tipeó sin aplicar). Sin las dos fechas no hay archivo: `null`
 * (no se supone un período). El servidor valida de nuevo y rechaza más de 12 meses.
 */
export function direccionDeExportar(filtro: FiltroAplicado): string | null {
  if (filtro.desde === null || filtro.hasta === null) return null;
  return `${RUTA_DE_EXPORTAR_COMPRAS}?${new URLSearchParams([
    ["desde", filtro.desde],
    ["hasta", filtro.hasta],
  ]).toString()}`;
}
