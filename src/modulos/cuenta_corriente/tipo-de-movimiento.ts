import {
  CLASE_DE_LA_COBRANZA_DE_VENTA,
  CLASE_DEL_CARGO_DE_VENTA,
  ORIGEN_DE_LA_COBRANZA_DE_VENTA,
  ORIGEN_DEL_CARGO_DE_VENTA,
} from "./dominio/cargo-de-venta";

/**
 * Qué es un movimiento de la cuenta del cliente, para mostrarlo (CC-5). Vive en un archivo neutro porque lo usan las consultas, que no importan el dominio (regla `consultas-sin-dominio`, ADR-005).
 * El espejo de una anulación se distingue del original por su naturaleza; una clase que no es de venta ni de cobranza es `OTRO` (nunca se inventa un nombre).
 */
export const TIPOS_DE_MOVIMIENTO = [
  "VENTA_A_CUENTA",
  "VENTA_ANULADA",
  "COBRANZA",
  "COBRANZA_ANULADA",
  "OTRO",
] as const;
export type TipoDeMovimiento = (typeof TIPOS_DE_MOVIMIENTO)[number];

export function tipoDeMovimiento(
  clase: string,
  naturaleza: "ORIGINAL" | "ANULACION",
): TipoDeMovimiento {
  const anulado = naturaleza === "ANULACION";
  if (clase === CLASE_DEL_CARGO_DE_VENTA) return anulado ? "VENTA_ANULADA" : "VENTA_A_CUENTA";
  if (clase === CLASE_DE_LA_COBRANZA_DE_VENTA) return anulado ? "COBRANZA_ANULADA" : "COBRANZA";
  return "OTRO";
}

export const esOrigenDeUnTicket = (origenTipo: string): boolean =>
  origenTipo === ORIGEN_DEL_CARGO_DE_VENTA;
export const esOrigenDeUnaCobranza = (origenTipo: string): boolean =>
  origenTipo === ORIGEN_DE_LA_COBRANZA_DE_VENTA;
