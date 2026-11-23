import { createHash } from "node:crypto";

/**
 * La huella canónica de un pedido a un libro: sha256 (hex, 64 caracteres) del contenido en JSON. Función pura del contenido (sin reloj
 * ni azar): el mismo pedido da siempre la misma huella y cualquier campo distinto da otra. Con la clave de idempotencia decide si un
 * reintento es el mismo pedido o una clave reutilizada. Los importes y las cantidades entran como texto decimal (ADR-006), nunca como
 * `number`.
 *
 * Es la copia única para los libros NUEVOS. Reproduce byte a byte la de caja (`huellaDeCampos`) y la de stock (`huellaDeComando`):
 * cambiar el formato haría que un reintento de algo ya guardado diera una falsa `CLAVE_REUTILIZADA`. Lo prueban los vectores dorados
 * de `huella.test.ts` (literales escritos a mano, sin importar esos módulos).
 *
 * Lo que NO entra en la huella lo decide quien arma el contenido: un `hechoEn` que no mandó la persona no debe entrar, o el reintento
 * de un clic doble daría otra huella.
 */
export type CampoDeHuella = string | number | null;
export type RenglonDeHuella = readonly CampoDeHuella[];

function sha256Hex(contenido: string): string {
  return createHash("sha256").update(contenido).digest("hex");
}

/** Mismo resultado que `huellaDeCampos` de caja: sha256 hex de `JSON.stringify(campos)`. */
export function huellaDeCampos(campos: readonly CampoDeHuella[]): string {
  return sha256Hex(JSON.stringify(campos));
}

/** Mismo resultado que `huellaDeComando` de stock: los renglones se ordenan ANTES de hashear (otro orden es el mismo pedido). */
export function huellaDeComando(
  operacion: string,
  cabecera: readonly CampoDeHuella[],
  renglones: readonly RenglonDeHuella[],
): string {
  const ordenados = renglones.map((renglon) => JSON.stringify(renglon)).sort();
  return sha256Hex(
    `[${JSON.stringify(operacion)},${JSON.stringify(cabecera)},[${ordenados.join(",")}]]`,
  );
}

export type DecisionPorHuella = "NUEVA" | "REPETIDA" | "CLAVE_REUTILIZADA";

/**
 * Qué hacer con una clave de idempotencia: nueva (nadie la usó); repetida (misma huella: se devuelve lo hecho sin escribir ni
 * auditar); o reutilizada (otra huella: es un error del cliente, no una repetición).
 */
export function decidirPorHuella(guardada: string | null, huella: string): DecisionPorHuella {
  if (guardada === null) return "NUEVA";
  return guardada === huella ? "REPETIDA" : "CLAVE_REUTILIZADA";
}
