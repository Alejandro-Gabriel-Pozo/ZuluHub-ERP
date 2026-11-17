import { createHash } from "node:crypto";

/**
 * La huella de una operación de caja: sha256 (hex, 64 caracteres) de la lista ORDENADA de sus campos, en JSON. Es una función pura del
 * contenido (sin reloj ni azar): la misma operación da siempre la misma huella y cualquier campo distinto da otra. Con la clave de
 * idempotencia decide si un reintento es el mismo pedido o una clave reutilizada (e3 §3.5). Los campos son texto, número o `null`:
 * los importes entran como texto decimal (ADR-006), nunca como `number`.
 */
export type CampoDeHuella = string | number | null;

export function huellaDeCampos(campos: readonly CampoDeHuella[]): string {
  return createHash("sha256").update(JSON.stringify(campos)).digest("hex");
}

/**
 * Qué hacer con una clave de idempotencia (e3 §3.5): nueva (nadie la usó); repetida (misma huella: se devuelve lo hecho sin escribir
 * ni auditar); o reutilizada (otra huella: es un error del cliente, no una repetición). La búsqueda por clave va ANTES de mirar el
 * estado de la sesión: un reintento tras el cierre devuelve lo hecho.
 */
export function decidirPorHuella(
  guardada: string | null,
  huella: string,
): "NUEVA" | "REPETIDA" | "CLAVE_REUTILIZADA" {
  if (guardada === null) return "NUEVA";
  return guardada === huella ? "REPETIDA" : "CLAVE_REUTILIZADA";
}
