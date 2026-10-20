import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";

/**
 * Lectores de cabecera de imágenes (marca e íconos §2.4 T3, y fotos de producto C-1). Trabajan sobre
 * `Uint8Array` sin decodificar píxeles: el servidor nunca abre la imagen, solo lee los campos de la
 * cabecera que dicen cuánto mide y si tiene transparencia. Son puros y totales: ante bytes hostiles
 * (longitudes inconsistentes, marcadores truncados, ciclos) devuelven un error con nombre; nunca
 * lanzan, nunca leen fuera de rango y siempre terminan (cada vuelta de cada bucle avanza al menos un
 * byte dentro de los datos).
 */

/** Por qué una cabecera no se pudo leer. Los códigos son estables: la pantalla los traduce. */
export type ErrorDeCabecera =
  /** La firma del archivo no es la del formato pedido. */
  | "FORMATO_NO_RECONOCIDO"
  /** Faltan bytes, o una longitud declarada se sale de los bytes que hay. */
  | "TRUNCADO"
  /** Los campos son incoherentes entre sí (medida cero, orden de bloques imposible, etc.). */
  | "CABECERA_INVALIDA"
  /** Formato válido, pero una variante que Pedernal no admite (p. ej. JPEG aritmético o sin pérdida). */
  | "VARIANTE_NO_ADMITIDA";

export type FormatoDeImagen = "png" | "webp" | "jpeg" | "ico";

export type CabeceraPng = Readonly<{
  formato: "png";
  ancho: number;
  alto: number;
  /** Tipo de color del IHDR: 0 grises, 2 RGB, 3 paleta, 4 grises con alfa, 6 RGBA. */
  tipoDeColor: number;
  /** Hay un fragmento `tRNS`: transparencia aun con tipo de color 0, 2 o 3. */
  conTrns: boolean;
  /** Hay un fragmento `acTL`: PNG animado (APNG). */
  animado: boolean;
}>;

export type CabeceraWebp = Readonly<{
  formato: "webp";
  ancho: number;
  alto: number;
  conAlfa: boolean;
  animado: boolean;
}>;

export type CabeceraJpeg = Readonly<{
  formato: "jpeg";
  ancho: number;
  alto: number;
  animado: false;
}>;

export type CabeceraIco = Readonly<{
  formato: "ico";
  imagenes: readonly Readonly<{ ancho: number; alto: number }>[];
}>;

/** Las imágenes con medidas propias y sin directorio (todas menos el ICO, que trae varias). */
export type CabeceraPlana = CabeceraPng | CabeceraWebp | CabeceraJpeg;

/**
 * Lo que `detectarFormato` reconoce; `svg` solo para poder rechazarlo con su propio motivo y
 * `desconocido` para todo lo demás (HEIC, GIF, HTML, vacío…).
 */
export type FormatoDetectado = FormatoDeImagen | "svg" | "desconocido";

// --- Utilidades sobre bytes -------------------------------------------------------------------------

const vistaDe = (bytes: Uint8Array): DataView =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/**
 * ¿Los bytes que empiezan en `desde` son exactamente `esperado`? Falso si no alcanzan: leer un índice
 * de más en un `Uint8Array` da `undefined`, que nunca es igual a un byte.
 */
const empiezaCon = (bytes: Uint8Array, desde: number, esperado: readonly number[]): boolean =>
  esperado.every((valor, i) => bytes[desde + i] === valor);

/** Cuatro caracteres ASCII desde `desde`; el llamador ya verificó que entran en los bytes. */
const cuatroCaracteres = (bytes: Uint8Array, desde: number): string =>
  String.fromCharCode(...bytes.subarray(desde, desde + 4));

const ascii = (texto: string): number[] => [...texto].map((c) => c.charCodeAt(0));

// --- Firmas -----------------------------------------------------------------------------------------

const FIRMA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const FIRMA_JPEG = [0xff, 0xd8, 0xff];
const FIRMA_ICO = [0x00, 0x00, 0x01, 0x00];
const RIFF = ascii("RIFF");
const WEBP = ascii("WEBP");

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

// --- PNG --------------------------------------------------------------------------------------------

/** Profundidades de bit que el estándar permite para cada tipo de color. */
const PROFUNDIDADES_DE_PNG: Readonly<Record<number, readonly number[]>> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};

/** Mayor medida que el estándar de PNG permite (2^31 - 1). */
const MEDIDA_MAXIMA_DE_PNG = 0x7fffffff;

/**
 * Lee el IHDR y recorre los fragmentos hasta IEND (cada uno entero dentro de los bytes): así un PNG
 * cortado se rechaza como `TRUNCADO` y se ve si hay `tRNS` (transparencia por color) o `acTL`
 * (animación). No verifica los CRC ni descomprime nada.
 */
export function leerPng(bytes: Uint8Array): Resultado<CabeceraPng, ErrorDeCabecera> {
  if (!empiezaCon(bytes, 0, FIRMA_PNG)) return err("FORMATO_NO_RECONOCIDO");
  // 8 de firma + largo (4) + tipo (4) + los 13 bytes de datos del IHDR, hasta el entrelazado.
  if (bytes.length < 29) return err("TRUNCADO");
  const v = vistaDe(bytes);
  if (v.getUint32(8) !== 13 || cuatroCaracteres(bytes, 12) !== "IHDR") {
    return err("CABECERA_INVALIDA");
  }
  const ancho = v.getUint32(16);
  const alto = v.getUint32(20);
  const profundidad = v.getUint8(24);
  const tipoDeColor = v.getUint8(25);
  const entrelazado = v.getUint8(28);
  if (ancho === 0 || alto === 0 || ancho > MEDIDA_MAXIMA_DE_PNG || alto > MEDIDA_MAXIMA_DE_PNG) {
    return err("CABECERA_INVALIDA");
  }
  const profundidades = PROFUNDIDADES_DE_PNG[tipoDeColor];
  if (
    profundidades === undefined ||
    !profundidades.includes(profundidad) ||
    v.getUint8(26) !== 0 || // compresión
    v.getUint8(27) !== 0 || // filtro
    entrelazado > 1
  ) {
    return err("CABECERA_INVALIDA");
  }

  let conTrns = false;
  let animado = false;
  let hayDatos = false;
  let pos = 33;
  for (;;) {
    if (pos + 12 > bytes.length) return err("TRUNCADO");
    const tipo = cuatroCaracteres(bytes, pos + 4);
    const siguiente = pos + 12 + v.getUint32(pos);
    if (siguiente > bytes.length) return err("TRUNCADO");
    if (tipo === "IEND") break;
    if (tipo === "IDAT") hayDatos = true;
    if (tipo === "tRNS") conTrns = true;
    if (tipo === "acTL") animado = true;
    pos = siguiente;
  }
  if (!hayDatos) return err("CABECERA_INVALIDA");
  return ok({ formato: "png", ancho, alto, tipoDeColor, conTrns, animado });
}

/**
 * ¿Un PNG es opaco para el apple-touch? Solo los tipos de color 0 (grises) y 2 (RGB) sin `tRNS`
 * (decisión de [02] §2.4: «tipo de color 0 o 2»; la paleta se rechaza aunque no declare alfa).
 */
export const pngEsOpaco = (cabecera: CabeceraPng): boolean =>
  (cabecera.tipoDeColor === 0 || cabecera.tipoDeColor === 2) && !cabecera.conTrns;

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

// --- JPEG -------------------------------------------------------------------------------------------

/** Un segmento del JPEG: `[inicio, fin)` incluye el marcador `FF xx`, el largo y, en el SOS, el escaneo. */
export type SegmentoDeJpeg = Readonly<{ marcador: number; inicio: number; fin: number }>;

export type AnalisisDeJpeg = Readonly<{
  cabecera: CabeceraJpeg;
  /** Todos los segmentos después del SOI, el último es el EOI. */
  segmentos: readonly SegmentoDeJpeg[];
}>;

/** Marcadores de comienzo de cuadro (SOF): C0 a CF salvo DHT (C4), JPG (C8) y DAC (CC). */
const esSof = (marcador: number): boolean =>
  marcador >= 0xc0 &&
  marcador <= 0xcf &&
  marcador !== 0xc4 &&
  marcador !== 0xc8 &&
  marcador !== 0xcc;

const SOF0 = 0xc0; // base secuencial
const SOF2 = 0xc2; // progresivo
const SOS = 0xda;
const EOI = 0xd9;

/**
 * Recorre TODA la estructura de marcadores del JPEG, incluidos los datos de los escaneos, hasta el EOI:
 * un segmento de metadatos escondido entre dos escaneos también aparece. Admite solo SOF0 y SOF2 de 8
 * bits y un único cuadro (dos SOF serían medidas ambiguas). Los bytes después del EOI no son parte de
 * la imagen y se ignoran. Cada segmento con largo declara `largo >= 2` y tiene que entrar en los bytes.
 */
export function analizarJpeg(bytes: Uint8Array): Resultado<AnalisisDeJpeg, ErrorDeCabecera> {
  if (!empiezaCon(bytes, 0, FIRMA_JPEG)) return err("FORMATO_NO_RECONOCIDO");
  const v = vistaDe(bytes);
  const segmentos: SegmentoDeJpeg[] = [];
  type Medidas = Readonly<{ ancho: number; alto: number }>;
  let cuadro: Medidas | null = null;
  let imagen: Medidas | null = null; // las medidas, una vez que hubo un escaneo
  let pos = 2; // el SOI ocupa los bytes 0 y 1; la firma garantiza un FF en el 2
  for (;;) {
    if (pos >= bytes.length) return err("TRUNCADO");
    if (v.getUint8(pos) !== 0xff) return err("CABECERA_INVALIDA");
    // Cualquier cantidad de FF de relleno puede preceder al marcador: el segmento empieza en el último.
    let inicio = pos;
    while (inicio + 1 < bytes.length && v.getUint8(inicio + 1) === 0xff) inicio++;
    if (inicio + 1 >= bytes.length) return err("TRUNCADO");
    const marcador = v.getUint8(inicio + 1);

    if (marcador === EOI) {
      // Sin ningún escaneo no hay imagen.
      if (imagen === null) return err("CABECERA_INVALIDA");
      segmentos.push({ marcador, inicio, fin: inicio + 2 });
      return ok({ cabecera: { formato: "jpeg", ...imagen, animado: false }, segmentos });
    }
    // 00 (relleno de datos), 01 (TEM), RSTn (D0-D7) y SOI (D8): sin largo y fuera de lugar acá.
    if (marcador <= 0x01 || (marcador >= 0xd0 && marcador <= 0xd8)) return err("CABECERA_INVALIDA");

    if (inicio + 4 > bytes.length) return err("TRUNCADO");
    const largo = v.getUint16(inicio + 2);
    if (largo < 2) return err("CABECERA_INVALIDA");
    const fin = inicio + 2 + largo;
    if (fin > bytes.length) return err("TRUNCADO");

    if (esSof(marcador)) {
      if (marcador !== SOF0 && marcador !== SOF2) return err("VARIANTE_NO_ADMITIDA");
      // 8 bytes fijos (largo, precisión, alto, ancho y cantidad de componentes) y 3 por componente, al menos 1.
      if (cuadro !== null || largo < 11) return err("CABECERA_INVALIDA");
      const componentes = v.getUint8(inicio + 9);
      const alto = v.getUint16(inicio + 5);
      const ancho = v.getUint16(inicio + 7);
      if (
        v.getUint8(inicio + 4) !== 8 || // precisión
        largo !== 8 + 3 * componentes ||
        ancho === 0 ||
        alto === 0
      ) {
        return err("CABECERA_INVALIDA");
      }
      cuadro = { ancho, alto };
    }

    if (marcador !== SOS) {
      segmentos.push({ marcador, inicio, fin });
      pos = fin;
      continue;
    }

    // SOS: tras su encabezado vienen los datos entropía; terminan en el próximo marcador que no sea
    // un FF 00 (byte relleno), un RSTn ni un FF de relleno.
    if (cuadro === null) return err("CABECERA_INVALIDA");
    imagen = cuadro;
    let desde = fin;
    for (;;) {
      const ff = bytes.indexOf(0xff, desde);
      if (ff === -1 || ff + 1 >= bytes.length) return err("TRUNCADO");
      const siguiente = v.getUint8(ff + 1);
      if (siguiente === 0x00 || (siguiente >= 0xd0 && siguiente <= 0xd7)) {
        desde = ff + 2;
      } else if (siguiente === 0xff) {
        desde = ff + 1;
      } else {
        pos = ff;
        break;
      }
    }
    segmentos.push({ marcador, inicio, fin: pos });
  }
}

export function leerJpeg(bytes: Uint8Array): Resultado<CabeceraJpeg, ErrorDeCabecera> {
  const analisis = analizarJpeg(bytes);
  return analisis.ok ? ok(analisis.valor.cabecera) : analisis;
}

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
