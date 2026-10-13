import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import {
  detectarFormato,
  esOpaca,
  leerCabecera,
  leerIco,
  type ErrorDeCabecera,
  type FormatoDeImagen,
} from "./cabeceras";
import { analizarFoto } from "./limpieza";

/**
 * Validación de archivos de imagen por sus bytes, sin decodificar: los activos de marca (ranuras cerradas
 * de [02] §2.1, los revisa el CI sobre `activos-de-marca/`) y las fotos de producto (carta C-1, las revisa
 * el servidor antes de guardar o servir). Por qué ranuras cerradas y no «subí lo que quieras»: el ícono
 * que existe pero con el tamaño o el formato equivocado se ve deformado en el celular y nadie lo nota en
 * una revisión; esta validación lo frena con su motivo (A2).
 */

/** Por qué un archivo no sirve para su ranura o su variante. Los códigos son estables. */
export type ErrorDeArchivo =
  | ErrorDeCabecera
  /** Es otro formato que el que pide la ranura (PNG donde va ICO, HEIC, GIF, HTML…). */
  | "FORMATO_NO_ADMITIDO"
  /** SVG: podría ejecutar código y ZuluHub no lo acepta en ninguna ranura. */
  | "SVG_NO_ADMITIDO"
  | "PESO_EXCEDIDO"
  | "DIMENSIONES_INCORRECTAS"
  /** La ranura exige opacidad y el archivo tiene (o puede tener) transparencia. */
  | "NO_ES_OPACO"
  /** WebP o PNG animado: los activos y las fotos son estáticos. */
  | "ANIMADO";

/** Un kilobyte, decimal (1000 bytes): el más estricto de los dos usos, así un «300 KB» nunca se pasa. */
export const KB = 1000;

/** Mayor medida de un logo: un archivo chico puede declarar un lienzo gigante (bomba de descompresión). */
export const MEDIDA_MAXIMA_DE_LOGO = 4096;

type Rango = Readonly<{ minimo: number; maximo: number }>;
const exacta = (medida: number): Rango => ({ minimo: medida, maximo: medida });

type ReglaDeImagen = Readonly<{
  tipo: "IMAGEN";
  formatos: readonly FormatoDeImagen[];
  pesoMaximo: number;
  ancho: Rango;
  alto: Rango;
  /** Sin canal alfa ni transparencia. */
  opaca: boolean;
}>;

type ReglaDeIco = Readonly<{
  tipo: "ICO";
  pesoMaximo: number;
  /** Conjuntos de lados cuadrados admitidos (ordenados de menor a mayor). */
  ladosAdmitidos: readonly (readonly number[])[];
}>;

const logo: ReglaDeImagen = {
  tipo: "IMAGEN",
  formatos: ["png", "webp"],
  pesoMaximo: 100 * KB,
  ancho: { minimo: 1, maximo: MEDIDA_MAXIMA_DE_LOGO },
  alto: { minimo: 64, maximo: MEDIDA_MAXIMA_DE_LOGO },
  opaca: false,
};

/**
 * Las ranuras de `activos.*` y lo que exige cada una ([02] §2.1). Pesos que el spec no fija
 * (ASUMIDO): íconos 192 y 180, 100 KB; ícono 512, 200 KB; `logo_sobre_primario`, como el `logo`.
 */
export const REGLAS_DE_RANURA = {
  icono_192: {
    tipo: "IMAGEN",
    formatos: ["png"],
    pesoMaximo: 100 * KB,
    ancho: exacta(192),
    alto: exacta(192),
    opaca: false,
  },
  icono_apple_180: {
    tipo: "IMAGEN",
    formatos: ["png"],
    pesoMaximo: 100 * KB,
    ancho: exacta(180),
    alto: exacta(180),
    opaca: true,
  },
  icono_512: {
    tipo: "IMAGEN",
    formatos: ["png"],
    pesoMaximo: 200 * KB,
    ancho: exacta(512),
    alto: exacta(512),
    opaca: false,
  },
  favicon_ico: {
    tipo: "ICO",
    pesoMaximo: 20 * KB,
    ladosAdmitidos: [[32], [16, 32]],
  },
  logo,
  logo_sobre_primario: logo,
  logo_correo: {
    tipo: "IMAGEN",
    formatos: ["png"],
    pesoMaximo: 50 * KB,
    ancho: { minimo: 1, maximo: 600 },
    alto: { minimo: 1, maximo: MEDIDA_MAXIMA_DE_LOGO },
    opaca: false,
  },
  imagen_social: {
    tipo: "IMAGEN",
    formatos: ["png", "jpeg"],
    pesoMaximo: 300 * KB,
    ancho: exacta(1200),
    alto: exacta(630),
    opaca: false,
  },
} as const satisfies Record<string, ReglaDeImagen | ReglaDeIco>;

export type RanuraDeActivo = keyof typeof REGLAS_DE_RANURA;

export const RANURAS_DE_ACTIVO = Object.keys(REGLAS_DE_RANURA) as RanuraDeActivo[];

/** Lo que se sabe de un archivo aceptado. En un ICO, las medidas son las de su imagen más grande. */
export type ArchivoDeActivo = Readonly<{ formato: FormatoDeImagen; ancho: number; alto: number }>;

const enRango = (valor: number, rango: Rango): boolean =>
  valor >= rango.minimo && valor <= rango.maximo;

/**
 * El formato reconocido por la firma tiene que estar entre los admitidos. Un SVG se nombra aparte.
 * Devuelve el motivo del rechazo, o null si pasa.
 */
function rechazoPorFormato(
  bytes: Uint8Array,
  admitidos: readonly FormatoDeImagen[],
): ErrorDeArchivo | null {
  const formato = detectarFormato(bytes);
  if (formato === "svg") return "SVG_NO_ADMITIDO";
  if (formato === null || !admitidos.includes(formato)) return "FORMATO_NO_ADMITIDO";
  return null;
}

function validarIco(
  regla: ReglaDeIco,
  bytes: Uint8Array,
): Resultado<ArchivoDeActivo, ErrorDeArchivo> {
  const rechazo = rechazoPorFormato(bytes, ["ico"]);
  if (rechazo !== null) return err(rechazo);
  if (bytes.length > regla.pesoMaximo) return err("PESO_EXCEDIDO");
  const ico = leerIco(bytes);
  if (!ico.ok) return ico;
  // Cada imagen tiene que ser cuadrada; una que no lo es cuenta como lado 0 y no coincide con nada.
  const lados = ico.valor.imagenes
    .map((i) => (i.ancho === i.alto ? i.ancho : 0))
    .sort((a, b) => a - b);
  const admitido = regla.ladosAdmitidos.some(
    (conjunto) => conjunto.length === lados.length && conjunto.every((l, i) => l === lados[i]),
  );
  if (!admitido) return err("DIMENSIONES_INCORRECTAS");
  const lado = Math.max(...lados);
  return ok({ formato: "ico", ancho: lado, alto: lado });
}

function validarImagen(
  regla: ReglaDeImagen,
  bytes: Uint8Array,
): Resultado<ArchivoDeActivo, ErrorDeArchivo> {
  const rechazo = rechazoPorFormato(bytes, regla.formatos);
  if (rechazo !== null) return err(rechazo);
  if (bytes.length > regla.pesoMaximo) return err("PESO_EXCEDIDO");
  const cabecera = leerCabecera(bytes);
  if (!cabecera.ok) return cabecera;
  const c = cabecera.valor;
  if (c.animado) return err("ANIMADO");
  if (!enRango(c.ancho, regla.ancho) || !enRango(c.alto, regla.alto)) {
    return err("DIMENSIONES_INCORRECTAS");
  }
  if (regla.opaca && !esOpaca(c)) return err("NO_ES_OPACO");
  return ok({ formato: c.formato, ancho: c.ancho, alto: c.alto });
}

/**
 * Valida un archivo contra su ranura: firma y formato, peso, medidas leídas de la cabecera (en un ICO, las
 * de cada imagen), que no sea animado y, en el apple-touch, que sea opaco. El orden es el de menor a mayor
 * trabajo: nada se lee más allá de la cabecera si el formato o el peso ya lo descartan.
 */
export function validarArchivoDeActivo(
  ranura: RanuraDeActivo,
  bytes: Uint8Array,
): Resultado<ArchivoDeActivo, ErrorDeArchivo> {
  const regla: ReglaDeImagen | ReglaDeIco = REGLAS_DE_RANURA[ranura];
  return regla.tipo === "ICO" ? validarIco(regla, bytes) : validarImagen(regla, bytes);
}

/** Las dos variantes de cada foto de producto (carta §5.2): chica para listas, grande para la tarjeta. */
export const VARIANTES_DE_FOTO = {
  "480": { ancho: 480, alto: 360, pesoMaximo: 80 * KB },
  "1200": { ancho: 1200, alto: 900, pesoMaximo: 300 * KB },
} as const;

export type VarianteDeFoto = keyof typeof VARIANTES_DE_FOTO;

/** Una foto aceptada, con sus bytes ya sin metadatos: lo único que se guarda y se sirve. */
export type FotoDeProducto = Readonly<{
  formato: "jpeg" | "webp";
  ancho: number;
  alto: number;
  bytes: Uint8Array;
}>;

/**
 * Valida una foto de producto por sus bytes (carta C-1): solo JPEG o WebP (HEIC, PNG, GIF, SVG y todo lo
 * demás se rechaza), peso máximo de la variante sobre los bytes recibidos, medidas EXACTAS de la variante
 * leídas de la cabecera, y estática. Devuelve los bytes sin metadatos (EXIF, XMP, IPTC): la ubicación
 * GPS nunca se guarda. El servidor no decodifica píxeles.
 */
export function validarFotoDeProducto(
  variante: VarianteDeFoto,
  bytes: Uint8Array,
): Resultado<FotoDeProducto, ErrorDeArchivo> {
  const regla = VARIANTES_DE_FOTO[variante];
  const rechazo = rechazoPorFormato(bytes, ["jpeg", "webp"]);
  if (rechazo !== null) return err(rechazo);
  if (bytes.length > regla.pesoMaximo) return err("PESO_EXCEDIDO");
  const analisis = analizarFoto(bytes);
  if (!analisis.ok) return analisis;
  const { cabecera, bytes: limpios } = analisis.valor;
  if (cabecera.animado) return err("ANIMADO");
  if (cabecera.ancho !== regla.ancho || cabecera.alto !== regla.alto) {
    return err("DIMENSIONES_INCORRECTAS");
  }
  return ok({
    formato: cabecera.formato,
    ancho: cabecera.ancho,
    alto: cabecera.alto,
    bytes: limpios,
  });
}
