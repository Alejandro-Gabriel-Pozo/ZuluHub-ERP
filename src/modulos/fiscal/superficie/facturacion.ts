/** Casos de uso de facturación (emitir, descartar, reintentar, resincronizar, trabajos de sistema). Se reexporta desde `../publico.ts`, la única puerta del módulo (ADR-001). */
// H7 facturación F5: emitir a mano (factura, nota de crédito, nota de débito), descartar, reintentar, resincronizar
// una serie, cambiar el ambiente de un punto de venta y los dos trabajos de sistema (validar y reconciliar), con el
// guard primero y ARCA siempre fuera de la transacción. La composición los arma con `crearCasosDeUsoDeFacturacion`
// y registra los manejadores de la cola con los tipos `TRABAJO_VALIDAR_COMPROBANTE` y `TRABAJO_RECONCILIAR`; `contextoDeSistema` es el contexto de esos trabajos (sin persona).
export { DECLARACIONES_DE_FACTURACION } from "../casos-de-uso/declaraciones-de-facturacion";
export {
  crearCasosDeUsoDeFacturacion,
  type CasosDeUsoDeFacturacion,
} from "../casos-de-uso/casos-de-uso-de-facturacion";
export {
  OPCIONES_DE_FACTURACION,
  contextoDeSistema,
  prefijoDeValidacion,
  TRABAJO_RECONCILIAR,
  TRABAJO_VALIDAR_COMPROBANTE,
  type DependenciasDeFacturacion,
  type OpcionesDeFacturacion,
  type ProveedorDeEmision,
  type TiemposLimite,
  type TxDeFacturacion,
} from "../casos-de-uso/contrato-de-facturacion";
export { huellaDelPedido } from "../casos-de-uso/emitir-comprobante";
export {
  emitirFacturaDeOrigenEnTx,
  type EntradaDeFacturaDeOrigen,
  type ErrorAlEmitirFacturaDeOrigen,
  type RenglonDeOrigen,
} from "../casos-de-uso/emitir-factura-de-origen";
export type {
  EntradaDeComprobanteManual,
  EntradaDeNotaManual,
  ErrorAlEmitir,
  SalidaDeEmitir,
} from "../casos-de-uso/emitir-comprobante";
export type {
  EntradaDeDescartarComprobante,
  EntradaDeReintentarComprobante,
  ErrorAlDescartarComprobante,
  ErrorAlReintentarComprobante,
  SalidaDeDescartarComprobante,
  SalidaDeReintentarComprobante,
} from "../casos-de-uso/descartar-y-reintentar";
export type {
  EntradaDeCambiarAmbiente,
  EntradaDeResincronizarSerie,
  ErrorAlCambiarAmbiente,
  ErrorAlResincronizarSerie,
  SalidaDeCambiarAmbiente,
  SalidaDeResincronizarSerie,
} from "../casos-de-uso/resincronizar-y-ambiente";
export {
  crearManejadorDeValidarComprobante,
  type EntradaDeValidarComprobante,
  type ErrorAlValidarComprobante,
  type SalidaDeValidarComprobante,
} from "../casos-de-uso/validar-comprobante";
export {
  crearManejadorDeReconciliar,
  type EntradaDeReconciliarComprobantes,
  type ErrorAlReconciliarComprobantes,
  type ResultadoPorComprobante,
  type SalidaDeReconciliarComprobantes,
} from "../casos-de-uso/reconciliar-comprobantes";
