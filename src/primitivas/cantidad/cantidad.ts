import { formatearDecimalFijo, MAXIMO_DE_UNIDADES, parsearDecimalFijo } from "./decimal-fijo";
import { crearCantidad, ESCALA_DE_CANTIDAD, type Cantidad } from "./interno";

export type { Cantidad } from "./interno";

/** Cantidad no negativa con hasta 4 decimales (`numeric(18,4)`). */
export function cantidadDesdeTexto(texto: string): Cantidad {
  return crearCantidad(parsearDecimalFijo(texto, ESCALA_DE_CANTIDAD, "cantidad"));
}

export function cantidadATexto(cantidad: Cantidad): string {
  return formatearDecimalFijo(cantidad.unidades, ESCALA_DE_CANTIDAD);
}

/** Los decimales que admite una cantidad (`numeric(18,4)`): lo que el campo de la web deriva, no repite (una regla, un lugar). */
export const DECIMALES_DE_CANTIDAD = ESCALA_DE_CANTIDAD;
/** Los dígitos enteros que admite una cantidad: los 18 de `numeric(18,4)` menos los decimales. */
export const ENTEROS_DE_CANTIDAD = String(MAXIMO_DE_UNIDADES).length - ESCALA_DE_CANTIDAD;
