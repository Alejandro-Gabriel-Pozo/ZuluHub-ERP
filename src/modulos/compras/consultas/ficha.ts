import { err } from "../../../primitivas/resultado/resultado";
import { esUuid } from "../persistencia/filas";
import { type Lector, type RDeConsulta } from "./comun";

export type FichaDelProveedorParaCompras = Readonly<{
  parteId: string;
  /** La letra esperada, congelada al crearse la ficha; `null` = se elige a mano. `null` también si la ficha todavía no nació. */
  letraEsperada: "A" | "B" | "C" | null;
  /** `false`: la ficha todavía no nació (nadie compró ni pidió nada de este proveedor). */
  existe: boolean;
  puntosDeVenta: readonly Readonly<{ numero: number; activo: boolean }>[];
  comprobantes: readonly Readonly<{ tipo: string; activo: boolean }>[];
  pedidosPendientes: readonly Readonly<{
    id: string;
    objeto: string;
    valor: string;
    pedidoPor: string;
    pedidoEn: string;
  }>[];
  /** «Qué le compramos»: la última compra de cada producto (lo último que cobró; nunca «cero»: sin oferta no hay fila). */
  queLeCompramos: readonly Readonly<{
    productoId: string;
    presentacionId: string | null;
    precioPor: string;
    unidadDePrecioId: string | null;
    ultimoPrecio: string;
    ultimaCompraEn: string;
  }>[];
}>;

export type OfertaDeProducto = Readonly<{
  proveedorId: string;
  presentacionId: string | null;
  precioPor: string;
  unidadDePrecioId: string | null;
  ultimoPrecio: string;
  /** El costo por unidad de stock de la última compra: el que alimenta el costo de la receta (D91) y ordena «Más barato por unidad». */
  ultimoCostoPorUnidadDeStock: string;
  ultimaCompraEn: string;
}>;

export function armarConsultasDeFicha(leer: Lector) {
  return {
    /** La ficha de compra de un proveedor de la empresa (E9 §3.10). Una parte de otra empresa es indistinguible de una que no existe. */
    fichaDelProveedorParaCompras(
      contexto: Parameters<Lector>[0],
      entrada: Readonly<{ parteId: string }>,
    ): Promise<RDeConsulta<FichaDelProveedorParaCompras>> {
      if (!esUuid(entrada.parteId)) return Promise.resolve(err("IDENTIFICADOR_INVALIDO"));
      return leer(contexto, ["recepciones.ver"], async (tx) => {
        const { empresaId } = contexto;
        const ficha = await tx.fichasDeCompra.obtener(empresaId, entrada.parteId);
        const pedidos = await tx.fichasDeCompra.pedidosPendientes(empresaId, entrada.parteId);
        const ofertas = await tx.ofertasDeProveedor.delProveedor(empresaId, entrada.parteId);
        return {
          parteId: entrada.parteId,
          letraEsperada: ficha?.letraEsperada ?? null,
          existe: ficha !== null,
          puntosDeVenta: ficha?.puntosDeVenta ?? [],
          comprobantes: ficha?.comprobantes ?? [],
          pedidosPendientes: pedidos.map((p) => ({
            id: p.id,
            objeto: p.objeto,
            valor: p.valor,
            pedidoPor: p.pedidoPor,
            pedidoEn: p.pedidoEn.toISOString(),
          })),
          queLeCompramos: ofertas.map((o) => ({
            productoId: o.productoId,
            presentacionId: o.presentacionId,
            precioPor: o.precioPorTipo,
            unidadDePrecioId: o.unidadDePrecioId,
            ultimoPrecio: o.ultimoPrecio,
            ultimaCompraEn: o.ultimaCompraEn.toISOString(),
          })),
        };
      });
    },

    /**
     * Las ofertas de los proveedores de un producto, ordenadas por costo por unidad de stock («Más barato por unidad»). Pide `recepciones.ver` y
     * `costos.ver`. La lee E6 (por la composición) para el costo de las recetas: compras no importa recetas.
     */
    proveedoresDelProducto(
      contexto: Parameters<Lector>[0],
      entrada: Readonly<{ productoId: string }>,
    ): Promise<RDeConsulta<readonly OfertaDeProducto[]>> {
      if (!esUuid(entrada.productoId)) return Promise.resolve(err("IDENTIFICADOR_INVALIDO"));
      return leer(contexto, ["recepciones.ver", "costos.ver"], async (tx) =>
        (await tx.ofertasDeProveedor.delProducto(contexto.empresaId, entrada.productoId)).map(
          (o) => ({
            proveedorId: o.proveedorId,
            presentacionId: o.presentacionId,
            precioPor: o.precioPorTipo,
            unidadDePrecioId: o.unidadDePrecioId,
            ultimoPrecio: o.ultimoPrecio,
            ultimoCostoPorUnidadDeStock: o.ultimoCostoPorUnidadDeStock,
            ultimaCompraEn: o.ultimaCompraEn.toISOString(),
          }),
        ),
      );
    },
  };
}
