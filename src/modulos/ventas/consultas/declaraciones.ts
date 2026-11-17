import type { DeclaracionDeCaso } from "../../../capacidades/permisos/declaracion";

/**
 * Las consultas de ventas (ADR-005; E4 §3.12, §3.13 y §3.15) y la acción que cada una exige al guard (cruce X1). Mirar es de los tres roles
 * (`ventas.ver`). `ticketParaFacturar` es además el puerto que ofrece ventas al facturador (E1).
 */
export const DECLARACIONES_DE_CONSULTAS = {
  cotizarVentaRapida: { accion: "ventas.ver" },
  estadoDeCajasParaCobrar: { accion: "ventas.ver" },
  fichaDeCuenta: { accion: "ventas.ver" },
  fichaDeTicket: { accion: "ventas.ver" },
  listarTickets: { accion: "ventas.ver" },
  ticketsPendientesDeFacturar: { accion: "ventas.ver" },
  ticketParaFacturar: { accion: "ventas.ver" },
  resumenDeVentasDeLaJornada: { accion: "ventas.ver" },
  ticketsDeLaJornada: { accion: "ventas.ver" },
  ticketsPorCobranza: { accion: "ventas.ver" },
  anulacionesDeLaJornada: { accion: "ventas.ver" },
  correccionesDeLaJornada: { accion: "ventas.ver" },
  cortesiasDeLaJornada: { accion: "ventas.ver" },
} as const satisfies Record<string, DeclaracionDeCaso>;
