import { formatearDecimalFijo, parsearDecimalFijo } from "./decimal-fijo";
import { crearCantidad, ESCALA_DE_CANTIDAD, type Cantidad } from "./interno";
import { MAXIMO_DE_UNIDADES } from "./decimal-fijo";

export type { Cantidad } from "./interno";

/** Cantidad no negativa con hasta 4 decimales (`numeric(18,4)`). */
export function cantidadDesdeTexto(texto: string): Cantidad {
  return crearCantidad(parsearDecimalFijo(texto, ESCALA_DE_CANTIDAD, "cantidad"));
}

export function cantidadATexto(cantidad: Cantidad): string {
  return formatearDecimalFijo(cantidad.unidades, ESCALA_DE_CANTIDAD);
}

/** Cuántos decimales y cuántos dígitos enteros admite una cantidad (`numeric(18,4)`): lo que un campo de cantidad necesita saber, desde su fuente. */
export const DECIMALES_DE_LA_CANTIDAD = ESCALA_DE_CANTIDAD;
export const ENTEROS_MAXIMOS_DE_LA_CANTIDAD =
  String(MAXIMO_DE_UNIDADES).length - ESCALA_DE_CANTIDAD;
