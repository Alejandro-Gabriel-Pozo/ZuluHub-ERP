import type { ContextoOperativo } from "../../../contexto/contexto";
import { CLASES_COMPRABLES } from "../../catalogo/publico";
import type { TxDeConsultasDeCompras } from "./contrato";

/**
 * «Productos para comprar» (E9 §3.3, INV §7): lo que la pantalla «Nueva compra» ofrece para elegir. Solo lectura: no escribe ni audita, y no lee el nivel de compras (esa lectura
 * crea la fila y es de otra pantalla). Vive acá y no en `consultas/` por la misma razón que el resto de las lecturas de compras.
 *
 * Reglas (cada una con su prueba en `test/integracion/compras-productos-para-comprar.test.ts`):
 *  - **Qué se compra**: productos ACTIVOS de la empresa del contexto y de las clases que `registrarCompra` acepta (`CLASES_COMPRABLES`: materia prima, insumo y reventa; el
 *    elaborado y el vendible no se compran). Es la lista del catálogo, no una copia: si el catálogo cambia qué se compra, esta lectura cambia con él.
 *  - **Cómo se busca**: por el prefijo del nombre, con la regla del catálogo (`tx.productos.listar`); no se repite acá. El texto llega ya validado por la composición.
 *  - **Tope y orden fijos**: hasta `TOPE_DE_PRODUCTOS_PARA_COMPRAR`, por nombre y luego por id. El tope lo pone el servidor, nunca el pedido.
 *  - **Presentaciones**: solo las ACTIVAS de cada producto, en UNA lectura para toda la página, con su cantidad en la unidad base. Un producto sin presentaciones se compra en su unidad base.
 *  - **Peso variable**: es dato de la presentación (el producto no lo tiene): cada una dice si se pesa al recibir. Se informa; el caso de uso exige el peso real al registrar.
 *  - **Nada de dinero ni de stock**: ni precios ni costos ni existencias (los costos piden `costos.ver`, que esta lectura no declara).
 */

/** Cuántos productos trae como máximo una búsqueda: para un buscador que se escribe, no para listar el catálogo. */
export const TOPE_DE_PRODUCTOS_PARA_COMPRAR = 50;

export type PresentacionParaComprar = Readonly<{
  id: string;
  nombre: string;
  /** Texto decimal de 4 decimales, en la unidad base del producto (en peso variable es solo el aproximado). */
  cantidad: string;
  dePesoVariable: boolean;
}>;

export type ProductoParaComprar = Readonly<{
  productoId: string;
  nombre: string;
  /** El código de la unidad base (`kg`, `un`…): la pantalla lo muestra con la lista de unidades que ya tiene. */
  unidadBase: string;
  clase: string;
  presentaciones: readonly PresentacionParaComprar[];
}>;

export type EntradaDeProductosParaComprar = Readonly<{
  /** Prefijo del nombre, ya validado; `undefined` = sin filtro. */
  texto?: string | undefined;
}>;

export async function productosParaComprarDentro(
  tx: TxDeConsultasDeCompras,
  contexto: ContextoOperativo,
  entrada: EntradaDeProductosParaComprar,
): Promise<readonly ProductoParaComprar[]> {
  const productos = await tx.productos.listar(contexto.empresaId, {
    claseDeUso: CLASES_COMPRABLES,
    activo: true,
    limite: TOPE_DE_PRODUCTOS_PARA_COMPRAR,
    ...(entrada.texto === undefined ? {} : { texto: entrada.texto }),
  });
  if (productos.length === 0) return [];
  const presentaciones = await tx.presentacionesDeProducto.deLosProductos(
    contexto.empresaId,
    productos.map((p) => p.producto.id),
  );
  return productos.map(({ producto }) => ({
    productoId: producto.id,
    nombre: producto.nombre,
    unidadBase: producto.unidadBaseId,
    clase: producto.claseDeUso,
    presentaciones: presentaciones
      .filter((x) => x.productoId === producto.id)
      .map((x) => ({
        id: x.id,
        nombre: x.nombre,
        cantidad: x.cantidad,
        dePesoVariable: x.dePesoVariable,
      })),
  }));
}
