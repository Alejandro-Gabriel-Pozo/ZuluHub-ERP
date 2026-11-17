/** Certificados de ARCA, lo que necesita el adaptador de ARCA y la configuración fiscal. Se reexporta desde `../publico.ts`, la única puerta del módulo (ADR-001). */
// H7 facturación F7: certificados de ARCA. Generar el pedido (la clave privada se genera y se guarda CIFRADA dentro
// del servidor: nunca sale ni se muestra) y cargar el certificado que devolvió ARCA (validado contra la clave, el CUIT
// del TITULAR declarado —puede no ser el del emisor, D-42—, la cadena y el vencimiento), con el guard primero. La
// composición los arma con `crearCasosDeUsoDeCertificados`; `dondeSeGuardaLaClave` y `…Credencial` ubican lo cifrado.
export { DECLARACIONES_DE_CERTIFICADOS } from "../casos-de-uso/declaraciones-de-certificados";
export {
  crearCasosDeUsoDeCertificados,
  type CasosDeUsoDeCertificados,
} from "../casos-de-uso/casos-de-uso-de-certificados";
export type {
  DependenciasDeCertificados,
  TxDeCertificados,
} from "../casos-de-uso/contrato-de-certificados";
export type {
  EntradaDeGenerarPedido,
  ErrorAlGenerarPedido,
  SalidaDeGenerarPedido,
} from "../casos-de-uso/generar-pedido-de-certificado";
export type {
  EntradaDeCargarCertificado,
  ErrorAlCargarCertificadoDeUso,
  SalidaDeCargarCertificado,
} from "../casos-de-uso/cargar-certificado";
export {
  DIAS_DE_AVISO_POR_DEFECTO,
  certificadosPorVencer,
  type AvisoDeVencimiento,
  type CertificadoParaAvisar,
} from "../dominio/vencimiento-de-certificados";
// H7 facturación F8: lo que el adaptador real de ARCA (`adaptadores/arca`) necesita de fiscal para traducir un
// pedido a los valores de WSFE: las tablas de códigos y el número de documento como lo manda ARCA. Los tipos del
// pedido (`SolicitudDeAutorizacion`) y del resultado ya salen más arriba.
export {
  CODIGO_DE_MONEDA,
  CODIGO_DE_TIPO_DE_COMPROBANTE,
  CODIGO_DE_TIPO_DE_DOCUMENTO,
} from "../dominio/codigos-de-arca";
export { TIPOS_DE_DOCUMENTO, numeroDeDocumentoParaArca } from "../dominio/receptor";

// H7 T5: la configuración fiscal del gerente. Guardar y confirmar los datos fiscales de un emisor, dar de alta,
// editar, activar y desactivar puntos de venta y confirmar la regla de resolución del emisor, con el guard primero
// (las siete acciones son de `administracion`, solo del gerente). La composición los arma con
// `crearCasosDeUsoDeConfiguracionFiscal`.
export { DECLARACIONES_DE_CONFIGURACION as DECLARACIONES_DE_CONFIGURACION_FISCAL } from "../casos-de-uso/declaraciones-de-configuracion";
export {
  crearCasosDeUsoDeConfiguracionFiscal,
  type CasosDeUsoDeConfiguracionFiscal,
} from "../casos-de-uso/casos-de-uso-de-configuracion";
export type {
  DependenciasDeConfiguracionFiscal,
  TxDeConfiguracionFiscal,
} from "../casos-de-uso/contrato-de-configuracion";
export type {
  DomicilioDeEntrada,
  ErrorDeDomicilioDeEntrada,
} from "../casos-de-uso/comun-de-configuracion";
export type {
  EntradaDeGuardarBorradorDeDatosFiscales,
  ErrorAlGuardarElBorrador,
  SalidaDeGuardarBorradorDeDatosFiscales,
} from "../casos-de-uso/guardar-borrador-de-datos-fiscales";
export type {
  EntradaDeConfirmarDatosFiscales,
  ErrorAlConfirmarDatosFiscales,
  SalidaDeConfirmarDatosFiscales,
} from "../casos-de-uso/confirmar-datos-fiscales";
export type {
  EntradaDeCrearPuntoDeVenta,
  EntradaDeEditarPuntoDeVenta,
  ErrorAlCrearPuntoDeVenta,
  ErrorAlEditarPuntoDeVenta,
  SalidaDeCrearPuntoDeVenta,
  SalidaDeEditarPuntoDeVenta,
} from "../casos-de-uso/crear-y-editar-punto-de-venta";
export type {
  EntradaDeCambiarElEstadoDelPuntoDeVenta,
  ErrorAlActivarPuntoDeVenta,
  ErrorAlDesactivarPuntoDeVenta,
  SalidaDeCambiarElEstadoDelPuntoDeVenta,
} from "../casos-de-uso/activar-y-desactivar-punto-de-venta";
export type {
  EntradaDeConfirmarReglaDeEmisor,
  ErrorAlConfirmarLaRegla,
  SalidaDeConfirmarReglaDeEmisor,
} from "../casos-de-uso/confirmar-regla-de-emisor";
