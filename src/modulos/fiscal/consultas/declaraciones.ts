import type { DeclaracionDeCaso } from "../../../capacidades/permisos/declaracion";

/**
 * Las consultas por pantalla del facturador (H7 facturación, especificación §B.4.9) y la acción que cada una
 * exige al guard (cruce X1 de ADR-003). Mirar lo emitido lo pueden los tres roles y es de solo lectura: un
 * plan dado de baja sigue viendo sus comprobantes.
 */
export const DECLARACIONES_DE_CONSULTAS = {
  listarComprobantes: { accion: "comprobantes.ver" },
  verComprobante: { accion: "comprobantes.ver" },
  modeloDeImpresion: { accion: "comprobantes.ver" },
} as const satisfies Record<string, DeclaracionDeCaso>;
