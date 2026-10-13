import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import {
  analizarJpeg,
  analizarWebp,
  detectarFormato,
  type CabeceraJpeg,
  type CabeceraWebp,
  type ErrorDeCabecera,
  type AnalisisDeWebp,
  type Fragmento,
  type SegmentoDeJpeg,
} from "./cabeceras";

/**
 * Limpieza de metadatos de las fotos de producto (carta §5.2 y §5.5): la ubicación GPS del EXIF no
 * puede llegar a la carta pública. Se QUITA, sin decodificar ni recomprimir la imagen:
 *
 * - JPEG: los segmentos APP1 (EXIF y XMP) y APP13 (Photoshop/IPTC). Los demás (JFIF, perfil de color,
 *   Adobe, tablas) se copian tal cual; los bytes después del EOI y los FF de relleno entre segmentos
 *   no son imagen y no pasan.
 * - WebP: los fragmentos `EXIF` y `XMP `. Se reescribe el tamaño del RIFF y, en el encabezado VP8X,
 *   se bajan las banderas de EXIF y XMP. Los bytes después del tamaño declarado no pasan.
 *
 * Es total: ante bytes que no son un JPEG o WebP legibles devuelve un error con nombre, nunca lanza.
 * Lo que devuelve es un arreglo nuevo (nunca la entrada), no más largo que ella, que los lectores de
 * `cabeceras.ts` aceptan con las mismas medidas, y limpiarlo otra vez no lo cambia.
 */

const APP1 = 0xe1;
const APP13 = 0xed;

/** Bits del byte de banderas de VP8X que avisan que hay fragmentos `EXIF` (0x08) y `XMP ` (0x04). */
const BANDERAS_DE_METADATOS_DE_VP8X = 0x08 | 0x04;

const concatenar = (partes: readonly Uint8Array[]): Uint8Array => {
  const salida = new Uint8Array(partes.reduce((total, parte) => total + parte.length, 0));
  let pos = 0;
  for (const parte of partes) {
    salida.set(parte, pos);
    pos += parte.length;
  }
  return salida;
};

function jpegSinMetadatos(bytes: Uint8Array, segmentos: readonly SegmentoDeJpeg[]): Uint8Array {
  const partes = [bytes.subarray(0, 2)]; // SOI
  for (const { marcador, inicio, fin } of segmentos) {
    if (marcador !== APP1 && marcador !== APP13) partes.push(bytes.subarray(inicio, fin));
  }
  return concatenar(partes);
}

const copiar = (bytes: Uint8Array, f: Fragmento): Uint8Array =>
  new Uint8Array(bytes.subarray(f.inicio, f.fin));

function webpSinMetadatos(bytes: Uint8Array, analisis: AnalisisDeWebp): Uint8Array {
  const cabeza = copiar(bytes, analisis.primero);
  if (analisis.primero.tipo === "VP8X") {
    // Las banderas son el primer byte de los datos del VP8X (después de su encabezado de 8 bytes).
    const vista = new DataView(cabeza.buffer);
    vista.setUint8(8, vista.getUint8(8) & ~BANDERAS_DE_METADATOS_DE_VP8X);
  }
  const cola = analisis.siguientes
    .filter((f) => f.tipo !== "EXIF" && f.tipo !== "XMP ")
    .map((f) => copiar(bytes, f));
  const cuerpo = concatenar([cabeza, ...cola]);
  const riff = new Uint8Array(12);
  riff.set(bytes.subarray(0, 12)); // «RIFF», el tamaño (se pisa enseguida) y «WEBP»
  new DataView(riff.buffer).setUint32(4, cuerpo.length + 4, true);
  return concatenar([riff, cuerpo]);
}

/** Una foto leída y con los metadatos quitados: lo que la carta guarda y sirve. */
export type AnalisisDeFoto = Readonly<{
  cabecera: CabeceraJpeg | CabeceraWebp;
  /** Los bytes ya sin metadatos. */
  bytes: Uint8Array;
}>;

/** Lee la cabecera de un JPEG o WebP y arma sus bytes sin metadatos, en una sola pasada. */
export function analizarFoto(bytes: Uint8Array): Resultado<AnalisisDeFoto, ErrorDeCabecera> {
  switch (detectarFormato(bytes)) {
    case "jpeg": {
      const jpeg = analizarJpeg(bytes);
      if (!jpeg.ok) return jpeg;
      return ok({
        cabecera: jpeg.valor.cabecera,
        bytes: jpegSinMetadatos(bytes, jpeg.valor.segmentos),
      });
    }
    case "webp": {
      const webp = analizarWebp(bytes);
      if (!webp.ok) return webp;
      return ok({
        cabecera: webp.valor.cabecera,
        bytes: webpSinMetadatos(bytes, webp.valor),
      });
    }
    default:
      return err("FORMATO_NO_RECONOCIDO");
  }
}

/** Los bytes de un JPEG o WebP sin sus metadatos; ver la nota del archivo. */
export function quitarMetadatos(bytes: Uint8Array): Resultado<Uint8Array, ErrorDeCabecera> {
  const analisis = analizarFoto(bytes);
  return analisis.ok ? ok(analisis.valor.bytes) : analisis;
}
