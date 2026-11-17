import type { ErrorDeStock } from "../../stock/publico";

/**
 * Los errores con nombre de los comandos de producción (E6 §3.2): los de stock (guard, módulo, alcance, control de existencia, lotes, depósitos) más los
 * de la orden. Los de la base (restricciones) se traducen con `ERRORES_DE_PRODUCCION_POR_RESTRICCION` y los de stock con los suyos.
 */
export type ErrorDeProduccion =
  | ErrorDeStock
  | "ORDEN_NO_ENCONTRADA"
  | "ORDEN_CANCELADA"
  | "ORDEN_ANULADA"
  | "ORDEN_YA_CERRADA"
  | "ORDEN_NO_CERRADA"
  | "CONSUMO_FUERA_DE_LA_ORDEN"
  | "CONSUMO_REPETIDO"
  | "PRODUCTO_SIN_RECETA"
  | "PRODUCTO_NO_SE_PRODUCE"
  | "DEPOSITO_DE_DESTINO_NO_NORMAL"
  | "PRODUCTO_YA_USADO";
