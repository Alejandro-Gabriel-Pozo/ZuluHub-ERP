import { err, type Resultado } from "../../primitivas/resultado/resultado";
import { empiezaCon, FIRMA_ICO, FIRMA_JPEG, FIRMA_PNG, RIFF, WEBP } from "./bytes-de-imagen";
import { leerIco } from "./cabeceras-ico";
import { analizarJpeg, leerJpeg } from "./cabeceras-jpeg";
import { leerPng, pngEsOpaco } from "./cabeceras-png";
import { analizarWebp, fragmentosDeRiff, leerWebp } from "./cabeceras-webp";
import type { CabeceraPlana, ErrorDeCabecera, FormatoDetectado } from "./tipos-de-cabecera";

/**
 * Lectores de cabecera de imágenes (marca e íconos §2.4 T3, y fotos de producto C-1). Trabajan sobre
 * `Uint8Array` sin decodificar píxeles: el servidor nunca abre la imagen, solo lee los campos de la
 * cabecera que dicen cuánto mide y si tiene transparencia. Son puros y totales: ante bytes hostiles
 * (longitudes inconsistentes, marcadores truncados, ciclos) devuelven un error con nombre; nunca
 * lanzan, nunca leen fuera de rango y siempre terminan (cada vuelta de cada bucle avanza al menos un
 * byte dentro de los datos).
 */

// Los tipos y los lectores por formato viven en sus archivos; se reexportan para que `cabeceras` siga siendo
// la puerta de los lectores de cabecera.
export type {
  CabeceraIco,
  CabeceraJpeg,
  CabeceraPlana,
  CabeceraPng,
  CabeceraWebp,
  ErrorDeCabecera,
  FormatoDeImagen,
  FormatoDetectado,
} from "./tipos-de-cabecera";
export type { AnalisisDeWebp, Fragmento } from "./cabeceras-webp";
export type { AnalisisDeJpeg, SegmentoDeJpeg } from "./cabeceras-jpeg";
export {
  leerIco,
  analizarJpeg,
  leerJpeg,
  leerPng,
  pngEsOpaco,
  analizarWebp,
  fragmentosDeRiff,
  leerWebp,
};

/** Cuántos bytes del comienzo se miran para encontrar `<svg` (un SVG real lo trae enseguida). */
const BYTES_PARA_SVG = 1024;

/**
 * Reconoce el formato por la firma COMPLETA (PNG: los 8 bytes; WebP: `RIFF`…`WEBP`; JPEG: `FF D8 FF`;
 * ICO: `00 00 01 00`). Un SVG no tiene firma binaria: se lo marca si `<svg` aparece al comienzo, solo
 * para que el rechazo diga «SVG» y no «formato desconocido».
 */
export function detectarFormato(bytes: Uint8Array): FormatoDetectado {
  if (empiezaCon(bytes, 0, FIRMA_PNG)) return "png";
  if (empiezaCon(bytes, 0, FIRMA_JPEG)) return "jpeg";
  if (empiezaCon(bytes, 0, RIFF) && empiezaCon(bytes, 8, WEBP)) return "webp";
  if (empiezaCon(bytes, 0, FIRMA_ICO)) return "ico";
  const inicio = String.fromCharCode(...bytes.subarray(0, BYTES_PARA_SVG)).toLowerCase();
  return inicio.includes("<svg") ? "svg" : "desconocido";
}

// --- Despacho ---------------------------------------------------------------------------------------

/** Lee la cabecera según el formato que dice la firma; ICO, SVG y lo desconocido no entran. */
export function leerCabecera(bytes: Uint8Array): Resultado<CabeceraPlana, ErrorDeCabecera> {
  switch (detectarFormato(bytes)) {
    case "png":
      return leerPng(bytes);
    case "webp":
      return leerWebp(bytes);
    case "jpeg":
      return leerJpeg(bytes);
    default:
      return err("FORMATO_NO_RECONOCIDO");
  }
}

/** ¿Es opaca? PNG: lo que diga `pngEsOpaco`; WebP: sin alfa; el JPEG nunca tiene alfa. */
export function esOpaca(cabecera: CabeceraPlana): boolean {
  switch (cabecera.formato) {
    case "png":
      return pngEsOpaco(cabecera);
    case "webp":
      return !cabecera.conAlfa;
    default:
      return true;
  }
}
