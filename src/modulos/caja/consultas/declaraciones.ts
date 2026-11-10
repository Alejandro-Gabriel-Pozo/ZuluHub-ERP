import type { DeclaracionDeCaso } from "../../../capacidades/permisos/declaracion";

/** Las consultas por pantalla de caja (ADR-005; e3 §3.10) y la acción que cada una exige al guard (cruce X1 de ADR-003): todas, `cajas.ver`. */
export const DECLARACIONES_DE_CONSULTAS = {
  listarCajas: { accion: "cajas.ver" },
  listarMediosDePago: { accion: "cajas.ver" },
  listarCuentasDeCobro: { accion: "cajas.ver" },
  opcionesDeApertura: { accion: "cajas.ver" },
  resumenDeSesion: { accion: "cajas.ver" },
  movimientosDeSesion: { accion: "cajas.ver" },
  prepararCierre: { accion: "cajas.ver" },
  listarSesiones: { accion: "cajas.ver" },
  fichaDeSesion: { accion: "cajas.ver" },
  // El cierre del día de caja (e3b §4.5).
  sesionesDeLaJornada: { accion: "cajas.ver" },
  cobrosDeLaJornada: { accion: "cajas.ver" },
  movimientosManualesDeLaJornada: { accion: "cajas.ver" },
  conciliacionDeLaJornada: { accion: "cajas.ver" },
  cobradoPorOrigenDeLaJornada: { accion: "cajas.ver" },
  informeDeCajaDelDia: { accion: "cajas.ver" },
} as const satisfies Record<string, DeclaracionDeCaso>;
