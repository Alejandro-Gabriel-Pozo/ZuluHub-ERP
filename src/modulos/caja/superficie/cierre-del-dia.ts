/**
 * Lo que caja ofrece para el cierre del día (E3, tramo 8; e3b §4): el aporte que la composición registra en `cierre`, el puerto que caja
 * declara y la composición implementa (`TicketsPorCobranza`), los casos de uso que solo valen con la jornada en auditoría (corregir el
 * medio de un cobro, declarar un total y el «conforme general») y las consultas de la pantalla del Cierre del día.
 */
export { crearAporteDeCaja } from "../aporte/aporte-de-caja";
export type { TxDeAporteDeCaja, TxDeLecturaDeLaJornada } from "../aporte/contrato";
export type { TicketDeVentas, TicketsPorCobranza } from "../aporte/tickets-por-cobranza";
export {
  controlesDeCaja,
  impedimentosDeCaja,
  type DatosParaLosControles,
} from "../dominio/controles-del-dia";
export type {
  EntradaDeCorregirMedioDeCobro,
  ErrorAlCorregirMedioDeCobro,
  SalidaDeCorregirMedioDeCobro,
} from "../casos-de-uso/corregir-medio-de-cobro";
export type {
  EntradaDeDeclararTotal,
  ErrorAlDeclararTotal,
  SalidaDeDeclararTotal,
} from "../casos-de-uso/declarar-total";
export type {
  EntradaDeDarConformeGeneral,
  ErrorAlDarConformeGeneral,
  SalidaDeDarConformeGeneral,
} from "../casos-de-uso/dar-conforme-general";
export type { EntradaDeJornadaDeCaja, ErrorDeConsultaDeJornada } from "../consultas/jornada-comun";
export type {
  ErrorAlVerLasSesionesDeLaJornada,
  SesionesDeLaJornada,
} from "../consultas/sesiones-de-la-jornada";
export {
  MAXIMO_DE_COBROS_POR_PAGINA,
  type CobroDeLaJornadaVisto,
  type CorreccionDeUnCobroVista,
  type CursorDeCobrosDeLaJornada,
  type EntradaDeCobrosDeLaJornada,
  type ErrorAlListarLosCobrosDeLaJornada,
  type PaginaDeCobrosDeLaJornada,
} from "../consultas/cobros-de-la-jornada";
export {
  MAXIMO_DE_MOVIMIENTOS_MANUALES_POR_PEDIDO,
  type ErrorAlVerLosMovimientosManuales,
  type MovimientoManualVisto,
  type MovimientosManualesDeLaJornada,
} from "../consultas/movimientos-manuales-de-la-jornada";
export type {
  AjusteVisto,
  CobradoContraTicketVisto,
  ConciliacionDeLaJornada,
  ErrorAlVerLaConciliacion,
  LineaDeConciliacionVista,
} from "../consultas/conciliacion-de-la-jornada";
export {
  MAXIMO_DE_ORIGENES_POR_PAGINA,
  type CobradoDeUnOrigenVisto,
  type CursorDeOrigenesVisto,
  type EntradaDeCobradoPorOrigenDeLaJornada,
  type ErrorAlVerElCobradoPorOrigen,
  type PaginaDeCobradoPorOrigen,
} from "../consultas/cobrado-por-origen-de-la-jornada";
export type {
  CobradoDeUnMedio,
  ErrorAlVerElInformeDeCaja,
  InformeDeCajaDelDia,
} from "../consultas/informe-de-caja-del-dia";
