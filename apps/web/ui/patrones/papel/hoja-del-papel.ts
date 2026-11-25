import { HOLGURA_DEL_TICKET_MM, pxAMm } from "../../plantillas/facturacion/impresion/geometria";
import { SOLO_LA_HOJA } from "../../plantillas/facturacion/impresion/regla-de-pagina";

/**
 * Las medidas y las reglas de la página del papel de comanda y de ticket (S-2; `e7-salon-e-impresion-especificacion.md` §3.10): texto puro (sin DOM), que `EstiloDelPapel` adopta en el
 * navegador y las pruebas de Node leen tal cual. Siguen el camino de la factura (`facturacion/impresion/regla-de-pagina.ts`, DEC-0051): `@page` va en una hoja de estilos CONSTRUIDA desde
 * JavaScript, nunca en un `<style>` ni en un atributo `style=`, que la CSP bloquea. Reutiliza «solo la hoja» (`SOLO_LA_HOJA`) y la holgura del alto: una regla, un lugar.
 * Previene: papel que sale con el tamaño del navegador (Chromium no respeta `size: 80mm auto`) o con la pantalla entera alrededor.
 * Chequeo: `hoja-del-papel.test.ts` y `PapelImpreso.test.tsx` (Chromium real).
 */

/** El papel como lo entrega el servidor (`documentoParaImprimir`): líneas de texto con un estilo y el ancho de la impresora. Vive acá (puro, sin DOM) para que el modelo de textos y las pruebas de Node no arrastren el componente. */
export type PapelParaImprimir = Readonly<{
  ancho: number;
  lineas: readonly Readonly<{ texto: string; estilo: string }>[];
}>;

/** El texto de un ancho de papel («58 mm»): una sola forma para la lista, el formulario y la hoja de prueba. */
export const rotuloDelAncho = (anchoMm: number): string => `${String(anchoMm)} mm`;

/** El alto de la hoja en mm: el alto medido en píxeles, redondeado hacia arriba y con holgura, para que nunca quede corto. */
export const altoDeLaHojaEnMm = (altoEnPx: number): number =>
  Math.ceil(pxAMm(altoEnPx)) + HOLGURA_DEL_TICKET_MM;

/** Las reglas de la página: `@page` con el ancho de la impresora y el alto medido, más la regla que deja solo la hoja. */
export const reglaDeLaHojaDelPapel = (anchoMm: number, altoMm: number): string =>
  `@page{size:${String(anchoMm)}mm ${String(altoMm)}mm;margin:0}${SOLO_LA_HOJA}`;

/** Las variables que lee el CSS del papel (`PapelImpreso.module.css`); se ponen con `aplicarEstilos`, nunca como atributo `style=`. */
export const variablesDelPapel = (anchoMm: number): Record<string, string> => ({
  "--papel-ancho": `${String(anchoMm)}mm`,
});
