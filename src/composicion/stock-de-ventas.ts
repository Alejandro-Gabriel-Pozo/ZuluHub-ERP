import type { ReglasDeEmpresa } from "../capacidades/permisos/empresa";
import { err } from "../primitivas/resultado/resultado";
import {
  crearPuertosDeStock,
  traducirMovimiento,
  type ErrorDeStock,
} from "../modulos/stock/publico";
import type { ErrorDelStock, StockDeVentas } from "../modulos/ventas/publico";
import type { TxDeApp } from "./conexiones";

/**
 * El adaptador que une ventas y stock (E5-T12; E4 §3.10): la composición es el ÚNICO lugar donde se tocan los dos módulos (regla `ventas-sin-stock`).
 * Traduce el puerto de ventas (`StockDeVentas`, tipos propios) a los puertos que stock ofrece (`ConsumoDeStock`, `ReversionDeStock`, `DepositoDeVenta`,
 * `ArticulosDeVenta`) y los llama con la MISMA `tx`: la `TxDeApp` ya compone los repositorios de ventas y de stock sobre la misma conexión, así el
 * ticket, la salida de stock y su auditoría son todo o nada. Los puertos de stock no autorizan (la acción la puso ventas y queda en el libro) pero
 * sí miran que el módulo opere para la empresa: apagado, `controla` da `false` y la salida devuelve el motivo.
 */

/**
 * La transacción que recibe el puerto es la de ventas; en la composición es SIEMPRE la `TxDeApp` (`tipos-tx.test.ts`: contiene la de ventas y la de
 * stock). Si alguien arma el puerto con otra transacción sin los repositorios de stock, falla cerrado en vez de descontar a medias.
 */
function comoTxDeApp(tx: object): TxDeApp {
  if (!("movimientosDeStock" in tx) || !("niveles" in tx) || !("depositos" in tx)) {
    throw new Error(
      "descontar stock necesita la transacción compuesta con los repositorios de stock",
    );
  }
  return tx as TxDeApp;
}

export function crearStockDeVentas(reglas: ReglasDeEmpresa): StockDeVentas<object> {
  const puertos = crearPuertosDeStock({ reglas });
  return {
    controla: (tx, contexto, productoIds) =>
      puertos.articulosDeVenta.controla(comoTxDeApp(tx), contexto, productoIds),
    depositoDeVenta: (tx, contexto, sucursalId) =>
      puertos.depositoDeVenta.deVenta(comoTxDeApp(tx), contexto, sucursalId),
    async registrarSalidaEnTx(tx, contexto, entrada) {
      const r = await puertos.consumoDeStock.registrarSalidaPorVentaEnTx(
        comoTxDeApp(tx),
        contexto,
        entrada,
      );
      if (!r.ok) return err(r.error as ErrorDelStock);
      return {
        ok: true,
        valor: { movimientoId: r.valor.movimientoId, yaExistia: r.valor.yaExistia },
      };
    },
    async revertirSalidaEnTx(tx, contexto, entrada) {
      const r = await puertos.reversionDeStock.revertirPorOrigen(
        comoTxDeApp(tx),
        contexto,
        entrada,
      );
      if (!r.ok) return err(r.error as ErrorDelStock);
      return {
        ok: true,
        valor: { habiaSalida: r.valor.habiaSalida, yaExistia: r.valor.yaExistia },
      };
    },
    traducirFalla(error) {
      const traducida = traducirMovimiento<never>(err<ErrorDeStock>(error));
      return traducida.ok || traducida.error === error ? null : traducida.error;
    },
  };
}
