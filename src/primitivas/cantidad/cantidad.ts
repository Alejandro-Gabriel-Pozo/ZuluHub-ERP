import { formatearDecimalFijo, parsearDecimalFijo } from "./decimal-fijo";
import { crearCantidad, ESCALA_DE_CANTIDAD, type Cantidad } from "./interno";

export type { Cantidad } from "./interno";

/** Cantidad no negativa con hasta 4 decimales (`numeric(18,4)`). */
export function cantidadDesdeTexto(texto: string): Cantidad {
  return crearCantidad(parsearDecimalFijo(texto, ESCALA_DE_CANTIDAD, "cantidad"));
}

export function cantidadATexto(cantidad: Cantidad): string {
  return formatearDecimalFijo(cantidad.unidades, ESCALA_DE_CANTIDAD);
}
