import type { DeclaracionDeCaso } from "../../../capacidades/permisos/declaracion";

/** Las consultas del salón (ADR-005; E7 §3.6) y la acción que cada una exige al guard (cruce X1). Mirar mesas es de los tres roles (`mesas.ver`). */
export const DECLARACIONES_DE_CONSULTAS = {
  listarMesas: { accion: "mesas.ver" },
} as const satisfies Record<string, DeclaracionDeCaso>;
