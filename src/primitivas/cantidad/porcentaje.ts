import { formatearDecimalFijo, parsearDecimalFijo } from "./decimal-fijo";
import { crearPorcentaje, ESCALA_DE_PORCENTAJE, type Porcentaje } from "./interno";

export type { Porcentaje } from "./interno";

/** Porcentaje en puntos, de 0 a 100 inclusive, con hasta 4 decimales: `21`, `10.5`, `2.5`. */
export function porcentajeDesdeTexto(texto: string): Porcentaje {
  return crearPorcentaje(parsearDecimalFijo(texto, ESCALA_DE_PORCENTAJE, "porcentaje"));
}

export function porcentajeATexto(porcentaje: Porcentaje): string {
  return formatearDecimalFijo(porcentaje.unidades, ESCALA_DE_PORCENTAJE);
}
