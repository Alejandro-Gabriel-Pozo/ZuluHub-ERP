/**
 * Entrada pública del módulo de caja (ADR-001; e3 §3). Hoy: el dominio puro (E3, tramo 2) y la configuración (tramo 3: cajas, medios de
 * pago y cuentas de cobro, con su persistencia, casos de uso y consultas). El módulo sigue «en desarrollo» en el catálogo.
 */
export {
  ESTADOS_DE_SESION,
  CLASES_DE_MOVIMIENTO,
  TIPOS_DE_MEDIO,
  TIPOS_DE_CUENTA,
  DATOS_DEL_COBRO,
  ESTADOS_DE_CONTEO,
  type EstadoDeSesion,
  type ClaseDeMovimiento,
  type TipoDeMedio,
  type TipoDeCuenta,
  type DatoDelCobro,
  type EstadoDeConteo,
} from "./estados";
export {
  TRANSICIONES_DE_SESION,
  transicionDeSesionPermitida,
  decidirIniciarCierre,
  decidirCancelarCierre,
  exigirSesionAbierta,
  estadoDeCaja,
  exigirCajaAbiertaParaCobrar,
  type EstadoDeCaja,
  type ErrorDeEstadoDeSesion,
} from "./dominio/sesion";
export {
  TOPE_DE_IMPORTE_EN_CENTAVOS,
  importeDeEntrada,
  sumarImportes,
  negarImporte,
  type ErrorDeImporte,
  type ReglaDeImporte,
} from "./dominio/importes";
export { motivoObligatorio, observacionOpcional } from "./dominio/texto";
export {
  CUENTAS_ADMITIDAS,
  DATOS_ADMITIDOS_POR_MEDIO,
  cuentaAdmitidaPorMedio,
  cuentaDeCobroRequerida,
  validarParDeCobro,
  validarDatosQuePide,
  type CuentaVista,
  type DatosQuePideElMedio,
  type ErrorDeParDeCobro,
  type MedioVisto,
  type ParDeCobro,
} from "./dominio/medios";
export {
  datosCompletados,
  validarDatosDelCobro,
  type DatosDelCobro,
  type DatosDelCobroValidos,
  type ErrorDeDatoDelCobro,
  type MotivoDeDatoInvalido,
} from "./dominio/datos-del-cobro";
export {
  claveDelCobro,
  huellaDelCobro,
  validarOrigen,
  ORDEN_MAXIMO_DE_COBRO,
  ORDEN_MINIMO_DE_COBRO,
  type EntradaDeCobro,
  type ReferenciaOpaca,
} from "./dominio/identidad-del-cobro";
export { decidirPorHuella, huellaDeCampos, type CampoDeHuella } from "./dominio/huella";
export {
  CLASES_ANULABLES,
  CLASES_CON_MOTIVO,
  decidirAjuste,
  decidirFondoInicial,
  decidirMovimientoManual,
  egresoSuperaElEfectivo,
  esSoloDeEfectivo,
  motivoRequerido,
  signoValido,
  validarJornadaACorregir,
  type AjusteArmado,
  type ErrorDeJornadaACorregir,
  type MovimientoManualArmado,
} from "./dominio/movimiento";
export {
  decidirAnulacion,
  motivoNoAnulable,
  type EntradaDeAnulacion,
  type ErrorDeAnulacion,
  type EspejoDeAnulacion,
  type MotivoNoAnulable,
  type MovimientoAnulable,
} from "./dominio/anulacion";
export {
  CANTIDAD_MAXIMA_DE_BILLETES,
  DENOMINACIONES_DE_BILLETES,
  decidirArqueo,
  esperadoPorLinea,
  hayDiferenciaDeArqueo,
  repiteElCierre,
  type ArqueoCalculado,
  type ArqueoComparable,
  type BilleteContado,
  type ConteoDeEfectivo,
  type EntradaDeArqueo,
  type ErrorDeArqueo,
  type LineaDeArqueo,
  type LineaEsperada,
  type LineaFaltante,
  type MovimientoParaArqueo,
  type TotalDeclarado,
} from "./dominio/arqueo";
export {
  decidirCorreccionDeMedio,
  decidirDeclaracion,
  filaVigente,
  parVigenteDelCobro,
  secuenciaSiguiente,
  type CorreccionArmada,
  type CorreccionGuardada,
  type DeclaracionArmada,
} from "./dominio/correccion";
export {
  cantidadDeLineasPorExplicar,
  conciliarJornada,
  type CierreDeCajaDelPar,
  type CorreccionParaConciliacion,
  type DeclaracionVista,
  type EntradaDeConciliacion,
  type LineaDeConciliacion,
} from "./dominio/conciliacion";
export {
  ORIGEN_DE_COBRANZA_DE_TICKET,
  cobradoPorOrigen,
  compararContraTickets,
  type CobradoDeUnOrigen,
  type CobroDeUnOrigen,
  type DiferenciaDeTicket,
  type TicketDeCobranza,
} from "./dominio/cobrado-contra-ticket";
export { CONTROLES_DE_CAJA, type DefinicionDeControl } from "./dominio/controles";
export { jornadaVencida } from "./dominio/jornada-de-caja";
export {
  LARGO_MAXIMO_DEL_IDENTIFICADOR_EXTERNO,
  LARGO_MAXIMO_DEL_NOMBRE_DE_CAJA,
  LARGO_MAXIMO_DEL_NOMBRE_DE_CUENTA,
  LARGO_MAXIMO_DEL_NOMBRE_DE_MEDIO,
  decidirAltaDeCaja,
  decidirAltaDeCuenta,
  decidirAltaDeMedio,
  decidirCambioDeEstado,
  decidirDesactivacionDeMedio,
  decidirEdicionDeCaja,
  decidirEdicionDeCuenta,
  decidirEdicionDeMedio,
  identificadorExternoValido,
  nombreDeCajaValido,
  nombreDeCuentaValido,
  nombreDeMedioValido,
  tipoDeCuentaValido,
  tipoDeMedioValido,
  type Caja,
  type CuentaDeCobro,
  type DecisionDeAlta,
  type DecisionDeCambioDeEstado,
  type DecisionDeEdicion,
  type ErrorDeAltaDeMedio,
  type ErrorDeEdicionDeMedio,
  type MedioDePago,
} from "./dominio/configuracion";
export {
  COLUMNAS_DE_CAJA,
  ERRORES_DE_CAJA_POR_RESTRICCION,
  type CajaDb,
} from "./persistencia/esquema";
export {
  crearRepositorioDeCajas,
  type OpcionesDeListadoDeCajas,
  type RepositorioDeCajas,
} from "./persistencia/repositorio-de-cajas";
export {
  crearRepositorioDeMediosDePago,
  type CambiosPersistidosDeMedio,
  type OpcionesDeListadoDeMedios,
  type RepositorioDeMediosDePago,
} from "./persistencia/repositorio-de-medios";
export {
  crearRepositorioDeCuentasDeCobro,
  type CambiosPersistidosDeCuenta,
  type NuevaCuentaDeCobro,
  type OpcionesDeListadoDeCuentas,
  type RepositorioDeCuentasDeCobro,
} from "./persistencia/repositorio-de-cuentas";
export { DECLARACIONES as DECLARACIONES_DE_CAJA } from "./casos-de-uso/declaraciones";
export { DECLARACIONES_DE_CONSULTAS as DECLARACIONES_DE_CONSULTAS_DE_CAJA } from "./consultas/declaraciones";
export { crearCasosDeUsoDeCaja, type CasosDeUsoDeCaja } from "./casos-de-uso/casos-de-uso";
export type { DependenciasDeCaja, TxDeCaja } from "./casos-de-uso/contrato";
export {
  asegurarCajaPorDefectoEnTx,
  type EntradaDeAsegurarCajaPorDefecto,
  type ErrorAlAsegurarCajaPorDefecto,
  type SalidaDeAsegurarCaja,
  type SalidaDeAsegurarCajaPorDefecto,
  type TxParaCajaPorDefecto,
} from "./casos-de-uso/caja-por-defecto";
export { ganchoDeSucursalDeCaja } from "./gancho-de-sucursal";
export type {
  EntradaDeCrearCaja,
  ErrorAlCrearCaja,
  SalidaDeCrearCaja,
} from "./casos-de-uso/crear-caja";
export type {
  EntradaDeEditarCaja,
  ErrorAlEditarCaja,
  SalidaDeEditarCaja,
} from "./casos-de-uso/editar-caja";
export type {
  EntradaDeCambiarEstadoDeCaja,
  ErrorAlDesactivarCaja,
  ErrorAlReactivarCaja,
  SalidaDeDesactivarCaja,
  SalidaDeReactivarCaja,
} from "./casos-de-uso/cambiar-estado-de-caja";
export type {
  EntradaDeCrearMedioDePago,
  ErrorAlCrearMedioDePago,
  SalidaDeCrearMedioDePago,
} from "./casos-de-uso/crear-medio-de-pago";
export type {
  EntradaDeEditarMedioDePago,
  ErrorAlEditarMedioDePago,
  SalidaDeEditarMedioDePago,
} from "./casos-de-uso/editar-medio-de-pago";
export type {
  EntradaDeCambiarEstadoDeMedioDePago,
  ErrorAlDesactivarMedioDePago,
  ErrorAlReactivarMedioDePago,
  SalidaDeDesactivarMedioDePago,
  SalidaDeReactivarMedioDePago,
} from "./casos-de-uso/cambiar-estado-de-medio-de-pago";
export type {
  EntradaDeCrearCuentaDeCobro,
  ErrorAlCrearCuentaDeCobro,
  SalidaDeCrearCuentaDeCobro,
} from "./casos-de-uso/crear-cuenta-de-cobro";
export type {
  EntradaDeEditarCuentaDeCobro,
  ErrorAlEditarCuentaDeCobro,
  SalidaDeEditarCuentaDeCobro,
} from "./casos-de-uso/editar-cuenta-de-cobro";
export type {
  EntradaDeCambiarEstadoDeCuentaDeCobro,
  ErrorAlCambiarElEstadoDeUnaCuentaDeCobro,
  SalidaDeDesactivarCuentaDeCobro,
  SalidaDeReactivarCuentaDeCobro,
} from "./casos-de-uso/cambiar-estado-de-cuenta-de-cobro";
export { crearConsultasDeCaja, type ConsultasDeCaja } from "./consultas/consultas";
export type { DependenciasDeConsultasDeCaja, TxDeConsultasDeCaja } from "./consultas/contrato";
export type {
  CajaDeLista,
  CajasDeLaSucursal,
  EntradaDeListarCajas,
  ErrorAlListarCajas,
} from "./consultas/listar-cajas";
export type {
  EntradaDeListarMediosDePago,
  ErrorAlListarMediosDePago,
  MedioDeLista,
  MediosDePagoDeLaEmpresa,
} from "./consultas/listar-medios-de-pago";
export type {
  CuentaDeLista,
  CuentasDeCobroDeLaEmpresa,
  EntradaDeListarCuentasDeCobro,
  ErrorAlListarCuentasDeCobro,
} from "./consultas/listar-cuentas-de-cobro";
