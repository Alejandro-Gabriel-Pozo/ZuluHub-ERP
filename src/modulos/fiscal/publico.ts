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
  type DesenlaceDeAutorizacion,
  type EstadoDeComprobante,
  type InstantaneaDeEmisor,
  type LetraDeComprobante,
  type OrigenDeComprobante,
  type ResultadoDeAutorizacion,
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
  type SerieGuardada,
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
  CierreSinConfirmar,
  EntradaDeNumerarComprobante,
  ErrorAlNumerarComprobante,
  ReservaEnCurso,
  SalidaDeNumerarComprobante,
} from "./casos-de-uso/numerar-comprobante";
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
