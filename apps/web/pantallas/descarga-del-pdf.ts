import {
  CODIGOS_PUBLICOS,
  errorDeCodigo,
  type ErrorPublico,
} from "../../../src/capacidades/experiencia/respuesta";
import { generarElPdfDeLaFactura } from "../servidor/pdf-de-la-factura";
import { verElModeloDeImpresion } from "../servidor/facturacion";
import { FORMA_DE_ID } from "./comprobante-por-id";
import { entradaDelPdf, nombreDelArchivoPdf } from "./pdf-de-la-factura";

/**
 * La descarga del PDF de un comprobante (ruta `.../comprobantes/[id]/pdf`). Mismo camino que la vista de impresión: valida la forma del
 * id ANTES de preguntar, pide el modelo con `verElModeloDeImpresion` (sesión, empresa, `comprobantes.ver` y sucursal los decide el
 * servidor; el que no corresponde se dice igual que el que no existe) y recién con ese modelo genera el PDF.
 *
 * - Nunca se cachea (`private, no-store`): es un comprobante con datos de un cliente.
 * - El nombre del archivo sale de listas cerradas del modelo (ver `nombreDelArchivoPdf`); nada del cliente va en la cabecera ni en la URL.
 * - Un error sale SOLO como `{ codigo, referencia? }` con el estado HTTP de su código: sin texto, sin detalle y sin lo que el cliente escribió.
 * - Descargar dos veces el mismo comprobante da el mismo PDF byte a byte: la fecha de creación de los metadatos es la de EMISIÓN (`entradaDelPdf`),
 *   no la hora de la descarga.
 * - Falla cerrado: ante cualquier fallo no sale un PDF a medias.
 * Chequeo: `test/web/pdf-descarga.test.ts`.
 */

const SIN_CACHE = "private, no-store";

function respuestaDeError(error: ErrorPublico): Response {
  const cuerpo = JSON.stringify({
    codigo: error.codigo,
    ...(error.referencia === undefined ? {} : { referencia: error.referencia }),
  });
  return new Response(cuerpo, {
    status: CODIGOS_PUBLICOS[error.codigo].estadoHttp,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": SIN_CACHE,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function descargarElPdf(id: string): Promise<Response> {
  if (!FORMA_DE_ID.test(id)) {
    return respuestaDeError(errorDeCodigo("FISCAL_COMPROBANTE_NO_ENCONTRADO"));
  }
  const lectura = await verElModeloDeImpresion({ comprobanteId: id });
  if (!lectura.ok) return respuestaDeError(lectura.error);
  const modelo = lectura.dato.modelo;
  const pdf = await generarElPdfDeLaFactura(entradaDelPdf(modelo));
  if (!pdf.ok) return respuestaDeError(pdf.error);
  return new Response(pdf.dato, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nombreDelArchivoPdf(modelo)}"`,
      "Content-Length": String(pdf.dato.length),
      "Cache-Control": SIN_CACHE,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
