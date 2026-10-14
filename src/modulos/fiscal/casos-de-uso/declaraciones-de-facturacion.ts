import type { DeclaracionDeCaso } from "../../../capacidades/permisos/declaracion";

/**
 * Los casos de uso de facturación (spec H7 facturación §B.4 y §C) y la acción que cada uno exige al guard (cruce
 * X1 de ADR-003). Una acción por caso: por eso la nota de crédito y la de débito son dos casos (la NC es
 * `notas_de_credito.emitir`, CC; la ND, como la factura, `comprobantes.emitir_manual`, CA), con el mismo cuerpo.
 *
 * Los dos trabajos corren sin persona (ADR-007): el permiso se exigió al emitir (`comprobantes.emitir_manual` o
 * `notas_de_credito.emitir`) y el comprobante ya es una intención confirmada; el trabajo solo la lleva a ARCA.
 */
export const DECLARACIONES_DE_FACTURACION = {
  emitirComprobanteManual: { accion: "comprobantes.emitir_manual" },
  emitirNotaDeCredito: { accion: "notas_de_credito.emitir" },
  emitirNotaDeDebito: { accion: "comprobantes.emitir_manual" },
  descartarComprobante: { accion: "comprobantes.descartar" },
  reintentarComprobante: { accion: "comprobantes.reintentar" },
  resincronizarSerie: { accion: "series.resincronizar" },
  cambiarAmbienteDePuntoDeVenta: { accion: "puntos_de_venta.cambiar_ambiente" },
  validarComprobante: {
    sinGuard:
      "Trabajo de sistema (ADR-007): el permiso se exigió al emitir (comprobantes.emitir_manual o notas_de_credito.emitir) y el comprobante ya es una intención confirmada; el trabajo solo la lleva a ARCA",
  },
  reconciliarComprobantes: {
    sinGuard:
      "Trabajo de sistema (ADR-007): resuelve consultando a ARCA los comprobantes de la empresa del trabajo que quedaron en vuelo, y reencola los pendientes sin trabajo; no decide nada que una persona haya pedido",
  },
} as const satisfies Record<string, DeclaracionDeCaso>;
