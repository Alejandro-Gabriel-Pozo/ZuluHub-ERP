/**
 * Utilidades sobre bytes y firmas de los formatos de imagen que reconocen los lectores de cabecera. Puras y
 * totales: nunca leen fuera de rango (un índice de más en un `Uint8Array` da `undefined`).
 */

// --- Utilidades sobre bytes -------------------------------------------------------------------------

export const vistaDe = (bytes: Uint8Array): DataView =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/**
 * ¿Los bytes que empiezan en `desde` son exactamente `esperado`? Falso si no alcanzan: leer un índice
 * de más en un `Uint8Array` da `undefined`, que nunca es igual a un byte.
 */
export const empiezaCon = (
  bytes: Uint8Array,
  desde: number,
  esperado: readonly number[],
): boolean => esperado.every((valor, i) => bytes[desde + i] === valor);

/** Cuatro caracteres ASCII desde `desde`; el llamador ya verificó que entran en los bytes. */
export const cuatroCaracteres = (bytes: Uint8Array, desde: number): string =>
  String.fromCharCode(...bytes.subarray(desde, desde + 4));

export const ascii = (texto: string): number[] => [...texto].map((c) => c.charCodeAt(0));

// --- Firmas -----------------------------------------------------------------------------------------

export const FIRMA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const FIRMA_JPEG = [0xff, 0xd8, 0xff];
export const FIRMA_ICO = [0x00, 0x00, 0x01, 0x00];
export const RIFF = ascii("RIFF");
export const WEBP = ascii("WEBP");
