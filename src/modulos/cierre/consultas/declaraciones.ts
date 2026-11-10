import type { DeclaracionDeCaso } from "../../../capacidades/permisos/declaracion";

/** Las consultas por pantalla del cierre del día (ADR-005; e3b §3.3) y la acción que cada una exige al guard (cruce X1 de ADR-003). */
export const DECLARACIONES_DE_CONSULTAS = {
  estadoDeJornada: { accion: "jornadas.ver" },
  listarJornadas: { accion: "jornadas.ver" },
  controlesDeLaJornada: { accion: "jornadas.ver" },
} as const satisfies Record<string, DeclaracionDeCaso>;
