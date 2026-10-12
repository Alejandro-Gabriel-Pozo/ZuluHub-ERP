import type { DecisionDeAceptacion, ErrorDeAceptacion } from "../../../modulos/identidad/publico";
import type { Resultado } from "../../../primitivas/resultado/resultado";
import type { ExplicacionDeAccion } from "./explicar";

/**
 * Qué deja asentado la auditoría de acceso de "explicar por qué" (H5 §B.5.9): quién lo pidió (lo pone
 * el adaptador, del contexto), sobre qué empresa o invitación, qué persona y acción, y qué motivo
 * resultó. NUNCA el contenido de lo explicado ni el email de nadie. Dominio puro.
 */

/** El código del error, sea un texto o un objeto con `codigo` (los que además informan una empresa). */
function codigoDe(error: string | Readonly<{ codigo: string }>): string {
  return typeof error === "string" ? error : error.codigo;
}

/**
 * El motivo que resultó de explicar una acción: `PERMITIDA`, o el rechazo (`SIN_PERMISO`,
 * `MODULO_NO_ACTIVO`…, `EMPRESA_NO_OPERA`).
 */
export function resultadoDeUnaAccionExplicada(
  decision: ExplicacionDeAccion<string>["decision"],
): string {
  return decision.ok ? "PERMITIDA" : codigoDe(decision.error);
}

/**
 * El motivo que resultó de explicar una aceptación: `ACEPTAR` o `YA_ACEPTADA` si se aceptaría (o ya
 * se aceptó), o el error (`INVITACION_VENCIDA`, `EMPRESA_NO_OPERA`…).
 */
export function resultadoDeUnaAceptacionExplicada(
  decision: Resultado<DecisionDeAceptacion, ErrorDeAceptacion>,
): string {
  return decision.ok ? decision.valor.tipo : codigoDe(decision.error);
}
