import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import { cuatroCaracteres, empiezaCon, RIFF, vistaDe, WEBP } from "./bytes-de-imagen";
import type { CabeceraWebp, ErrorDeCabecera } from "./tipos-de-cabecera";

// --- WebP (contenedor RIFF) ---------------------------------------------------------------------------

/** Un fragmento (chunk) del contenedor RIFF: `inicio` es el de su encabezado de 8 bytes. */
export type Fragmento = Readonly<{
  tipo: string;
  inicio: number;
  /** Bytes de datos, sin el relleno. */
  largo: number;
  /** Primer byte después del fragmento y de su relleno a par. */
  fin: number;
}>;

/**
 * Parte el contenedor RIFF en fragmentos. El tamaño declarado en el encabezado no puede pasar de los
 * bytes que hay, y cada fragmento (con su relleno a par) tiene que entrar en ese tamaño. Los bytes
 * que sobren después del tamaño declarado se ignoran.
 */
export function fragmentosDeRiff(
  bytes: Uint8Array,
): Resultado<readonly Fragmento[], ErrorDeCabecera> {
  if (!empiezaCon(bytes, 0, RIFF) || !empiezaCon(bytes, 8, WEBP)) {
    return err("FORMATO_NO_RECONOCIDO");
  }
  const v = vistaDe(bytes);
  const fin = v.getUint32(4, true) + 8;
  if (fin > bytes.length) return err("TRUNCADO");
  const fragmentos: Fragmento[] = [];
  let pos = 12;
  while (pos < fin) {
    if (pos + 8 > fin) return err("TRUNCADO");
    const largo = v.getUint32(pos + 4, true);
    const siguiente = pos + 8 + largo + (largo % 2);
    if (siguiente > fin) return err("TRUNCADO");
    fragmentos.push({ tipo: cuatroCaracteres(bytes, pos), inicio: pos, largo, fin: siguiente });
    pos = siguiente;
  }
  return ok(fragmentos);
}

type MedidasDeFragmento = Readonly<{ ancho: number; alto: number; alfa: boolean }>;

/** Medidas de un fragmento `VP8 ` (con pérdida) o `VP8L` (sin pérdida), o null si no son coherentes. */
function medidasDeImagenWebp(bytes: Uint8Array, f: Fragmento): MedidasDeFragmento | null {
  const v = vistaDe(bytes);
  const d = f.inicio + 8;
  if (f.tipo === "VP8 ") {
    // Cuadro clave (bit 0 en 0), código de arranque 9D 01 2A y medidas en 14 bits (los 2 altos son escala).
    if (
      f.largo < 10 ||
      (v.getUint8(d) & 1) !== 0 ||
      !empiezaCon(bytes, d + 3, [0x9d, 0x01, 0x2a])
    ) {
      return null;
    }
    const ancho = v.getUint16(d + 6, true) & 0x3fff;
    const alto = v.getUint16(d + 8, true) & 0x3fff;
    return ancho === 0 || alto === 0 ? null : { ancho, alto, alfa: false };
  }
  // VP8L: firma 0x2F, 14 bits de ancho-1, 14 de alto-1, 1 de alfa y 3 de versión (tiene que ser 0).
  if (f.largo < 5 || v.getUint8(d) !== 0x2f) return null;
  const bits = v.getUint32(d + 1, true);
  if (bits >>> 29 !== 0) return null;
  return {
    ancho: (bits & 0x3fff) + 1,
    alto: ((bits >>> 14) & 0x3fff) + 1,
    alfa: (bits >>> 28) % 2 === 1,
  };
}

/** Bits del byte de banderas de VP8X. */
const VP8X_ALFA = 0x10;
const VP8X_ANIMACION = 0x02;

export type AnalisisDeWebp = Readonly<{
  cabecera: CabeceraWebp;
  /** El primer fragmento: `VP8X`, `VP8 ` o `VP8L`. */
  primero: Fragmento;
  siguientes: readonly Fragmento[];
}>;

/**
 * Lee un WebP: simple (`VP8 ` o `VP8L` como primer fragmento) o extendido (`VP8X` primero, con las
 * banderas de alfa y animación y el lienzo). En el extendido estático, el lienzo tiene que coincidir con
 * las medidas del fragmento de imagen: si no, la cabecera mentiría sobre lo que se decodifica.
 */
export function analizarWebp(bytes: Uint8Array): Resultado<AnalisisDeWebp, ErrorDeCabecera> {
  const partido = fragmentosDeRiff(bytes);
  if (!partido.ok) return partido;
  const [primero, ...siguientes] = partido.valor;
  if (primero === undefined) return err("CABECERA_INVALIDA");
  const v = vistaDe(bytes);

  if (primero.tipo === "VP8X") {
    if (primero.largo !== 10) return err("CABECERA_INVALIDA");
    const d = primero.inicio + 8;
    const banderas = v.getUint8(d);
    const ancho = (v.getUint8(d + 4) | (v.getUint8(d + 5) << 8) | (v.getUint8(d + 6) << 16)) + 1;
    const alto = (v.getUint8(d + 7) | (v.getUint8(d + 8) << 8) | (v.getUint8(d + 9) << 16)) + 1;
    const animado = (banderas & VP8X_ANIMACION) !== 0;
    let conAlfa = (banderas & VP8X_ALFA) !== 0 || siguientes.some((f) => f.tipo === "ALPH");
    if (!animado) {
      const imagen = siguientes.find((f) => f.tipo === "VP8 " || f.tipo === "VP8L");
      if (imagen === undefined) return err("CABECERA_INVALIDA");
      const medidas = medidasDeImagenWebp(bytes, imagen);
      if (medidas === null || medidas.ancho !== ancho || medidas.alto !== alto) {
        return err("CABECERA_INVALIDA");
      }
      conAlfa ||= medidas.alfa;
    }
    return ok({
      cabecera: { formato: "webp", ancho, alto, conAlfa, animado },
      primero,
      siguientes,
    });
  }

  if (primero.tipo !== "VP8 " && primero.tipo !== "VP8L") return err("CABECERA_INVALIDA");
  const medidas = medidasDeImagenWebp(bytes, primero);
  if (medidas === null) return err("CABECERA_INVALIDA");
  const { ancho, alto, alfa } = medidas;
  return ok({
    cabecera: { formato: "webp", ancho, alto, conAlfa: alfa, animado: false },
    primero,
    siguientes,
  });
}

export function leerWebp(bytes: Uint8Array): Resultado<CabeceraWebp, ErrorDeCabecera> {
  const analisis = analizarWebp(bytes);
  return analisis.ok ? ok(analisis.valor.cabecera) : analisis;
}
