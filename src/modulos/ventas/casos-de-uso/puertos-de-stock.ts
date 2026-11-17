import type { ClaveAccion } from "../../../capacidades/modulos/catalogo";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { Resultado } from "../../../primitivas/resultado/resultado";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { RenglonDeSalidaDeStock } from "../dominio/stock-de-la-venta";

/**
 * El puerto que ventas declara para descontar y devolver stock (E5-T12; E4 §3.10): tipos PROPIOS de ventas, nada importado de stock. Quien lo
 * implementa es la composición, el único lugar donde se tocan los dos módulos (como `FacturadorDeTickets` con fiscal): traduce estos tipos a los
 * puertos de stock (`ConsumoDeStock`, `ReversionDeStock`, `DepositoDeVenta`, `ArticulosDeVenta`) y los llama con la MISMA `tx` (la `TxDeApp` ya
 * compone los repositorios de ventas y de stock sobre la misma conexión), así el ticket y la salida de stock son todo o nada. Previene que ventas
 * dependa de los tipos y errores de stock y el ciclo de módulos (regla `ventas-sin-stock`, con su violación inyectada).
 *
 * Es OPCIONAL (`usaSiExiste: stock`): sin él, ninguna línea controla stock y ventas no llama a nada (D146, stock apagado). Con él, stock decide
 * por su cuenta si opera para la empresa: apagado, `controla` da `false` para todo.
 */

export type EntradaDeSalidaDeStock = Readonly<{
  /** El ejemplar ORIGINAL del ticket: la identidad de la salida (una por ejemplar, aunque se repita el cierre). */
  origen: Readonly<{ tipo: "EJEMPLAR_DE_TICKET"; id: string }>;
  /** La acción con que ventas autorizó el cierre (queda en el libro de stock). */
  accion: ClaveAccion;
  depositoId: string;
  /** El `ahora` del ticket. */
  hechoEn: Date;
  /** La jornada del TICKET: stock nunca la deriva de `hechoEn`. */
  fechaDeNegocio: FechaCivil;
  renglones: readonly RenglonDeSalidaDeStock[];
}>;

export type SalidaDeStockDeVenta = Readonly<{
  /** `null` si ninguna línea descontó. */
  movimientoId: string | null;
  /** `true`: ya había una salida de ese ejemplar (el primer hecho manda). */
  yaExistia: boolean;
}>;

export type EntradaDeReversionDeStock = Readonly<{
  origen: Readonly<{ tipo: "EJEMPLAR_DE_TICKET"; id: string }>;
  accion: ClaveAccion;
  /** Por qué se revierte (queda en el libro de stock). */
  detalle: string;
}>;

export type SalidaDeReversionDeStock = Readonly<{
  /** `false`: ese ejemplar nunca descontó stock (no hay nada que devolver, y no es un error). */
  habiaSalida: boolean;
  /** `true`: la salida ya estaba revertida. */
  yaExistia: boolean;
}>;

/** Un error de stock, ya traducido por la composición: ventas lo devuelve tal cual dentro de `STOCK_FALLIDO`. */
export type ErrorDelStock = string | Readonly<Record<string, unknown>>;

/**
 * `Tx` es la transacción del llamador (la de ventas): es un parámetro para que este archivo no importe el contrato que lo usa (sería un ciclo).
 * Ninguna operación abre una transacción propia: un error devuelto revierte la de ventas entera (ni número, ni ticket, ni salida).
 */
export type StockDeVentas<Tx = never> = Readonly<{
  /** De estos productos: ¿cuáles descuentan stock ahora? Con stock apagado (o fuera del plan) ninguno. Todo id pedido figura en la respuesta. */
  controla(
    tx: Tx,
    contexto: ContextoOperativo,
    productoIds: readonly string[],
  ): Promise<ReadonlyMap<string, Readonly<{ controla: boolean }>>>;
  /** El depósito de venta activo de la sucursal, o `null` si no hay. */
  depositoDeVenta(
    tx: Tx,
    contexto: ContextoOperativo,
    sucursalId: string,
  ): Promise<Readonly<{ depositoId: string }> | null>;
  registrarSalidaEnTx(
    tx: Tx,
    contexto: ContextoOperativo,
    entrada: EntradaDeSalidaDeStock,
  ): Promise<Resultado<SalidaDeStockDeVenta, ErrorDelStock>>;
  /** Anula la salida de un ejemplar (anular el ticket). No exige el módulo activo: devolver lo ya descontado siempre se puede. */
  revertirSalidaEnTx(
    tx: Tx,
    contexto: ContextoOperativo,
    entrada: EntradaDeReversionDeStock,
  ): Promise<Resultado<SalidaDeReversionDeStock, ErrorDelStock>>;
  /**
   * Traduce un error de la base que salió de la transacción de ventas por una restricción de stock (una carrera, o el control de existencia
   * negativa que la base repite al confirmar). `null` si no es de stock.
   */
  traducirFalla(error: ErrorDePersistencia): ErrorDelStock | null;
}>;
