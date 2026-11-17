import type { DeclaracionDeCaso } from "../../../capacidades/permisos/declaracion";

/**
 * Las consultas por pantalla de producción (ADR-005; E6 §3.5) y la acción que cada una exige al guard (cruce X1). Mirar es de los tres roles; el
 * operador solo ve las órdenes de sus sucursales (filtro de la consulta). El costo congelado viaja solo con `costos.ver` (lo decide la consulta).
 */
export const DECLARACIONES_DE_CONSULTAS = {
  listarOrdenes: { accion: "transformaciones.ver" },
  fichaDeOrden: { accion: "transformaciones.ver" },
} as const satisfies Record<string, DeclaracionDeCaso>;
