import type { PasoDeLetra } from "./letra";

/**
 * «La tabla no entra → filas» (carta-libro-especificacion §4; contrato de familias, DDD 67): una familia con medidas sale como TABLA (una columna por
 * medida) solo mientras las columnas entran en el ancho del celular con la letra que eligió el comensal. Si no entran, la MISMA data se lee como LISTA
 * (un renglón por producto con «Medida $ precio · …»). Es una regla de presentación y de datos puros: sin medir el DOM, sin reloj y sin azar, igual en el
 * servidor y en el navegador (si se midiera el ancho, el servidor y el navegador dibujarían distinto y la página saltaría al hidratar).
 *
 * Previene: una tabla con scroll horizontal dentro del Libro (compite con el gesto de cambiar de página y el comensal «se va» de la sección sin querer) y
 * una columna cortada que esconde un precio.
 */

export type FormaDeFamilia = "TABLA" | "LISTA" | "LINEA";

/** Cuántas columnas de medida entran por paso de letra en 320 px de ancho (el celular más chico que se atiende). Un paso más grande, menos columnas. */
export const COLUMNAS_QUE_ENTRAN: Readonly<Record<PasoDeLetra, number>> = {
  NORMAL: 3,
  GRANDE: 3,
  MUY_GRANDE: 2,
};

/**
 * La forma con la que se dibuja una familia. `LINEA` (un solo precio para toda la familia) y `LISTA` ya son filas y no cambian; `TABLA` baja a `LISTA`
 * cuando sus columnas no entran. Una cantidad de columnas que no es un entero positivo no es una tabla (cierra hacia filas).
 */
export function formaQueEntra(
  forma: FormaDeFamilia,
  columnas: number,
  paso: PasoDeLetra,
): FormaDeFamilia {
  if (forma !== "TABLA") return forma;
  if (!Number.isInteger(columnas) || columnas < 1) return "LISTA";
  return columnas <= COLUMNAS_QUE_ENTRAN[paso] ? "TABLA" : "LISTA";
}
