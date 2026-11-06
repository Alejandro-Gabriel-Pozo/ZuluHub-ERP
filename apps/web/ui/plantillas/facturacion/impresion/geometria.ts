/**
 * Las medidas del papel de la vista imprimible, en UN solo lugar: el CSS las recibe como variables (`variablesDeLaGeometria`, aplicadas con `aplicarEstilos`) y la
 * medición y el paginador las leen de acá. Previene que el alto que calcula el paginador no sea el de la hoja que se dibuja (un
 * renglón cortado al borde o una hoja de más). Chequeo: `hoja-a4.test.tsx` mide en Chromium que nada de cada hoja se pase de su
 * alto y `test/web/impresion-geometria.test.ts` fija las constantes.
 */

/** Pulgada de CSS: 96 px = 25,4 mm. */
const PX_POR_MM = 96 / 25.4;

export const mmAPx = (mm: number): number => mm * PX_POR_MM;
export const pxAMm = (px: number): number => px / PX_POR_MM;

/** A4 exacto: 297,5 mm genera dos páginas (spike de impresión en Chromium 141). */
export const ANCHO_A4_MM = 210;
export const ALTO_A4_MM = 297;
/** El margen blanco de cada hoja; la hoja lo lleva como `padding` y el pie se apoya en él. */
export const MARGEN_A4_MM = 10;
/** Aire entre el final de la tabla y el pie: lo que una medición fraccional o una fuente de reemplazo puedan correr. */
export const HOLGURA_MM = 2;
/** El rollo de 80 mm: ancho fijo, largo continuo. */
export const ANCHO_TICKET_MM = 80;
/** Lo que se suma al alto medido del ticket para que el redondeo de `offsetHeight` nunca lo deje corto. */
export const HOLGURA_DEL_TICKET_MM = 2;

/** La escala que entra en el ancho disponible, sin agrandar nunca más allá del tamaño real. */
export const escalaPara = (disponible: number, anchoNatural: number): number =>
  disponible <= 0 ? 1 : Math.min(1, disponible / anchoNatural);

/** Las variables que lee el CSS de la hoja (`HojaA4.module.css`); se ponen con `aplicarEstilos`, nunca como atributo `style=`. */
export function variablesDeLaGeometria(altoDelPieEnPx: number | null): Record<string, string> {
  return {
    "--hoja-ancho": `${ANCHO_A4_MM}mm`,
    "--hoja-alto": `${ALTO_A4_MM}mm`,
    "--hoja-margen": `${MARGEN_A4_MM}mm`,
    ...(altoDelPieEnPx === null ? {} : { "--pie-alto": `${altoDelPieEnPx}px` }),
  };
}

/** La variable que lee el CSS del ticket (`Ticket.module.css`). */
export const variablesDelTicket = (): Record<string, string> => ({
  "--ticket-ancho": `${ANCHO_TICKET_MM}mm`,
});
