import type { DeclaracionDeCaso } from "../../../capacidades/permisos/declaracion";

/** Las consultas por pantalla del portal (ADR-005) y la acción que cada una exige al guard (cruce X1). Mirar es de los tres roles: el operador solo ve. */
export const DECLARACIONES_DE_CONSULTAS = {
  verPortalDeLaVidriera: { accion: "vidrieras.ver" },
} as const satisfies Record<string, DeclaracionDeCaso>;
