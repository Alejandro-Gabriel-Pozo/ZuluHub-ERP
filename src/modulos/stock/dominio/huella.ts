import { createHash } from "node:crypto";

/**
 * La huella de un comando de stock: sha256 (hex, 64 caracteres) del contenido canónico, en JSON. Es una función pura del contenido (sin
 * reloj ni azar): el mismo pedido da siempre la misma huella y cualquier campo distinto da otra. Con la clave de idempotencia decide si un
 * reintento es el mismo pedido o una clave reutilizada (E5 §3.2). Los renglones se ordenan ANTES de hashear: dos pantallas que mandan
 * los mismos renglones en otro orden son el mismo pedido. Los importes y las cantidades entran como texto decimal (ADR-006), nunca como
 * `number`.
 *
 * Lo que NO entra en la huella lo decide quien arma el contenido: un `hechoEn` que no mandó la persona (es el `ahora` del contexto) no
 * debe entrar, o el reintento de un clic doble daría otra huella y una falsa `CLAVE_REUTILIZADA`.
 */
export type CampoDeHuella = string | number | null;
export type RenglonDeHuella = readonly CampoDeHuella[];

export function huellaDeComando(
  operacion: string,
  cabecera: readonly CampoDeHuella[],
  renglones: readonly RenglonDeHuella[],
): string {
  const ordenados = renglones.map((renglon) => JSON.stringify(renglon)).sort();
  const contenido = `[${JSON.stringify(operacion)},${JSON.stringify(cabecera)},[${ordenados.join(",")}]]`;
  return createHash("sha256").update(contenido).digest("hex");
}

/**
 * Qué hacer con una clave de idempotencia: nueva (nadie la usó); repetida (misma huella: se devuelve lo hecho sin escribir ni auditar);
 * o reutilizada (otra huella: es un error del cliente, no una repetición).
 */
export function decidirPorHuella(
  guardada: string | null,
  huella: string,
): "NUEVA" | "REPETIDA" | "CLAVE_REUTILIZADA" {
  if (guardada === null) return "NUEVA";
  return guardada === huella ? "REPETIDA" : "CLAVE_REUTILIZADA";
}
