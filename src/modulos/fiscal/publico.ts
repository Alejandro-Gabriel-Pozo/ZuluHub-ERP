/** Entrada pública del módulo fiscal (ADR-001): los demás módulos solo importan de acá. */
export {
  CODIGOS_DE_ALICUOTA,
  esCodigoDeAlicuota,
  porcentajeDeAlicuota,
  type CodigoDeAlicuota,
} from "./dominio/alicuota";
export {
  calcularComprobante,
  desglosarAlicuota,
  type ComprobanteCalculado,
  type DesgloseDeAlicuota,
  type LineaDeComprobante,
} from "./dominio/comprobante";

// H7 (fiscal base): emisores, puntos de venta, datos fiscales versionados, resolución del emisor y
// numeración de comprobantes. Dominio puro (T2); la persistencia y los casos de uso vienen después.
export {
  CONDICIONES_DE_IVA,
  corregirCuit,
  desactivarEmisor,
  esCondicionDeIva,
  nuevoEmisorSecundario,
  type CambioDeEmisor,
  type CondicionIva,
  type ContextoDeCorreccionDeCuit,
  type ContextoDeCuit,
  type DatosDeEmisorSecundario,
  type Emisor,
  type ErrorDeEmisor,
} from "./dominio/emisor";
export {
  certificadoId,
  comprobanteId,
  domicilioId,
  emisorId,
  intentoId,
  origenId,
  puntoDeVentaId,
  solicitudId,
  versionId,
  type CertificadoId,
  type ComprobanteId,
  type DomicilioId,
  type EmisorId,
  type IntentoId,
  type OrigenId,
  type PuntoDeVentaId,
  type SolicitudId,
  type VersionId,
} from "./dominio/identificadores";
export { AMBIENTES, type Ambiente } from "./dominio/comprobante-nuevo";
export {
  confirmarVersion,
  estadoDeVersion,
  siguienteNumeroDeVersion,
  versionVigente,
  type ConfirmacionDeVersion,
  type DatosDeConfirmacion,
  type ErrorDeConfirmacion,
  type EstadoDeVersion,
  type VersionConfirmada,
} from "./dominio/vigencia";
export {
  CONDICIONES_DE_IIBB,
  LIMITES_DE_DATOS_FISCALES,
  borradorDesdeConfirmada,
  confirmarDatosFiscales,
  editarBorrador,
  esCondicionDeIibb,
  fechaCivilValida,
  nuevoBorrador,
  type CambiosDeBorrador,
  type CampoObligatorio,
  type CondicionIibb,
  type DatosDeBorradorNuevo,
  type DatosDeConfirmacionFiscal,
  type DatosFiscalesBorrador,
  type DatosFiscalesConfirmados,
  type DatosFiscalesIncompletos,
  type ErrorDeDatosFiscales,
} from "./dominio/datos-fiscales";
export {
  RANGO_DE_NUMERO_DE_PUNTO_DE_VENTA,
  activarPuntoDeVenta,
  desactivarPuntoDeVenta,
  editarPuntoDeVenta,
  nuevoPuntoDeVenta,
  puntosDeVentaHabilitados,
  type CambioDePuntoDeVenta,
  type CambiosDePuntoDeVenta,
  type ContextoDeEdicion,
  type DatosDePuntoDeVenta,
  type ErrorDePuntoDeVenta,
  type EstadoDePuntoDeVenta,
  type PuntoDeVenta,
  type RangoDeNumero,
  type SucursalDeReferencia,
} from "./dominio/punto-de-venta";
export {
  REGLA_DE_EMISOR_POR_DEFECTO,
  confirmarReglaDeEmisor,
  reglaDeEmisorVigente,
  resolverEmisor,
  resolverEmisoresDeLineas,
  type DatosDeLinea,
  type DatosAFacturar,
  type EmisorResuelto,
  type ErrorDeResolucion,
  type ErrorDeResolucionDeLinea,
  type LineaConEmisor,
  type LineaParaResolver,
  type MotivoDeEmisor,
  type ReglaDeEmisor,
  type VersionDeReglaDeEmisor,
  type VersionGuardadaDeReglaDeEmisor,
} from "./dominio/resolucion-de-emisor";
export {
  calcularComprobantesDeVenta,
  planificarComprobantes,
  repartirCobro,
  totalDeLaVenta,
  type ComprobanteDeVentaCalculado,
  type ErrorDePlan,
  type LineaAFacturar,
  type LineaAFacturarCalculable,
  type PlanDeComprobante,
  type PuntoDeVentaDeSucursal,
} from "./dominio/plan-de-comprobantes";
export {
  TIPOS_DE_COMPROBANTE,
  TIPOS_DE_ORIGEN,
  claseDeComprobante,
  claveDeIdempotenciaDeComprobante,
  esTipoDeComprobante,
  esTipoDeOrigen,
  letraDeComprobante,
  type ClaseDeComprobante,
  type ClaveDeIdempotenciaDeComprobante,
  type ComprobanteEmitido,
  type ComprobanteEmitidoJson,
  type EstadoDeComprobante,
  type InstantaneaDeEmisor,
  type LetraDeComprobante,
  type OrigenDeComprobante,
  type TipoDeComprobante,
  type TipoDeOrigen,
} from "./dominio/comprobante-emitido";
export {
  OPCIONES_DE_NUMERACION,
  TRANSICIONES_DE_SERIE,
  cerrarSerie,
  hayNumerosUsados,
  iniciarSerie,
  reconciliarSerie,
  reservarNumero,
  serieEsConsistente,
  serieUsada,
  transicionDeSerieValida,
  verificarSecuencia,
  type CierreDeSerie,
  type ErrorDeNumeracion,
  type ErrorDeSecuencia,
  type EstadoDeSerie,
  type OpcionesDeNumeracion,
  type ReconciliacionDeSerie,
  type ReservaDeNumero,
  type ResolucionDeReconciliacion,
  type Serie,
  type SerieBloqueada,
  type SerieEnCurso,
  type SerieLibre,
} from "./dominio/numeracion";
export type {
  EmisionElectronica,
  ErrorDeEmision,
  PuntoDeVentaParaEmision,
  SolicitudDeAutorizacion,
} from "./casos-de-uso/emision-electronica";

// H7 T4: persistencia (tablas, repositorios y traducción de las restricciones de la base). La
// composición arma los repositorios con `db.withTables<FiscalDb>()`; los casos de uso (T5 a T7) los
// reciben por su contrato y traducen con `traducirErroresDeFiscal`.
export {
  COLUMNAS_DE_FISCAL,
  ERRORES_DE_FISCAL_POR_RESTRICCION,
  RESTRICCIONES_DE_DISPARADORES_DE_FISCAL,
  type ErrorDeFiscalPorRestriccion,
} from "./persistencia/esquema";
export type { FiscalDb } from "./persistencia/tablas";
export {
  crearRepositorioDeDatosFiscales,
  crearRepositorioDeDomicilios,
  crearRepositorioDeEmisores,
  crearRepositorioDePuntosDeVenta,
  crearRepositorioDeReglasDeEmisor,
  crearRepositorioDeSeries,
  type BorradorDeReglaDeEmisor,
  type DomicilioGuardado,
  type ErrorDeAlta,
  type PuntoDeVentaGuardado,
  type RepositorioDeDatosFiscales,
  type RepositorioDeDomicilios,
  type RepositorioDeEmisores,
  type RepositorioDePuntosDeVenta,
  type RepositorioDeReglasDeEmisor,
  type RepositorioDeSeries,
  type ResultadoDeAlta,
  type VersionDeDatosFiscales,
  type VersionDeRegla,
} from "./persistencia/repositorios";
// H7 facturación F3: comprobantes, intentos contra ARCA y certificados (0009).
export {
  crearRepositorioDeComprobantes,
  type AltaDeComprobante,
  type AsociadoGuardado,
  type CambioDeComprobante,
  type ComprobanteGuardado,
  type DatosFiscalesDeLaFoto,
  type EmisorCongelado,
  type ErrorDeAltaDeComprobante,
  type ImportesGuardados,
  type RenglonGuardado,
  type RepositorioDeComprobantes,
  type ResueltoPor,
} from "./persistencia/repositorio-de-comprobantes";
export {
  CLASES_DE_MENSAJE,
  DESENLACES_DE_INTENTO,
  OPERACIONES_DE_INTENTO,
  crearRepositorioDeIntentos,
  type ClaseDeMensaje,
  type DesenlaceDeIntento,
  type IntentoDeArca,
  type MensajeDeIntento,
  type OperacionDeIntento,
  type RepositorioDeIntentos,
} from "./persistencia/repositorio-de-intentos";
export {
  ESTADOS_DE_CERTIFICADO,
  crearRepositorioDeAccesos,
  crearRepositorioDeCertificados,
  type AccesoGuardado,
  type ActivacionDeCertificado,
  type CargaDeCertificado,
  type CertificadoGuardado,
  type CredencialDeAcceso,
  type EstadoDeCertificado,
  type PedidoDeCertificado,
  type RepositorioDeAccesos,
  type RepositorioDeCertificados,
  type ServicioDeArca,
  type TextoCifrado,
} from "./persistencia/repositorio-de-certificados";
export { errorFiscalDeRestriccion, traducirErroresDeFiscal } from "./persistencia/traducir";

// H7 T6: casos de uso de numeración (reservar, cerrar y reconciliar), con el guard primero y el servicio
// de emisión siempre fuera de la transacción. La composición los arma con `crearCasosDeUsoDeNumeracion`.
export { DECLARACIONES as DECLARACIONES_DE_FISCAL } from "./casos-de-uso/declaraciones";
export {
  crearCasosDeUsoDeNumeracion,
  type CasosDeUsoDeNumeracion,
} from "./casos-de-uso/casos-de-uso";
export type {
  ContextoDeSistema,
  DependenciasDeNumeracion,
  TxDeNumeracion,
} from "./casos-de-uso/contrato";
export type {
  EntradaDeReservarNumero,
  ErrorAlReservarNumero,
  SalidaDeReservarNumero,
} from "./casos-de-uso/reservar-numero";
export type {
  EntradaDeCerrarReserva,
  ErrorAlCerrarReserva,
  SalidaDeCerrarReserva,
} from "./casos-de-uso/cerrar-reserva";
export type {
  EntradaDeReconciliarSerie,
  ErrorAlReconciliarSerie,
  SalidaDeReconciliarSerie,
} from "./casos-de-uso/reconciliar-serie";
export type {
  EntradaDeReconciliarSeriesVencidas,
  ErrorAlReconciliarSeriesVencidas,
  ResultadoPorSerie,
  SalidaDeReconciliarSeriesVencidas,
} from "./casos-de-uso/reconciliar-series-vencidas";

// H7 facturación F4: numeración con ambiente (la serie es de un punto de venta, un tipo y un ambiente), puerto de
// emisión ampliado (consultar, no enviado) y salida de una serie bloqueada.
export { resincronizarSerie, type ErrorDeResincronizacion } from "./dominio/numeracion";
export type {
  DatosConsultados,
  DesenlaceDeAutorizacion,
  Mensaje,
  ResultadoDeAutorizacionArca,
  ResultadoDeConsulta,
} from "./dominio/estados-de-comprobante";

// H7 facturación F6: las consultas del facturador (listado, detalle y modelo de impresión) y el modelo de impresión.
export { DECLARACIONES_DE_CONSULTAS as DECLARACIONES_DE_CONSULTAS_DE_FISCAL } from "./consultas/declaraciones";
export { crearConsultasDeFacturacion, type ConsultasDeFacturacion } from "./consultas/consultas";
export type {
  DependenciasDeConsultasDeFacturacion,
  TxDeConsultasDeFacturacion,
} from "./consultas/contrato";
export type {
  EntradaDeListarComprobantes,
  ErrorAlListarComprobantes,
} from "./consultas/listar-comprobantes";
export type { EntradaDeVerComprobante, ErrorAlVerComprobante } from "./consultas/ver-comprobante";
export type {
  EntradaDeModeloDeImpresion,
  ErrorAlPedirElModeloDeImpresion,
} from "./consultas/modelo-de-impresion";
export type {
  DetalleDeComprobante,
  NotaQueCitaVista,
  PaginaDeComprobantes,
  ResumenDeComprobante,
  SerieVista,
  UltimoIntentoVisto,
} from "./consultas/vistas";
export {
  LARGO_MAXIMO_DEL_TEXTO,
  LIMITE_MAXIMO,
  LIMITE_POR_DEFECTO,
  type ErrorDeCriterios,
  type PedidoDeListado,
} from "./consultas/criterios-de-listado";
export {
  crearLecturasDeComprobantes,
  type LecturasDeComprobantes,
} from "./persistencia/lecturas-de-comprobantes";
export {
  VERSION_DE_REPRESENTACION_ACTUAL,
  type ErrorDeImpresion,
  type MarcaParaImprimir,
  type ModeloImpreso,
  type TotalesImpresos,
} from "./dominio/modelo-de-impresion";

// H7 facturación F5: emitir a mano (factura, nota de crédito, nota de débito), descartar, reintentar, resincronizar
// una serie, cambiar el ambiente de un punto de venta y los dos trabajos de sistema (validar y reconciliar), con el
// guard primero y ARCA siempre fuera de la transacción. La composición los arma con `crearCasosDeUsoDeFacturacion`
// y registra los manejadores de la cola con los tipos `TRABAJO_VALIDAR_COMPROBANTE` y `TRABAJO_RECONCILIAR`.
export { DECLARACIONES_DE_FACTURACION } from "./casos-de-uso/declaraciones-de-facturacion";
export {
  crearCasosDeUsoDeFacturacion,
  type CasosDeUsoDeFacturacion,
} from "./casos-de-uso/casos-de-uso-de-facturacion";
export {
  OPCIONES_DE_FACTURACION,
  TRABAJO_RECONCILIAR,
  TRABAJO_VALIDAR_COMPROBANTE,
  type DependenciasDeFacturacion,
  type OpcionesDeFacturacion,
  type ProveedorDeEmision,
  type TiemposLimite,
  type TxDeFacturacion,
} from "./casos-de-uso/contrato-de-facturacion";
export type {
  EntradaDeComprobanteManual,
  EntradaDeNotaManual,
  ErrorAlEmitir,
  SalidaDeEmitir,
} from "./casos-de-uso/emitir-comprobante";
export type {
  EntradaDeDescartarComprobante,
  EntradaDeReintentarComprobante,
  ErrorAlDescartarComprobante,
  ErrorAlReintentarComprobante,
  SalidaDeDescartarComprobante,
  SalidaDeReintentarComprobante,
} from "./casos-de-uso/descartar-y-reintentar";
export type {
  EntradaDeCambiarAmbiente,
  EntradaDeResincronizarSerie,
  ErrorAlCambiarAmbiente,
  ErrorAlResincronizarSerie,
  SalidaDeCambiarAmbiente,
  SalidaDeResincronizarSerie,
} from "./casos-de-uso/resincronizar-y-ambiente";
export {
  crearManejadorDeValidarComprobante,
  type EntradaDeValidarComprobante,
  type ErrorAlValidarComprobante,
  type SalidaDeValidarComprobante,
} from "./casos-de-uso/validar-comprobante";
export {
  crearManejadorDeReconciliar,
  type EntradaDeReconciliarComprobantes,
  type ErrorAlReconciliarComprobantes,
  type ResultadoPorComprobante,
  type SalidaDeReconciliarComprobantes,
} from "./casos-de-uso/reconciliar-comprobantes";

// H7 facturación F8: lo que el adaptador real de ARCA (`adaptadores/arca`) necesita de fiscal para traducir un
// pedido a los valores de WSFE: las tablas de códigos y el número de documento como lo manda ARCA. Los tipos del
// pedido (`SolicitudDeAutorizacion`) y del resultado ya salen más arriba.
export {
  CODIGO_DE_MONEDA,
  CODIGO_DE_TIPO_DE_COMPROBANTE,
  CODIGO_DE_TIPO_DE_DOCUMENTO,
} from "./dominio/codigos-de-arca";
export { numeroDeDocumentoParaArca } from "./dominio/receptor";
