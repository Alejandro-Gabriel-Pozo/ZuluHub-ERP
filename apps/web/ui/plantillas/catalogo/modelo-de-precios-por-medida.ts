import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import { rutaDeLosPrecios, valorInicialDelCampo } from "./modelo-de-precios-de-producto";

/**
 * El modelo de vista de los precios por medida de un producto (A13, tramo Medidas; maqueta `productos.html`, función `vPrecios` con variante): un campo de precio por medida, con el nombre de
 * la medida como rótulo y el precio vigente de la empresa puesto; «Guardar». Puro: sin React ni servidor. No se arma ningún texto nuevo. Los importes son TEXTO decimal (ADR-006).
 */

export const rutaDeLosPreciosPorMedida = (id: string): string => `${rutaDeLosPrecios(id)}/medidas`;

/** Los precios por medida como los entrega la composición (la misma forma, sin importar de dónde venga; la UI no importa los módulos). */
export type PreciosPorMedidaDeLaPantalla = Readonly<{
  id: string;
  nombre: string;
  medidas: readonly Readonly<{
    opcionId: string;
    nombre: string;
    vigente: Readonly<{ precioId: string; importe: string }> | null;
  }>[];
  claveDelCambio: string;
}>;

export type PreciosPorMedidaArmados = Readonly<{
  id: string;
  titulo: string;
  /** Un campo por medida, en el orden de la pantalla; `nombreDelCampo` es el que viaja en el formulario. */
  campos: readonly Readonly<{ nombreDelCampo: string; etiqueta: string; valorInicial: string }>[];
  guardar: string;
}>;

export function armarLosPreciosPorMedida(
  p: PreciosPorMedidaDeLaPantalla,
  d: DiccionarioResuelto = {},
): PreciosPorMedidaArmados {
  return {
    id: p.id,
    titulo: p.nombre,
    campos: p.medidas.map((m, i) => ({
      nombreDelCampo: `precio_${String(i)}`,
      etiqueta: m.nombre,
      valorInicial: valorInicialDelCampo(m.vigente === null ? null : m.vigente.importe),
    })),
    guardar: texto(d, "catalogo.accion.guardar"),
  };
}

/** El texto de un error de esta pantalla: el mismo de los precios del producto (el del precio cambiado por otra persona lleva el importe vigente, con el formato de la pantalla). */
export { textoDelError as textoDelErrorDePrecios } from "./modelo-de-precios-de-producto";
