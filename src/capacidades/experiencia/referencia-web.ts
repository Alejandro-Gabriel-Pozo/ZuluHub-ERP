/**
 * Los 4 bytes de los que sale la referencia `ZH-XXXX-XXXX` de un error 500 de la web. Next le da a cada
 * error del servidor un `digest` (un número en texto) que ya queda en el registro del servidor; la
 * referencia se deriva de él, así soporte la encuentra en el registro sin que la pantalla muestre nada
 * interno (ADR-016). FNV-1a de 32 bits sobre el texto del digest: determinista, sin azar ni reloj.
 */
const BASE_DE_FNV = 0x811c9dc5;
const PRIMO_DE_FNV = 0x01000193;

export function bytesDeDigest(digest: string): Uint8Array {
  let hash = BASE_DE_FNV;
  for (let i = 0; i < digest.length; i += 1) {
    hash = Math.imul(hash ^ digest.charCodeAt(i), PRIMO_DE_FNV) >>> 0;
  }
  return new Uint8Array([hash >>> 24, (hash >>> 16) & 0xff, (hash >>> 8) & 0xff, hash & 0xff]);
}
