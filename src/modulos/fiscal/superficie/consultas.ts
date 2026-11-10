/** Consultas del facturador y modelo de impresión. Se reexporta desde `../publico.ts`, la única puerta del módulo (ADR-001). */
// H7 facturación F6: las consultas del facturador (listado, detalle y modelo de impresión) y el modelo de impresión.
export { DECLARACIONES_DE_CONSULTAS as DECLARACIONES_DE_CONSULTAS_DE_FISCAL } from "../consultas/declaraciones";
export { crearConsultasDeFacturacion, type ConsultasDeFacturacion } from "../consultas/consultas";
export type {
  DependenciasDeConsultasDeFacturacion,
  TxDeConsultasDeFacturacion,
} from "../consultas/contrato";
export type {
  EntradaDeListarComprobantes,
  ErrorAlListarComprobantes,
} from "../consultas/listar-comprobantes";
export type { EntradaDeVerComprobante, ErrorAlVerComprobante } from "../consultas/ver-comprobante";
export type {
  ComprobanteVigenteDeUnOrigen,
  EntradaDeComprobanteVigenteDeUnOrigen,
  ErrorAlPedirElComprobanteDeUnOrigen,
} from "../consultas/comprobante-vigente-de-un-origen";
export {
  LIMITE_DE_IDS_DE_VIGENCIA,
  vigenciaDeComprobantesEnTx,
  type EntradaDeVigenciaDeComprobantes,
  type ErrorAlPedirLaVigencia,
  type VigenciaDeUnComprobante,
} from "../consultas/vigencia-de-comprobantes";
export type {
  EntradaDeModeloDeImpresion,
  ErrorAlPedirElModeloDeImpresion,
} from "../consultas/modelo-de-impresion";
export type {
  DetalleDeComprobante,
  NotaQueCitaVista,
  PaginaDeComprobantes,
  ResumenDeComprobante,
  SerieVista,
  UltimoIntentoVisto,
} from "../consultas/vistas";
export {
  LARGO_MAXIMO_DEL_ORIGEN_ID,
  LARGO_MAXIMO_DEL_TEXTO,
  LIMITE_MAXIMO,
  LIMITE_POR_DEFECTO,
  type ErrorDeCriterios,
  type PedidoDeListado,
} from "../consultas/criterios-de-listado";
export {
  crearLecturasDeComprobantes,
  type LecturasDeComprobantes,
} from "../persistencia/lecturas-de-comprobantes";
export {
  VERSION_DE_REPRESENTACION_ACTUAL,
  type ErrorDeImpresion,
  type MarcaParaImprimir,
  type ModeloImpreso,
  type ReferenciaImpresa,
  type TotalesImpresos,
} from "../dominio/modelo-de-impresion";
