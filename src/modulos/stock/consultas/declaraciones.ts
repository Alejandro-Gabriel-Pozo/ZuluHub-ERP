import type { DeclaracionDeCaso } from "../../../capacidades/permisos/declaracion";

/**
 * Las consultas por pantalla de stock (ADR-005; E5 §3.4) y la acción que cada una exige al guard (cruce X1). Mirar es de los tres roles; el
 * operador solo ve lo de sus sucursales (filtro en la consulta). `verificarSaldos` es del gerente (`stock.verificar_saldos`). Cada tramo suma
 * las suyas acá.
 */
export const DECLARACIONES_DE_CONSULTAS = {
  listarDepositos: { accion: "stock.ver" },
} as const satisfies Record<string, DeclaracionDeCaso>;
