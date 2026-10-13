import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Ayudantes de las pruebas de imágenes (`src/capacidades/activos`): los archivos reales de
 * `test/fixtures/` y constructores de bytes mínimos y estructuralmente válidos (no se pueden decodificar
 * como imagen: solo tienen lo que los lectores de cabecera miran) para armar casos de borde exactos.
 */

const RAIZ = fileURLToPath(new URL("../fixtures/", import.meta.url));

/** Un archivo de `test/fixtures/<carpeta>/<nombre>`, como `Uint8Array` común (no `Buffer`). */
export function fixture(carpeta: "activos" | "fotos", nombre: string): Uint8Array {
  return new Uint8Array(readFileSync(`${RAIZ}${carpeta}/${nombre}`));
}

export const bytesDe = (...partes: (number | readonly number[] | Uint8Array)[]): Uint8Array =>
  Uint8Array.from(partes.flatMap((p) => (typeof p === "number" ? [p] : [...p])));

export const ascii = (texto: string): number[] => [...texto].map((c) => c.charCodeAt(0));

export const u16be = (n: number): number[] => [(n >>> 8) & 0xff, n & 0xff];
export const u32be = (n: number): number[] => [
  (n >>> 24) & 0xff,
  (n >>> 16) & 0xff,
  (n >>> 8) & 0xff,
  n & 0xff,
];
export const u16le = (n: number): number[] => [n & 0xff, (n >>> 8) & 0xff];
export const u32le = (n: number): number[] => [
  n & 0xff,
  (n >>> 8) & 0xff,
  (n >>> 16) & 0xff,
  (n >>> 24) & 0xff,
];

/** Copia con el contenido en el medio de un buffer más grande, rodeado de basura: una vista con `byteOffset`. */
export function enVista(bytes: Uint8Array, relleno = 0xa5): Uint8Array {
  const grande = new Uint8Array(bytes.length + 40).fill(relleno);
  grande.set(bytes, 17);
  return grande.subarray(17, 17 + bytes.length);
}

// --- PNG ---------------------------------------------------------------------------------------------

export const FIRMA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export const fragmentoPng = (tipo: string, datos: readonly number[] = []): number[] => [
  ...u32be(datos.length),
  ...ascii(tipo),
  ...datos,
  0,
  0,
  0,
  0, // el CRC no se verifica
];

export type OpcionesDePng = {
  ancho?: number;
  alto?: number;
  profundidad?: number;
  tipoDeColor?: number;
  compresion?: number;
  filtro?: number;
  entrelazado?: number;
  /** Fragmentos entre el IHDR y el IEND, en orden. Por defecto un IDAT. */
  fragmentos?: readonly number[][];
  conIend?: boolean;
};

export function construirPng(o: OpcionesDePng = {}): Uint8Array {
  const ihdr = [
    ...u32be(o.ancho ?? 192),
    ...u32be(o.alto ?? 192),
    o.profundidad ?? 8,
    o.tipoDeColor ?? 2,
    o.compresion ?? 0,
    o.filtro ?? 0,
    o.entrelazado ?? 0,
  ];
  return bytesDe(
    FIRMA_PNG,
    fragmentoPng("IHDR", ihdr),
    ...(o.fragmentos ?? [fragmentoPng("IDAT", [1, 2, 3])]),
    o.conIend === false ? [] : fragmentoPng("IEND"),
  );
}

// --- RIFF / WebP -------------------------------------------------------------------------------------

/** Un fragmento RIFF con su relleno a par (el largo declarado es el de los datos). */
export const fragmentoRiff = (tipo: string, datos: readonly number[]): number[] => [
  ...ascii(tipo),
  ...u32le(datos.length),
  ...datos,
  ...(datos.length % 2 === 1 ? [0] : []),
];

/** Un contenedor RIFF/WEBP con el tamaño declarado correcto (o el que se pida). */
export function construirRiff(
  fragmentos: readonly number[][],
  tamanoDeclarado?: number,
  cola: readonly number[] = [],
): Uint8Array {
  const cuerpo = fragmentos.flat();
  return bytesDe(
    ascii("RIFF"),
    u32le(tamanoDeclarado ?? cuerpo.length + 4),
    ascii("WEBP"),
    cuerpo,
    cola,
  );
}

/** Datos de un `VP8 ` con cuadro clave: 3 bytes de etiqueta, código de arranque, medidas en 14 bits. */
export const datosVp8 = (ancho: number, alto: number, extra: readonly number[] = []): number[] => [
  0x10,
  0x02,
  0x00,
  0x9d,
  0x01,
  0x2a,
  ...u16le(ancho),
  ...u16le(alto),
  ...extra,
];

/** Datos de un `VP8L`: firma 0x2F y medidas-1 en 14 bits, alfa en 1 y versión en 3. */
export function datosVp8l(ancho: number, alto: number, alfa = false, version = 0): number[] {
  const bits = ((ancho - 1) | ((alto - 1) << 14) | ((alfa ? 1 : 0) << 28) | (version << 29)) >>> 0;
  return [0x2f, ...u32le(bits), 0, 0, 0];
}

/** Datos de un `VP8X`: banderas, 3 reservados y lienzo (ancho-1, alto-1) en 24 bits cada uno. */
export function datosVp8x(banderas: number, ancho: number, alto: number): number[] {
  const tres = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff];
  return [banderas, 0, 0, 0, ...tres(ancho - 1), ...tres(alto - 1)];
}

export const webpVp8 = (ancho: number, alto: number): Uint8Array =>
  construirRiff([fragmentoRiff("VP8 ", datosVp8(ancho, alto, [1, 2, 3, 4, 5, 6]))]);

export const BANDERA_ALFA = 0x10;
export const BANDERA_EXIF = 0x08;
export const BANDERA_XMP = 0x04;
export const BANDERA_ANIMACION = 0x02;

// --- JPEG --------------------------------------------------------------------------------------------

/** Un segmento con largo: `FF marcador largo datos`. */
export const segmentoJpeg = (marcador: number, datos: readonly number[]): number[] => [
  0xff,
  marcador,
  ...u16be(datos.length + 2),
  ...datos,
];

export function sof(
  ancho: number,
  alto: number,
  o: { marcador?: number; precision?: number; componentes?: number } = {},
): number[] {
  const componentes = o.componentes ?? 3;
  return segmentoJpeg(o.marcador ?? 0xc0, [
    o.precision ?? 8,
    ...u16be(alto),
    ...u16be(ancho),
    componentes,
    ...Array.from({ length: componentes }, (_, i) => [i + 1, 0x11, 0]).flat(),
  ]);
}

/** Un SOS de un componente seguido de datos entropía que mezclan relleno de byte y un RST. */
export const escaneo = (
  entropia: readonly number[] = [0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56],
) => [...segmentoJpeg(0xda, [1, 1, 0, 0, 0x3f, 0]), ...entropia];

export const SOI = [0xff, 0xd8];
export const EOI = [0xff, 0xd9];

/** Un JPEG mínimo: SOI, lo que se pase antes, SOF, escaneo y EOI. */
export function construirJpeg(
  o: {
    ancho?: number;
    alto?: number;
    antes?: readonly number[];
    entre?: readonly number[];
    despues?: readonly number[];
    cola?: readonly number[];
  } = {},
): Uint8Array {
  return bytesDe(
    SOI,
    o.antes ?? [],
    sof(o.ancho ?? 480, o.alto ?? 360),
    o.entre ?? [],
    escaneo(),
    o.despues ?? [],
    EOI,
    o.cola ?? [],
  );
}

// --- ICO ---------------------------------------------------------------------------------------------

export type EntradaDeIco = { ancho: number; alto: number; tamano: number; desde: number };

/** Directorio de ICO (tipo 1) con las entradas dadas, seguido de `relleno` bytes de datos. */
export function construirIco(entradas: readonly EntradaDeIco[], relleno: number): Uint8Array {
  return bytesDe(
    [0, 0, 1, 0],
    u16le(entradas.length),
    ...entradas.map((e) => [
      e.ancho & 0xff, // 0 = 256
      e.alto & 0xff,
      0,
      0,
      ...u16le(1),
      ...u16le(32),
      ...u32le(e.tamano),
      ...u32le(e.desde),
    ]),
    new Array<number>(relleno).fill(0xee),
  );
}
