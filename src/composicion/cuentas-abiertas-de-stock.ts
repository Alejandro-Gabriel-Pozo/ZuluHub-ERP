import type { CuentasAbiertasConElProducto } from "../modulos/stock/publico";
import { cuentasAbiertasConElProducto } from "../modulos/ventas/publico";
import type { TxDeApp } from "./conexiones";

/**
 * El adaptador que une stock y ventas en el sentido contrario al de `stock-de-ventas.ts` (PRO-D1): antes de darle stock propio a un plato, stock pregunta cuántas cuentas abiertas tienen una línea de ese
 * plato, y ventas lo lee. La composición es el ÚNICO lugar donde se tocan los dos módulos (regla `ventas-sin-stock` y su espejo). Corre con la MISMA transacción de stock: la `TxDeApp` ya compone los
 * repositorios de ventas y de stock sobre la misma conexión, así la lectura y la activación son una sola transacción SERIALIZABLE (una línea agregada a la vez se serializa con ella). Sin los repositorios de
 * ventas en la transacción falla cerrado en vez de decir «cero cuentas».
 * Previene: encender el stock propio de un plato sin que nadie vea que las cuentas abiertas con ese plato pasarán a descontarlo y no a sus ingredientes. Chequeo: `cuentas-abiertas-de-stock.test.ts` y
 * `test/integracion/stock-propio-cuentas-abiertas.test.ts`.
 */
export const cuentasAbiertasDeVentasParaStock: CuentasAbiertasConElProducto = (
  tx,
  contexto,
  productoId,
) => {
  if (!("cuentas" in tx)) {
    throw new Error("contar las cuentas abiertas necesita la transacción compuesta con ventas");
  }
  return cuentasAbiertasConElProducto(tx as unknown as TxDeApp, contexto.empresaId, productoId);
};
