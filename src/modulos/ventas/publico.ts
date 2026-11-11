/**
 * Entrada pública del módulo de ventas (ADR-001; E4 fase A: la cuenta y el ticket interno sin cobro): los demás módulos solo importan de acá.
 */
export { DECLARACIONES as DECLARACIONES_DE_VENTAS } from "./casos-de-uso/declaraciones";
export { DECLARACIONES_DE_CONSULTAS as DECLARACIONES_DE_CONSULTAS_DE_VENTAS } from "./consultas/declaraciones";
export { crearCasosDeUsoDeVentas, type CasosDeUsoDeVentas } from "./casos-de-uso/casos-de-uso";
export { crearConsultasDeVentas, type ConsultasDeVentas } from "./consultas/consultas";
export type { DependenciasDeVentas, TxDeVentas } from "./casos-de-uso/contrato";
export type { DependenciasDeConsultasDeVentas, TxDeConsultasDeVentas } from "./consultas/contrato";
export type { ErrorDeVentas } from "./casos-de-uso/errores";
export {
  abrirCuentaEnTx,
  type EntradaDeAbrirCuenta,
  type SalidaDeAbrirCuenta,
} from "./casos-de-uso/abrir-cuenta";
export {
  agregarLineaEnTx,
  type EntradaDeAgregarLinea,
  type SalidaDeAgregarLinea,
} from "./casos-de-uso/agregar-linea";
export {
  anularLineaEnTx,
  type EntradaDeAnularLinea,
  type SalidaDeAnularLinea,
} from "./casos-de-uso/anular-linea";
export {
  anularCuentaEnTx,
  type EntradaDeAnularCuenta,
  type SalidaDeAnularCuenta,
} from "./casos-de-uso/anular-cuenta";
export {
  cerrarCuentaEnTx,
  type EntradaDeCerrarCuenta,
  type SalidaDeCerrarCuenta,
} from "./casos-de-uso/cerrar-cuenta";
export type { EntradaDeAnularTicket, SalidaDeAnularTicket } from "./casos-de-uso/anular-ticket";
export type {
  EntradaDeEmitirComprobanteDeTicket,
  SalidaDeEmitirComprobanteDeTicket,
} from "./casos-de-uso/emitir-comprobante-de-ticket";
export type {
  EntradaDeFacturaDeTicket,
  ErrorDelFacturador,
  FacturadorDeTickets,
  ReceptorDeFactura,
  RenglonDeFactura,
  SalidaDeFactura,
  VigenciaDeFactura,
} from "./casos-de-uso/puertos-de-facturacion";
export type {
  EntradaDeReversionDeStock,
  EntradaDeSalidaDeStock,
  ErrorDelStock,
  SalidaDeReversionDeStock,
  SalidaDeStockDeVenta,
  StockDeVentas,
} from "./casos-de-uso/puertos-de-stock";
export type { RenglonDeSalidaDeStock } from "./dominio/stock-de-la-venta";
export {
  comprobanteIdDeLaFactura,
  documentoIdDeLaFactura,
  origenDeLaFactura,
} from "./dominio/factura-de-ticket";
export {
  REINTENTOS_AL_COBRAR,
  type EntradaDeCobrar,
  type SalidaDeCobrar,
  type CobroHecho,
} from "./casos-de-uso/cobrar";
export { cerrarYCobrarEnTx, type EntradaDeCerrarYCobrar } from "./casos-de-uso/cerrar-y-cobrar";
export {
  copiarLineaEnTx,
  type EntradaDeCopiarLinea,
  type SalidaDeCopiarLinea,
} from "./casos-de-uso/copiar-linea";
export {
  reanclarCuentaEnTx,
  type EntradaDeReanclarCuenta,
  type SalidaDeReanclarCuenta,
} from "./casos-de-uso/reanclar";
export {
  bloquearCuentas,
  cuentaAbiertaPorAncla,
  cuentaPorId,
  cuentasAbiertasPorAncla,
  lineaPorId,
  lineasDeCuenta,
  type CuentaAbiertaDeAncla,
} from "./casos-de-uso/lecturas-de-cuenta";
export { idDerivado } from "./dominio/id-derivado";
export { calcularLasLineas } from "./casos-de-uso/calculo";
export { anclaValida, type Ancla } from "./dominio/ancla";
export { esUuid } from "./dominio/identificadores";
export type { Cuenta, Linea, OpcionDeLinea, ModoDeCopia } from "./persistencia/modelo-de-cuentas";
export type {
  EntradaDeVenderYCobrar,
  SalidaDeVenderYCobrar,
  LineaDeLaVenta,
} from "./casos-de-uso/vender-y-cobrar";
export { aporteDeVentas, type TxDeAporteDeVentas } from "./aporte-al-cierre";
export { numeroDeCorreccion } from "./dominio/rotulo";
export { COLUMNAS_DE_VENTAS, type VentasDb } from "./persistencia/esquema";
export { ERRORES_DE_VENTAS_POR_RESTRICCION } from "./persistencia/restricciones";
export {
  crearRepositorioDeCuentas,
  type RepositorioDeCuentas,
} from "./persistencia/repositorio-de-cuentas";
export {
  crearRepositorioDeDocumentos,
  type DocumentoDeTicket,
  type RepositorioDeDocumentos,
} from "./persistencia/repositorio-de-documentos";
export {
  crearRepositorioDeTickets,
  type RepositorioDeTickets,
} from "./persistencia/repositorio-de-tickets";
export {
  crearRepositorioDeLecturas,
  type LecturasDeVentas,
} from "./persistencia/repositorio-de-lecturas";
export {
  crearRepositoriosDeVentas,
  type RepositoriosDeVentas,
} from "./persistencia/repositorios-de-ventas";
