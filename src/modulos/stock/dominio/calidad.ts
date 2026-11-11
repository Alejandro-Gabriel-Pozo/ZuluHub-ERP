import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

/**
 * La calidad de un lote (E6 §3.2, D27, D118): un estado del lote, no un movimiento de stock (S-4). Cualquier estado pasa a cualquier otro
 * (liberar, rechazar, dejar en revisión) y siempre con motivo. Puro. Previene un cambio de calidad sin motivo y dos filas de historia para
 * el mismo estado repetido (idempotencia: «ya estaba»).
 */
export const CALIDADES_DE_LOTE = ["EN_CUARENTENA", "EN_REVISION", "LIBERADO", "RECHAZADO"] as const;
export type CalidadDeLote = (typeof CALIDADES_DE_LOTE)[number];

export const esCalidadDeLote = (texto: string): texto is CalidadDeLote =>
  (CALIDADES_DE_LOTE as readonly string[]).includes(texto);

/** El estado de un lote vende y se usa solo si no lleva calidad (el artículo no la controla) o está liberado. */
export const calidadHabilita = (calidad: CalidadDeLote | null): boolean =>
  calidad === null || calidad === "LIBERADO";

export type DecisionDeCalidad = "CAMBIA" | "YA_ESTABA";

export function decidirCambioDeCalidad(
  actual: CalidadDeLote | null,
  nueva: CalidadDeLote,
  motivo: string,
): Resultado<DecisionDeCalidad, "MOTIVO_REQUERIDO"> {
  if (motivo.trim().length === 0) return err("MOTIVO_REQUERIDO");
  return ok(actual === nueva ? "YA_ESTABA" : "CAMBIA");
}
