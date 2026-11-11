import { createHash } from "node:crypto";

/**
 * La huella de un comando de compras: sha256 (hex, 64 caracteres) del contenido canónico, en JSON. Función pura del contenido (sin reloj ni azar): el
 * mismo pedido da siempre la misma huella y cualquier campo distinto da otra. Con la clave de idempotencia decide si un reintento es el mismo pedido o
 * una clave reutilizada (E9 §3.5). Los renglones se ordenan ANTES de hashear: la misma compra con los renglones en otro orden es el mismo pedido.
 * Los importes y las cantidades entran como texto decimal (ADR-006), nunca como `number`.
 *
 * Lo que NO entra lo decide quien arma el contenido: un `hechoEn` que no mandó la persona (es el `ahora` del contexto) no debe entrar, o el reintento de
 * un clic doble daría otra huella y una falsa `CLAVE_REUTILIZADA`. Mismo molde que `stock/dominio/huella.ts` (otro módulo: no se importa).
 */
export type CampoDeHuella = string | number | boolean | null;
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

/** Qué hacer con una clave de idempotencia: nueva, repetida (misma huella: se devuelve lo hecho sin escribir ni auditar) o reutilizada (otra huella). */
export function decidirPorHuella(
  guardada: string | null,
  huella: string,
): "NUEVA" | "REPETIDA" | "CLAVE_REUTILIZADA" {
  if (guardada === null) return "NUEVA";
  return guardada === huella ? "REPETIDA" : "CLAVE_REUTILIZADA";
}
