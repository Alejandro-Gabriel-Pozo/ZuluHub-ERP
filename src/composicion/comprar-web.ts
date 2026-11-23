import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import { ok } from "../primitivas/resultado/resultado";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import { entradaDeProductosParaComprar } from "./entradas-de-comprar";
import { accionDeCompras } from "./errores-de-compras";
import type { Web } from "./web";

/**
 * «Nueva compra», la parte del servidor que muestra qué se puede comprar (compras PR 5; brief `PR-5-nueva-compra-servidor.md`): los productos con su unidad base y sus presentaciones.
 *  - **Es una LECTURA**: no escribe ni audita, y no toca el nivel de compras. Pide `recepciones.ver` dentro de su transacción (el servidor, no la pantalla).
 *  - **La empresa sale de la sesión**, nunca del pedido. Qué se compra, el tope y el orden los fija el servidor; del pedido solo se toma el texto de búsqueda.
 *  - **Un texto que no pasa la lista de permitidos es «nada puede coincidir»**: lista vacía, nunca la búsqueda ensanchada.
 *  - Sin dinero y sin stock: ni precios ni costos ni existencias salen de acá.
 */

export type DependenciasDeComprarWeb = Readonly<{
  consultas: () => Pick<ReturnType<Web["consultasDeCompras"]>, "productosParaComprar">;
  respuesta: DependenciasDeRespuesta;
}>;

export type PresentacionParaLaPantalla = Readonly<{
  id: string;
  nombre: string;
  /** Texto decimal en la unidad base del producto. */
  cantidad: string;
  dePesoVariable: boolean;
}>;

export type ProductoParaComprarEnLaPantalla = Readonly<{
  productoId: string;
  nombre: string;
  unidadBase: string;
  clase: string;
  presentaciones: readonly PresentacionParaLaPantalla[];
}>;

export type ProductosParaComprarEnLaPantalla = Readonly<{
  productos: readonly ProductoParaComprarEnLaPantalla[];
}>;

export function buscarLosProductosParaComprar(
  d: DependenciasDeComprarWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<ProductosParaComprarEnLaPantalla>> {
  return accionDeCompras(
    d.respuesta,
    crudo,
    entradaDeProductosParaComprar,
    async (entrada) =>
      entrada.ninguno
        ? ok([])
        : d
            .consultas()
            .productosParaComprar(
              contexto,
              entrada.texto === undefined ? {} : { texto: entrada.texto },
            ),
    (lista) => ({
      productos: lista.map((p) => ({
        productoId: p.productoId,
        nombre: p.nombre,
        unidadBase: p.unidadBase,
        clase: p.clase,
        presentaciones: p.presentaciones.map((x) => ({
          id: x.id,
          nombre: x.nombre,
          cantidad: x.cantidad,
          dePesoVariable: x.dePesoVariable,
        })),
      })),
    }),
  );
}
