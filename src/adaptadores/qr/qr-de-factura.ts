import { qrComoSvg, type NivelDeCorreccion } from "./qr-svg";

/**
 * El QR de una factura YA DIBUJADO como SVG: recibe el texto del QR (la URL de ARCA que arma `urlDelQr` en
 * `src/modulos/fiscal/dominio/qr-de-arca.ts`) y devuelve solo formas, sin etiqueta (la pone quien lo inserta en la
 * vista imprimible, F9).
 *
 * SUPUESTO, NO VERIFICADO (h7-facturacion D-F3): el nivel de corrección de errores adecuado para el QR de ARCA. La
 * especificación oficial de ARCA no lo define (Pedernal-docs h7-facturacion.md §B.7, «Actualización 2026-11-04»). Se usa
 * «M» (15 %), el mismo que el QR del segundo factor, solo para no dejar el dato sin valor; es un parámetro para
 * cambiarlo (acá o por llamada) sin tocar el dibujo. Revertirlo cuesta cambiar esta constante.
 */
export const CORRECCION_DEL_QR_DE_FACTURA: NivelDeCorreccion = "M";

export const qrDeFacturaComoSvg = (
  url: string,
  correccion: NivelDeCorreccion = CORRECCION_DEL_QR_DE_FACTURA,
): string => qrComoSvg(url, correccion);
