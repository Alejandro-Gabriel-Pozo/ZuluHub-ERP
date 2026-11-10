/** Entrada pública del módulo de caja (ADR-001; e3 §3). Por ahora, solo su dominio puro (E3, tramo 2). */
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
