import type { DiccionarioResuelto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { textoDeLaUnidad } from "./modelo-de-ordenes";

/**
 * El modelo de vista de «Nueva orden» (maqueta `produccion.html`, 09/11/2026): de lo que ofrece la composición a lo que dibuja el formulario. Puro: sin React ni servidor. Los textos salen del catálogo
 * (ya aprobados: «Producto» de `catalogo.opciones.producto`, «Cantidad a producir», «Abrir orden», «Producir igual», «Cancelar»); no se arma ninguno nuevo. El producto se elige por nombre y su unidad es la
 * del artículo (no se elige): se dice junto a la cantidad. Sin nada para producir, el formulario no se ofrece (la página dice el genérico).
 */

export type ProductoParaElegir = Readonly<{ id: string; nombre: string; unidadId: string }>;

export type OpcionDeProducto = Readonly<{ valor: string; etiqueta: string }>;

/** Una opción por producto, con su unidad entre paréntesis («Masa (Kilogramo)»), en el orden que da el servidor. */
export function opcionesDeProducto(
  productos: readonly ProductoParaElegir[],
  d: DiccionarioResuelto = {},
): readonly OpcionDeProducto[] {
  return productos.map((p) => ({
    valor: p.id,
    etiqueta: `${p.nombre} (${textoDeLaUnidad(p.unidadId, d)})`,
  }));
}

export type TextosDeNuevaOrden = Readonly<{
  producto: string;
  cantidad: string;
  abrir: string;
  producirIgual: string;
  cancelar: string;
}>;

export const textosDeNuevaOrden = (d: DiccionarioResuelto = {}): TextosDeNuevaOrden => ({
  producto: texto(d, "catalogo.opciones.producto"),
  cantidad: texto(d, "produccion.orden.cantidad_a_producir"),
  abrir: texto(d, "produccion.accion.abrir_orden"),
  producirIgual: texto(d, "produccion.faltante.producir_igual"),
  cancelar: texto(d, "catalogo.accion.cancelar"),
});
