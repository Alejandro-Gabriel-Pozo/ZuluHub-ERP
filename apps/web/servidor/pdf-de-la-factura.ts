import "server-only";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import { pdfDeLaFactura, type EntradaDelPdf } from "../../../src/composicion/pdf-de-la-factura-web";
import { dependenciasDeSesion } from "./sesion";

/**
 * El PDF de un comprobante visto desde la aplicación: la ruta `.../comprobantes/[id]/pdf` pide el modelo con `verElModeloDeImpresion`
 * (sesión, empresa, `comprobantes.ver` y sucursal los decide el servidor ahí) y recién con ese modelo llama a esto. Fino a propósito: junta
 * el registro de errores real y llama a `src/composicion/pdf-de-la-factura-web.ts`.
 */
export const generarElPdfDeLaFactura = (
  entrada: EntradaDelPdf,
): Promise<Respuesta<Uint8Array<ArrayBuffer>>> =>
  pdfDeLaFactura(dependenciasDeSesion.respuesta, entrada);
