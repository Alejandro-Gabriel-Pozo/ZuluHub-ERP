import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import { ok } from "../primitivas/resultado/resultado";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import { entradaDeCotizarCompra, entradaDeProductosParaComprar } from "./entradas-de-comprar";
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
  consultas: () => Pick<
    ReturnType<Web["consultasDeCompras"]>,
    "productosParaComprar" | "cotizarCompra"
  >;
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

export type RenglonCotizadoParaLaPantalla = Readonly<{
  productoId: string;
  /** Texto decimal de 4 decimales, en la unidad base del producto («Entra a tu stock»). */
  cantidadEnStock: string;
  /** Texto decimal de 2 decimales; `null` sin precio (nunca cero). */
  importe: string | null;
  /** Texto decimal de 6 decimales; `null` sin precio («Costo por unidad de stock»). */
  costoPorUnidadDeStock: string | null;
  dePesoVariable: boolean;
}>;

export type CompraCotizadaParaLaPantalla = Readonly<{
  renglones: readonly RenglonCotizadoParaLaPantalla[];
}>;

/**
 * Cuánto entra al stock y cuánto cuesta cada renglón, mientras se carga la compra y ANTES de guardarla. Es una LECTURA con la misma cuenta que el alta: no escribe, no audita, no
 * bloquea. La empresa sale de la sesión; un renglón que el alta rechazaría se rechaza igual (el genérico o el texto propio de la cantidad y el precio).
 */
export function cotizarLaCompra(
  d: DependenciasDeComprarWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<CompraCotizadaParaLaPantalla>> {
  return accionDeCompras(
    d.respuesta,
    crudo,
    entradaDeCotizarCompra,
    (entrada) => d.consultas().cotizarCompra(contexto, entrada),
    (cotizada) => ({
      renglones: cotizada.renglones.map((r) => ({
        productoId: r.productoId,
        cantidadEnStock: r.cantidadEnStock,
        importe: r.importe,
        costoPorUnidadDeStock: r.costoPorUnidadDeStock,
        dePesoVariable: r.dePesoVariable,
      })),
    }),
  );
}
