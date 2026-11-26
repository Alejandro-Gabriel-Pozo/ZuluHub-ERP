import type { ContextoOperativo } from "../../../contexto/contexto";
import type { Resultado } from "../../../primitivas/resultado/resultado";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";

/**
 * El puerto que ventas declara para cargar una venta a la cuenta corriente de un cliente y para anular ese cargo (CC-2): tipos PROPIOS de ventas, nada importado de `cuenta_corriente`. Quien lo implementa es la
 * composición, el único lugar donde se tocan los dos módulos (como `StockDeVentas` con stock): llama a `cuenta_corriente` con la MISMA `tx` (la `TxDeApp` ya compone los repositorios de ventas, de la ficha y del
 * libro sobre la misma conexión), así el ticket y su cargo son todo o nada. Es OPCIONAL: sin él, cerrar a nombre de un cliente se rechaza (`CUENTA_CORRIENTE_NO_DISPONIBLE`): todo nace cerrado.
 */
export type EntradaDeCargoACuenta = Readonly<{
  clienteId: string;
  ticketId: string;
  sucursalId: string;
  /** Texto decimal en pesos: el total del ticket. */
  total: string;
  /** La fecha de negocio del TICKET: de ella corre el plazo del vencimiento. */
  fechaDeNegocio: FechaCivil;
  /** El motivo con el que quien cierra aprueba pasar el límite del cliente; solo cuenta si el cargo lo supera. */
  aprobacion?: Readonly<{ motivo: string }> | undefined;
}>;

/** Los motivos por los que la cuenta corriente no deja cargar (todos salen de ventas como el genérico: el negocio decide qué mostrar). */
export type ErrorDelCargoACuenta =
  | "CLIENTE_SIN_CUENTA_HABILITADA"
  | "CUENTA_SUSPENDIDA"
  | "EXCEDE_EL_LIMITE"
  | "CARGO_A_CUENTA_RECHAZADO";

export type CargoACuenta = Readonly<{ asientoId: string; yaExistia: boolean }>;

/**
 * EL ORDEN DE BLOQUEO (un solo lugar; lo respetan cerrar, cobrar y anular): el ticket primero (al cerrar nace con su fila; al cobrar `marcarCobrado`; al anular `bloquearTicket`), después la cobranza y los cobros de caja, después la
 * FICHA del cliente (solo el cargo la toma `FOR UPDATE`; cobrar no: suspender al cliente no impide cobrarle) y al final el SALDO de la parte en el libro, que se toma al insertar el asiento. Anular un ticket cobrado a cuenta anula
 * primero la cobranza y después el cargo. Como ninguna operación pide algo anterior a lo que ya tiene, no hay ciclo.
 */
export interface CuentaCorrienteDeVentas<Tx> {
  /** Carga el total a la cuenta del cliente dentro de la transacción del cierre (ficha bloqueada, límite, aprobación, asiento y auditoría). Repetir no duplica. */
  cargarEnTx(
    tx: Tx,
    contexto: ContextoOperativo,
    entrada: EntradaDeCargoACuenta,
  ): Promise<Resultado<CargoACuenta, ErrorDelCargoACuenta>>;
  /**
   * La cobranza del ticket a cuenta (CC-3), en la misma transacción que el cobro de caja y al final de ella: el asiento COBRANZA por el total, imputado al cargo de ese ticket. Cobra el cargo entero. Repetir no duplica.
   */
  cobrarEnTx(
    tx: Tx,
    contexto: ContextoOperativo,
    entrada: Readonly<{ ticketId: string; cobranzaId: string; total: string }>,
  ): Promise<Resultado<CargoACuenta, ErrorDelCargoACuenta>>;
  /** El espejo de la cobranza al anular un ticket cobrado a cuenta (antes de anular el cargo), en la misma transacción. */
  anularCobranzaEnTx(
    tx: Tx,
    contexto: ContextoOperativo,
    entrada: Readonly<{ cobranzaId: string }>,
  ): Promise<Resultado<CargoACuenta, ErrorDelCargoACuenta>>;
  /** El espejo del cargo al anular el ticket, en la misma transacción. */
  anularEnTx(
    tx: Tx,
    contexto: ContextoOperativo,
    entrada: Readonly<{ ticketId: string }>,
  ): Promise<Resultado<CargoACuenta, ErrorDelCargoACuenta>>;
}
