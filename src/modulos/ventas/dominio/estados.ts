/**
 * Los estados de la cuenta, de la línea y del ticket y sus transiciones (E4 §3.3, §3.5 y §3.8). Las repiten, como red de seguridad, los
 * disparadores de 0028 (`cuenta_validar_cambio`, `ticket_validar_cambio`); una prueba compara ambas listas con la base. Puro.
 */
export const ESTADOS_DE_CUENTA = ["ABIERTA", "CERRADA", "ANULADA"] as const;
export type EstadoDeCuenta = (typeof ESTADOS_DE_CUENTA)[number];

export const ESTADOS_DE_LINEA = ["VIGENTE", "ANULADA"] as const;
export type EstadoDeLinea = (typeof ESTADOS_DE_LINEA)[number];

export const ESTADOS_DE_TICKET = ["EMITIDO", "COBRADO", "CORTESIA", "ANULADO"] as const;
export type EstadoDeTicket = (typeof ESTADOS_DE_TICKET)[number];

/** Una cuenta se resuelve una sola vez: cerrada o anulada, y queda congelada. */
export const TRANSICIONES_DE_CUENTA: Readonly<Record<EstadoDeCuenta, readonly EstadoDeCuenta[]>> = {
  ABIERTA: ["CERRADA", "ANULADA"],
  CERRADA: [],
  ANULADA: [],
};

/** Un ticket nunca se reabre ni se borra: `ANULADO` es final (decisión 62). */
export const TRANSICIONES_DE_TICKET: Readonly<Record<EstadoDeTicket, readonly EstadoDeTicket[]>> = {
  EMITIDO: ["COBRADO", "ANULADO"],
  COBRADO: ["ANULADO"],
  CORTESIA: ["ANULADO"],
  ANULADO: [],
};

export function transicionDeCuentaPermitida(de: EstadoDeCuenta, a: EstadoDeCuenta): boolean {
  return TRANSICIONES_DE_CUENTA[de].includes(a);
}

export function transicionDeTicketPermitida(de: EstadoDeTicket, a: EstadoDeTicket): boolean {
  return TRANSICIONES_DE_TICKET[de].includes(a);
}
