import {
  listarOrdenesDentro,
  obtenerOrdenDentro,
  type EntradaDeListarOrdenes,
  type OrdenDeDetalle,
  type OrdenDeLista,
  type PaginaDeOrdenes,
} from "../casos-de-uso/lectura-ordenes";
import { esUuid } from "../persistencia/filas";
import { err } from "../../../primitivas/resultado/resultado";
import { type Lector, type RDeConsulta } from "./comun";

export type { EntradaDeListarOrdenes, OrdenDeDetalle, OrdenDeLista, PaginaDeOrdenes };

export function armarConsultasDeOrdenes(leer: Lector) {
  return {
    /** Las órdenes de compra con su estado, de la más nueva a la más vieja, paginadas por cursor (guard `ordenes_de_compra.ver`, en el alcance de sucursales de quien pide). */
    listarOrdenes(
      contexto: Parameters<Lector>[0],
      entrada: EntradaDeListarOrdenes = {},
    ): Promise<RDeConsulta<PaginaDeOrdenes>> {
      return leer(contexto, ["ordenes_de_compra.ver"], (tx) =>
        listarOrdenesDentro(tx, contexto, entrada),
      ).then((r) => (r.ok ? r.valor : r));
    },
    /**
     * El detalle de una orden con lo pedido y lo recibido por línea (guard `ordenes_de_compra.ver`); `null` si no existe o no es del alcance de quien pide. Con `conPrecios`
     * exige además `costos.ver`: sin ella el operador ve la orden sin precios.
     */
    obtenerOrden(
      contexto: Parameters<Lector>[0],
      entrada: Readonly<{ ordenId: string; conPrecios?: boolean }>,
    ): Promise<RDeConsulta<OrdenDeDetalle | null>> {
      if (!esUuid(entrada.ordenId)) return Promise.resolve(err("IDENTIFICADOR_INVALIDO"));
      const conPrecios = entrada.conPrecios === true;
      return leer(
        contexto,
        conPrecios ? ["ordenes_de_compra.ver", "costos.ver"] : ["ordenes_de_compra.ver"],
        (tx) => obtenerOrdenDentro(tx, contexto, { ordenId: entrada.ordenId, conPrecios }),
      );
    },
  };
}
