import type { Marca } from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";

/**
 * Referencia de error (soporte, paso 1, H5 §B.5.9): un código corto, `PD-XXXX-XXXX` (8 dígitos
 * hexadecimales en mayúsculas), que se le muestra a quien recibió un rechazo para que se lo dicte a
 * soporte. No dice nada del negocio: solo permite encontrar el registro. Dominio puro: el azar entra
 * como dato (los bytes los sortea el llamador, fuera de la transacción).
 */
export type ReferenciaDeError = Marca<string, "ReferenciaDeError">;

/** Cuántos bytes de azar hacen falta: 4 bytes son 8 dígitos hexadecimales. */
export const BYTES_DE_UNA_REFERENCIA = 4;

const FORMA = /^PD-[0-9A-F]{4}-[0-9A-F]{4}$/;

/**
 * Arma la referencia con exactamente `BYTES_DE_UNA_REFERENCIA` bytes de azar. Cualquier otra
 * cantidad es un defecto del llamador y lanza `RangeError`: no se completa ni se recorta en silencio.
 */
export function referenciaDeError(aleatorio: Uint8Array): ReferenciaDeError {
  if (aleatorio.length !== BYTES_DE_UNA_REFERENCIA) {
    throw new RangeError(`la referencia necesita ${BYTES_DE_UNA_REFERENCIA} bytes de azar`);
  }
  const hexadecimal = Array.from(aleatorio, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return `PD-${hexadecimal.slice(0, 4)}-${hexadecimal.slice(4)}` as ReferenciaDeError;
}

/**
 * La referencia que alguien dictó o copió: se recortan los espacios y se pasa a mayúsculas, y tiene
 * que tener la forma exacta. Es lo que usa `soporte.buscar_referencia` antes de consultar.
 */
export function referenciaDesdeTexto(
  texto: string,
): Resultado<ReferenciaDeError, "REFERENCIA_INVALIDA"> {
  const normalizada = texto.trim().toUpperCase();
  return FORMA.test(normalizada)
    ? ok(normalizada as ReferenciaDeError)
    : err("REFERENCIA_INVALIDA");
}
