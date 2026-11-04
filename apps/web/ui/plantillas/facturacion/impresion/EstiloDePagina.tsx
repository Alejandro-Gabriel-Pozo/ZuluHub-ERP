import { ANCHO_TICKET_MM } from "./geometria";
import type { FormatoDeImpresion } from "./modelo-de-la-hoja";

export const MARCA_DE_LA_ZONA = "data-zona-de-impresion";

/**
 * Oculta, al imprimir, todo lo que no sea la zona de impresión ni contenga a la zona (la navegación, la barra, los botones). Con `display:
 * none` y no con `visibility: hidden`: lo oculto con `visibility` sigue ocupando lugar y el papel sale con hojas en blanco.
 */
const SOLO_LA_HOJA =
  `@media print{html,body{margin:0;background:none}` +
  `body *:not(:has([${MARCA_DE_LA_ZONA}])):not([${MARCA_DE_LA_ZONA}]):not([${MARCA_DE_LA_ZONA}] *){display:none!important}}`;

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

export type PropsDelEstiloDePagina = Readonly<{
  formato: FormatoDeImpresion;
  altoDelTicketEnMm: number | null;
}>;

/**
 * El `<style>` de la página que se imprime: `@page` SOLO del formato elegido (el A4 usa `size: A4`; el ticket, su largo medido, porque
 * Chromium no respeta `size: 80mm auto`) más la regla que deja solo la hoja. Se dibuja solo mientras la vista está montada: al
 * desmontarla React lo quita y la impresión de las demás pantallas queda como estaba (una `@page` con el tamaño del ticket quedaría
 * pegada a todo lo que se imprima después).
 */
export function EstiloDePagina({ formato, altoDelTicketEnMm }: PropsDelEstiloDePagina) {
  const pagina = reglaDePagina(formato, altoDelTicketEnMm);
  return <style data-estilo-de-pagina={formato}>{`${pagina ?? ""}${SOLO_LA_HOJA}`}</style>;
}
