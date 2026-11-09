import { cantidadDesdeTexto, type Cantidad } from "../cantidad/cantidad";
import { formatearDecimalFijo, MAXIMO_DE_UNIDADES } from "../cantidad/decimal-fijo";
import { err, ok, type Resultado } from "../resultado/resultado";
import { UNIDADES, type CodigoDeUnidad } from "./unidades";

export type ErrorDeConversion = "DIMENSION_DISTINTA" | "CONVERSION_NO_EXACTA" | "FUERA_DE_RANGO";

/** Decimales de una cantidad (`numeric(18,4)`); una prueba lo compara con `cantidadDesdeTexto`. */
const DECIMALES_DE_CANTIDAD = 4;

/**
 * Convierte una cantidad entre unidades de la misma dimensión con aritmética entera exacta:
 * `unidades × factor(de) / factor(a)`. Nunca redondea (decisión 21): si la división deja resto devuelve
 * `CONVERSION_NO_EXACTA` (1 g a toneladas, 0,000001, no cabe en 4 decimales); si el resultado exacto no entra en
 * `numeric(18,4)`, `FUERA_DE_RANGO`; entre dimensiones distintas, `DIMENSION_DISTINTA` (decisión 92). Pura: sin
 * reloj, azar ni `number`. El orden de los controles es ese: dimensión, exactitud, rango.
 */
export function convertirCantidad(
  cantidad: Cantidad,
  de: CodigoDeUnidad,
  a: CodigoDeUnidad,
): Resultado<Cantidad, ErrorDeConversion> {
  const origen = UNIDADES[de];
  const destino = UNIDADES[a];
  if (origen.dimension !== destino.dimension) return err("DIMENSION_DISTINTA");
  const numerador = cantidad.unidades * origen.factor;
  if (numerador % destino.factor !== 0n) return err("CONVERSION_NO_EXACTA");
  const resultado = numerador / destino.factor;
  if (resultado > MAXIMO_DE_UNIDADES) return err("FUERA_DE_RANGO");
  return ok(cantidadDesdeTexto(formatearDecimalFijo(resultado, DECIMALES_DE_CANTIDAD)));
}
