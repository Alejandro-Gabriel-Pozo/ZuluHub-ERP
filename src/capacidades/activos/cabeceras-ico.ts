import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import { empiezaCon, FIRMA_ICO, vistaDe } from "./bytes-de-imagen";
import type { CabeceraIco, ErrorDeCabecera } from "./tipos-de-cabecera";

// --- ICO --------------------------------------------------------------------------------------------

/**
 * Lee el directorio de un ICO: cada entrada declara sus medidas (0 significa 256) y dónde están sus
 * datos, que tienen que estar enteros dentro del archivo y después del directorio. Un cursor (.cur)
 * tiene otra firma y no se reconoce.
 */
export function leerIco(bytes: Uint8Array): Resultado<CabeceraIco, ErrorDeCabecera> {
  if (!empiezaCon(bytes, 0, FIRMA_ICO)) return err("FORMATO_NO_RECONOCIDO");
  if (bytes.length < 6) return err("TRUNCADO");
  const v = vistaDe(bytes);
  const cantidad = v.getUint16(4, true);
  if (cantidad === 0) return err("CABECERA_INVALIDA");
  const finDelDirectorio = 6 + 16 * cantidad;
  if (finDelDirectorio > bytes.length) return err("TRUNCADO");
  const imagenes: { ancho: number; alto: number }[] = [];
  for (let i = 0; i < cantidad; i++) {
    const entrada = 6 + 16 * i;
    const tamano = v.getUint32(entrada + 8, true);
    const desde = v.getUint32(entrada + 12, true);
    if (tamano === 0 || desde < finDelDirectorio) return err("CABECERA_INVALIDA");
    if (desde + tamano > bytes.length) return err("TRUNCADO");
    imagenes.push({
      ancho: v.getUint8(entrada) || 256,
      alto: v.getUint8(entrada + 1) || 256,
    });
  }
  return ok({ formato: "ico", imagenes });
}
