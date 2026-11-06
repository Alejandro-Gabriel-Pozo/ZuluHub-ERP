import { ANCHO_TICKET_MM } from "./geometria";
import type { FormatoDeImpresion } from "./modelo-de-la-hoja";

/** Las reglas de impresión como TEXTO puro (sin DOM): `EstiloDePagina` las adopta en el navegador y las pruebas de Node las leen tal cual. */

export const MARCA_DE_LA_ZONA = "data-zona-de-impresion";

/**
 * Oculta, al imprimir, todo lo que no sea la zona de impresión ni contenga a la zona (la navegación, la barra, los botones). Con `display:
 * none` y no con `visibility: hidden`: lo oculto con `visibility` sigue ocupando lugar y el papel sale con hojas en blanco.
 * Lo que SÍ contiene a la zona (la plantilla, `<main>`, el contenedor de la pantalla) pierde relleno, margen, borde, separación y alto
 * mínimo: si no, el `padding` de la plantilla corre la hoja y el A4 de 210 mm sale cortado. Chequeo: `hoja-en-la-plantilla.test.tsx`.
 */
export const SOLO_LA_HOJA =
  `@media print{html,body{margin:0;background:none}` +
  `body *:not(:has([${MARCA_DE_LA_ZONA}])):not([${MARCA_DE_LA_ZONA}]):not([${MARCA_DE_LA_ZONA}] *){display:none!important}` +
  `body *:has([${MARCA_DE_LA_ZONA}]){display:block!important;margin:0!important;padding:0!important;border:0!important;gap:0!important;min-height:0!important}}`;

/** El texto de `@page` del formato elegido; `null` si todavía no se puede decir (el ticket, sin su largo medido). */
export function reglaDePagina(
  formato: FormatoDeImpresion,
  altoDelTicketEnMm: number | null,
): string | null {
  if (formato === "A4") return "@page{size:A4;margin:0}";
  return altoDelTicketEnMm === null
    ? null
    : `@page{size:${ANCHO_TICKET_MM}mm ${altoDelTicketEnMm}mm;margin:0}`;
}
