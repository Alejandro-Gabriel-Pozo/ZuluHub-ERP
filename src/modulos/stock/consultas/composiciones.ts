import type { ContextoOperativo } from "../../../contexto/contexto";
import { esUuid } from "../persistencia/filas";
import { type Lector, type RDeConsulta } from "./comun";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

export type ComponenteDeLaReceta = Readonly<{
  articuloId: string;
  /** El producto del componente (el artículo es su control de stock). */
  productoId: string;
  nombre: string;
  /** Texto decimal exacto, en `unidadId`. */
  cantidad: string;
  unidadId: string;
}>;

/**
 * La última versión de la receta de un producto. `componentes` vacío = receta retirada (el producto vuelve a «falta receta»): igual se informa su
 * número, porque es la `versionEsperada` de quien la guarda de nuevo.
 */
export type ComposicionDeProducto = Readonly<{
  productoId: string;
  version: number;
  /** Texto decimal exacto: cuántas unidades vendidas rinde la receta. */
  rinde: string;
  componentes: readonly ComponenteDeLaReceta[];
}>;

/**
 * La receta vigente de un producto (E5 §3.4). Guard `stock.ver`; la receta es de la empresa (no de una sucursal), así que la ve quien puede
 * mirar stock. `null` si el producto nunca tuvo receta, no existe o es de otra empresa (indistinguibles: la RLS); en ese caso la versión
 * esperada para guardar la primera es 0.
 */
export function armarConsultasDeComposiciones(leer: Lector) {
  return {
    composicionDeProducto: (
      contexto: ContextoOperativo,
      entrada: Readonly<{ productoId: string }>,
    ): Promise<RDeConsulta<ComposicionDeProducto | null>> =>
      leer(contexto, DECLARACIONES_DE_CONSULTAS.composicionDeProducto.accion, async (tx) => {
        if (typeof entrada.productoId !== "string" || !esUuid(entrada.productoId)) return null;
        const version = await tx.composicionesDeStock.ultimaVersion(
          contexto.empresaId,
          entrada.productoId,
        );
        if (version === null) return null;
        const articulos = await tx.articulosDeStock.porIds(
          contexto.empresaId,
          version.componentes.map((c) => c.articuloId),
        );
        const productoDe = new Map(articulos.map((a) => [a.id, a.productoId]));
        const productos = await tx.productosParaStock.porIds(contexto.empresaId, [
          ...productoDe.values(),
        ]);
        const nombreDe = new Map(productos.map((p) => [p.id, p.nombre]));
        return {
          productoId: version.productoId,
          version: version.numero,
          rinde: version.rinde,
          componentes: version.componentes.map((c) => {
            const productoId = productoDe.get(c.articuloId) ?? c.articuloId;
            return {
              articuloId: c.articuloId,
              productoId,
              nombre: nombreDe.get(productoId) ?? productoId,
              cantidad: c.cantidad,
              unidadId: c.unidadId,
            };
          }),
        };
      }),
  };
}
