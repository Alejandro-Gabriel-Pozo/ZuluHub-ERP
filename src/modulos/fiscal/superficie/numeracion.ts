/** Casos de uso de numeración y estados del comprobante frente a ARCA. Se reexporta desde `../publico.ts`, la única puerta del módulo (ADR-001). */
// H7 T6: casos de uso de numeración (reservar, cerrar y reconciliar), con el guard primero y el servicio
// de emisión siempre fuera de la transacción. La composición los arma con `crearCasosDeUsoDeNumeracion`.
export { DECLARACIONES as DECLARACIONES_DE_FISCAL } from "../casos-de-uso/declaraciones";
export {
  crearCasosDeUsoDeNumeracion,
  type CasosDeUsoDeNumeracion,
} from "../casos-de-uso/casos-de-uso";
export type {
  ContextoDeSistema,
  DependenciasDeNumeracion,
  TxDeNumeracion,
} from "../casos-de-uso/contrato";
export type {
  EntradaDeReservarNumero,
  ErrorAlReservarNumero,
  SalidaDeReservarNumero,
} from "../casos-de-uso/reservar-numero";
export type {
  EntradaDeCerrarReserva,
  ErrorAlCerrarReserva,
  SalidaDeCerrarReserva,
} from "../casos-de-uso/cerrar-reserva";
export type {
  EntradaDeReconciliarSerie,
  ErrorAlReconciliarSerie,
  SalidaDeReconciliarSerie,
} from "../casos-de-uso/reconciliar-serie";
export type {
  EntradaDeReconciliarSeriesVencidas,
  ErrorAlReconciliarSeriesVencidas,
  ResultadoPorSerie,
  SalidaDeReconciliarSeriesVencidas,
} from "../casos-de-uso/reconciliar-series-vencidas";
// H7 facturación F4: puerto de emisión ampliado (consultar, no enviado) y estados del comprobante frente a ARCA.
export {
  ESTADOS_DE_COMPROBANTE_ARCA,
  type DatosConsultados,
  type DesenlaceDeAutorizacion,
  type Mensaje,
  type ResultadoDeAutorizacionArca,
  type ResultadoDeConsulta,
} from "../dominio/estados-de-comprobante";
