import { formatearDecimalFijo, parsearDecimalFijo } from "../cantidad/decimal-fijo";
import { crearPrecioUnitario, ESCALA_DE_PRECIO, type PrecioUnitario } from "./interno";

export type { PrecioUnitario } from "./interno";

/** Precio unitario no negativo con hasta 6 decimales (`numeric(18,6)`). */
export function precioUnitarioDesdeTexto(texto: string): PrecioUnitario {
  return crearPrecioUnitario(parsearDecimalFijo(texto, ESCALA_DE_PRECIO, "precio unitario"));
}

export function precioUnitarioATexto(precio: PrecioUnitario): string {
  return formatearDecimalFijo(precio.unidades, ESCALA_DE_PRECIO);
}
