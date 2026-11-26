import type { DiccionarioResuelto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { sinCerosDeRelleno } from "../recetas/modelo-de-formulario-de-receta";
import { rutaDeLaOrden } from "./filtros-de-ordenes";
import { textoDeLaUnidad } from "./modelo-de-ordenes";

/**
 * El modelo de vista de «Cerrar con lo real» (maqueta `produccion.html`, 09/11/2026): de lo que ofrece la composición a lo que dibuja el formulario. Puro: sin React ni servidor. Los textos salen del catálogo (ya
 * aprobados: «Cerrar con lo real», «Cantidad obtenida», «Vence», «Consumió», «Cerrar la orden», «Producir igual», «Cancelar»); no se arma ninguno nuevo. Cada ingrediente trae lo ESPERADO como valor inicial: lo real
 * que se carga reemplaza a lo esperado, nunca se calcula acá (el costo lo congela el servidor y no se muestra al cargar). El producto se obtiene en la unidad del producto de la orden (no se elige).
 */

export type OrdenParaElCierre = Readonly<{
  id: string;
  numero: number;
  nombre: string;
  unidadId: string;
  cantidadEsperada: string;
  renglones: readonly Readonly<{ nombre: string; esperado: string; unidadId: string }>[];
}>;

type RenglonDelCierre = Readonly<{
  /** «Harina 000 (Kilogramo)»: el ingrediente y la unidad en que se carga lo real. */
  etiqueta: string;
  /** Lo esperado como texto decimal sin ceros de relleno: el valor con que arranca el campo. */
  inicial: string;
}>;

type TextosDelCierre = Readonly<{
  obtenido: string;
  vence: string;
  consumio: string;
  cerrar: string;
  producirIgual: string;
  cancelar: string;
}>;

export type CierreArmado = Readonly<{
  /** «Masa de medialuna»: el producto que se obtiene. */
  producto: string;
  /** La unidad de lo obtenido, dicha («Kilogramo»). */
  unidad: string;
  /** Lo esperado, como valor inicial de «Cantidad obtenida». */
  obtenidoInicial: string;
  renglones: readonly RenglonDelCierre[];
  textos: TextosDelCierre;
  /** Adónde vuelve «Cancelar»: la ficha de la orden. */
  hrefDeCancelar: string;
}>;

export function armarElCierre(orden: OrdenParaElCierre, d: DiccionarioResuelto = {}): CierreArmado {
  return {
    producto: orden.nombre,
    unidad: textoDeLaUnidad(orden.unidadId, d),
    obtenidoInicial: sinCerosDeRelleno(orden.cantidadEsperada),
    renglones: orden.renglones.map((r) => ({
      etiqueta: `${r.nombre} (${textoDeLaUnidad(r.unidadId, d)})`,
      inicial: sinCerosDeRelleno(r.esperado),
    })),
    textos: {
      obtenido: texto(d, "produccion.cierre.cantidad_obtenida"),
      vence: texto(d, "produccion.cierre.vence"),
      consumio: texto(d, "produccion.orden.consumio"),
      cerrar: texto(d, "produccion.accion.cerrar_la_orden"),
      producirIgual: texto(d, "produccion.faltante.producir_igual"),
      cancelar: texto(d, "catalogo.accion.cancelar"),
    },
    hrefDeCancelar: rutaDeLaOrden(orden.id),
  };
}
