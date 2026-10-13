import type { DeclaracionDeCaso } from "../../../capacidades/permisos/declaracion";

/**
 * Los casos de uso de numeración (H7, especificación §B.8) y la acción que cada uno exige al guard
 * (cruce X1 de ADR-003). Emitir completa algo ya vendido o cobrado: la acción es `comprobantes.emitir`.
 */
export const DECLARACIONES = {
  reservarNumeroDeComprobante: { accion: "comprobantes.emitir" },
  cerrarReservaDeNumero: { accion: "comprobantes.emitir" },
  reconciliarSerie: {
    sinGuard:
      "Trabajo de sistema (ADR-007): corre sin persona (contexto operativo con personaId null) y solo mira lo que dice el servicio de emisión; el permiso se exigió al reservar",
  },
  reconciliarSeriesVencidas: {
    sinGuard:
      "Trabajo de sistema (ADR-007): recorre las reservas vencidas de la empresa del trabajo y reconcilia cada una",
  },
} as const satisfies Record<string, DeclaracionDeCaso>;
