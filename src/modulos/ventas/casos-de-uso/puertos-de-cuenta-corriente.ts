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

export interface CuentaCorrienteDeVentas<Tx> {
  /** Carga el total a la cuenta del cliente dentro de la transacción del cierre (ficha bloqueada, límite, aprobación, asiento y auditoría). Repetir no duplica. */
  cargarEnTx(
    tx: Tx,
    contexto: ContextoOperativo,
    entrada: EntradaDeCargoACuenta,
  ): Promise<Resultado<CargoACuenta, ErrorDelCargoACuenta>>;
  /** El espejo del cargo al anular el ticket, en la misma transacción. */
  anularEnTx(
    tx: Tx,
    contexto: ContextoOperativo,
    entrada: Readonly<{ ticketId: string }>,
  ): Promise<Resultado<CargoACuenta, ErrorDelCargoACuenta>>;
}
