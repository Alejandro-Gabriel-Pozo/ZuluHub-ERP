import { cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import { ErrorDeValor } from "../../../primitivas/cantidad/errores";
import {
  formatearDecimalFijo,
  MAXIMO_DE_UNIDADES,
} from "../../../primitivas/cantidad/decimal-fijo";
import { importeDesdeTexto } from "../../../primitivas/dinero/importe";
import { ARS, decimalesDe } from "../../../primitivas/dinero/moneda";
import { precioUnitarioDesdeTexto } from "../../../primitivas/dinero/precio-unitario";

/**
 * Lectura y escritura de los decimales exactos de compras (ADR-006): todo importe, precio y cantidad entra y sale como TEXTO decimal y se calcula con
 * `bigint` en su unidad mínima; nunca pasa por `number`. Las escalas salen de las primitivas (cantidad 4, precio y costo 6, importe 2 en ARS), no
 * se repiten. Una lectura inválida da `null` (el caso de uso la traduce a su error con nombre); lo inesperado se lanza.
 */
export const UNO_DE_CANTIDAD = cantidadDesdeTexto("1").unidades;
export const UNO_DE_PRECIO = precioUnitarioDesdeTexto("1").unidades;
export const UNO_DE_IMPORTE = 10n ** BigInt(decimalesDe(ARS));
export const MAXIMO_DE_UNIDADES_EXACTAS = MAXIMO_DE_UNIDADES;

const escalaDe = (uno: bigint): number => uno.toString().length - 1;
export const ESCALA_DE_LA_CANTIDAD = escalaDe(UNO_DE_CANTIDAD);
export const ESCALA_DEL_PRECIO = escalaDe(UNO_DE_PRECIO);
export const ESCALA_DEL_IMPORTE = escalaDe(UNO_DE_IMPORTE);

function leer(texto: string, parsear: (t: string) => { readonly unidades: bigint }): bigint | null {
  try {
    return parsear(texto).unidades;
  } catch (error) {
    if (error instanceof ErrorDeValor) return null;
    throw error;
  }
}

/** Las unidades mínimas (diezmilésimas) de una cantidad no negativa, o `null` si el texto no es un decimal canónico de hasta 4 decimales. */
export const leerCantidad = (texto: string): bigint | null => leer(texto, cantidadDesdeTexto);
/** Las unidades mínimas (millonésimos) de un precio o costo no negativo, o `null`. */
export const leerPrecio = (texto: string): bigint | null => leer(texto, precioUnitarioDesdeTexto);
/** Las unidades mínimas (centavos) de un importe en pesos; `null` si no es un decimal canónico de hasta 2 decimales. Puede ser negativo: lo decide quien lo usa. */
export const leerImporte = (texto: string): bigint | null =>
  leer(texto, (t) => importeDesdeTexto(ARS, t));

/**
 * Una cantidad o un precio MAYOR que cero, o `null`. El `null` de la lectura no se compara con `0n` aparte: `null <= 0n` es verdadero en JavaScript, así que
 * el chequeo `!== null` de abajo es un mutante equivalente (con `null` el `>` ya da falso).
 */
function positivo(unidades: bigint | null): bigint | null {
  // Stryker disable next-line ConditionalExpression: equivalente, `null > 0n` es falso de todos modos
  return unidades !== null && unidades > 0n ? unidades : null;
}
export const leerCantidadPositiva = (texto: string): bigint | null => positivo(leerCantidad(texto));
export const leerPrecioPositivo = (texto: string): bigint | null => positivo(leerPrecio(texto));

export const textoDeCantidad = (unidades: bigint): string =>
  formatearDecimalFijo(unidades, ESCALA_DE_LA_CANTIDAD);
export const textoDePrecio = (unidades: bigint): string =>
  formatearDecimalFijo(unidades, ESCALA_DEL_PRECIO);
export const textoDeImporte = (unidades: bigint): string =>
  formatearDecimalFijo(unidades, ESCALA_DEL_IMPORTE);
