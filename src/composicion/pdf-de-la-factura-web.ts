import { generarPdfDeLaFactura, type EntradaDelPdf } from "../adaptadores/pdf/pdf-de-la-factura";
import type { Respuesta } from "../capacidades/experiencia/respuesta";
import { aRespuestaDeExcepcion, type DependenciasDeRespuesta } from "./a-respuesta";

export type { EntradaDelPdf };

/**
 * El PDF de un comprobante para la ruta de descarga. Acá NO se decide ningún permiso ni se lee nada de la base: recibe la hoja que la ruta
 * ya armó con el modelo que le dio `verModeloDeImpresion` (que exige `comprobantes.ver`, la empresa y la sucursal dentro de su transacción).
 * Es solo la puerta de la web al adaptador. Falla cerrado: cualquier fallo (un carácter que la tipografía no tiene, un renglón que no entra,
 * un defecto) sale como el error inesperado con su referencia `PD-…`, sin detalle ni texto del cliente; el detalle va al registro.
 * Es una lectura: no escribe nada y pedirla de nuevo da el mismo contenido.
 */
export async function pdfDeLaFactura(
  respuesta: DependenciasDeRespuesta,
  entrada: EntradaDelPdf,
): Promise<Respuesta<Uint8Array<ArrayBuffer>>> {
  try {
    return { ok: true, dato: await generarPdfDeLaFactura(entrada) };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, respuesta);
  }
}
