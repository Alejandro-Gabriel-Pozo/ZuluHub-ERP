import type { ContextoOperativo } from "../../../contexto/contexto";
import { esUuid } from "../persistencia/filas";
import { type Lector, type RDeConsulta } from "./comun";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

/** Si de un producto se lleva existencia y movimientos: tiene un artículo de stock activo. */
export type ControlDeStockDelProducto = Readonly<{ controlado: boolean }>;

/**
 * Si el producto tiene el tilde «Se controla el stock» (un artículo de stock ACTIVO). Guard `stock.ver`. Un producto que no existe, que es de otra empresa (la RLS) o cuyo id no es un
 * UUID responde `controlado: false`, igual que uno sin controlar: no revela si existe. Es una lectura: no escribe ni audita.
 */
export function armarConsultasDeArticulos(leer: Lector) {
  return {
    controlDeStockDelProducto: (
      contexto: ContextoOperativo,
      entrada: Readonly<{ productoId: string }>,
    ): Promise<RDeConsulta<ControlDeStockDelProducto>> =>
      leer(contexto, DECLARACIONES_DE_CONSULTAS.controlDeStockDelProducto.accion, async (tx) => {
        if (typeof entrada.productoId !== "string" || !esUuid(entrada.productoId)) {
          return { controlado: false };
        }
        const articulo = await tx.articulosDeStock.porProducto(
          contexto.empresaId,
          entrada.productoId,
        );
        return { controlado: articulo !== null && articulo.activo };
      }),
  };
}
