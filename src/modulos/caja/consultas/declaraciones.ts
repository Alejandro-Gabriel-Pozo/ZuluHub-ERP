import type { DeclaracionDeCaso } from "../../../capacidades/permisos/declaracion";

/** Las consultas por pantalla de caja (ADR-005; e3 §3.10) y la acción que cada una exige al guard (cruce X1 de ADR-003): todas, `cajas.ver`. */
export const DECLARACIONES_DE_CONSULTAS = {
  listarCajas: { accion: "cajas.ver" },
  listarMediosDePago: { accion: "cajas.ver" },
  listarCuentasDeCobro: { accion: "cajas.ver" },
} as const satisfies Record<string, DeclaracionDeCaso>;
