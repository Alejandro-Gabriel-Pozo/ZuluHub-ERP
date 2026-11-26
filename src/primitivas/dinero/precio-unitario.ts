import {
  formatearDecimalFijo,
  MAXIMO_DE_UNIDADES,
  parsearDecimalFijo,
} from "../cantidad/decimal-fijo";
import { crearPrecioUnitario, ESCALA_DE_PRECIO, type PrecioUnitario } from "./interno";

export type { PrecioUnitario } from "./interno";

/** Precio unitario no negativo con hasta 6 decimales (`numeric(18,6)`). */
export function precioUnitarioDesdeTexto(texto: string): PrecioUnitario {
  return crearPrecioUnitario(parsearDecimalFijo(texto, ESCALA_DE_PRECIO, "precio unitario"));
}

export function precioUnitarioATexto(precio: PrecioUnitario): string {
  return formatearDecimalFijo(precio.unidades, ESCALA_DE_PRECIO);
}

/** Los decimales que admite un precio o costo unitario (`numeric(18,6)`): lo que el campo de la web deriva, no repite (una regla, un lugar). */
export const DECIMALES_DE_PRECIO_UNITARIO = ESCALA_DE_PRECIO;
/** Los dígitos enteros que admite un precio o costo unitario: los 18 de `numeric(18,6)` menos los decimales. */
export const ENTEROS_DE_PRECIO_UNITARIO = String(MAXIMO_DE_UNIDADES).length - ESCALA_DE_PRECIO;
