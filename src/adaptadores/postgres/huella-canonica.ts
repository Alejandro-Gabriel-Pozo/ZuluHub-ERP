import { createHash } from "node:crypto";
import type { ConsultaDeIdempotencia } from "../../puertos/idempotencia";
import type { Dato } from "../../puertos/sin-secretos";

/**
 * Lo puro de la idempotencia de plataforma: la forma de la clave y de la operación, la huella
 * canónica de una entrada y la decisión ante una fila existente. Sin base de datos: la mutación lo
 * prueba solo.
 */

/** La misma regla que `idempotencia_plataforma_clave_ck`: un test la compara con la base. */
const FORMA_DE_CLAVE = /^[A-Za-z0-9_-]{16,128}$/;
/** La misma regla que `idempotencia_plataforma_operacion_ck`. */
const FORMA_DE_OPERACION = /^[a-z_.]+$/;

export function claveDeIdempotenciaValida(clave: string): boolean {
  return FORMA_DE_CLAVE.test(clave);
}

export function operacionDeIdempotenciaValida(operacion: string): boolean {
  return FORMA_DE_OPERACION.test(operacion);
}

/** Lanza `RangeError` si la clave o la operación no tienen la forma que la base acepta. */
export function exigirClaveYOperacion(clave: string, operacion: string): void {
  if (!claveDeIdempotenciaValida(clave)) {
    throw new RangeError("idempotencia: la clave debe tener de 16 a 128 letras, números, _ o -");
  }
  if (!operacionDeIdempotenciaValida(operacion)) {
    throw new RangeError("idempotencia: la operación debe ser minúsculas, _ o .");
  }
}

/**
 * La forma canónica de un dato: JSON sin espacios y con las claves de cada objeto ordenadas, así dos
 * entradas iguales con los campos en otro orden dan el mismo texto. Rechaza (con `RangeError`) lo que
 * JSON.stringify cambiaría en silencio y haría colisionar dos entradas distintas: `undefined`, números
 * que no son finitos (saldrían como `null`), `bigint`, funciones y símbolos.
 */
export function formaCanonica(dato: Dato): string {
  if (dato === null) return "null";
  switch (typeof dato) {
    case "string":
      return JSON.stringify(dato);
    case "number":
      if (!Number.isFinite(dato)) throw new RangeError("idempotencia: número no finito");
      return JSON.stringify(dato);
    case "boolean":
      return dato ? "true" : "false";
    case "object": {
      if (Array.isArray(dato)) {
        return `[${(dato as readonly Dato[]).map(formaCanonica).join(",")}]`;
      }
      const objeto = dato as { readonly [campo: string]: Dato };
      const campos = Object.keys(objeto)
        .sort()
        .map((campo) => `${JSON.stringify(campo)}:${formaCanonica(objeto[campo] as Dato)}`);
      return `{${campos.join(",")}}`;
    }
    default:
      throw new RangeError(`idempotencia: un ${typeof dato} no se puede guardar`);
  }
}

/** sha256 en hexadecimal minúscula (64 caracteres) de la forma canónica (un texto, en UTF-8). */
export function huellaCanonica(dato: Dato): string {
  return createHash("sha256").update(formaCanonica(dato)).digest("hex");
}

/** La fila guardada de una clave, o `null` si nadie la usó. */
export type FilaDeIdempotencia = Readonly<{
  operacion: string;
  huella: string;
  resultado: Dato;
}>;

/**
 * Qué hacer con una clave: nueva; repetida (misma operación y misma huella: se devuelve lo guardado);
 * o reutilizada (otra operación u otra huella: es un error del cliente, no una repetición).
 */
export function decidirConsulta(
  guardada: FilaDeIdempotencia | null,
  operacion: string,
  huella: string,
): ConsultaDeIdempotencia {
  if (guardada === null) return { tipo: "NUEVA" };
  if (guardada.operacion !== operacion || guardada.huella !== huella) {
    return { tipo: "CLAVE_REUTILIZADA" };
  }
  return { tipo: "REPETIDA", resultado: guardada.resultado };
}
