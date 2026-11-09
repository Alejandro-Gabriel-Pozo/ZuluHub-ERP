import { ErrorDeValor } from "../cantidad/errores";
import { err, ok, type Resultado } from "../resultado/resultado";
import { crearPrecioUnitario, type PrecioUnitario } from "./interno";
import { precioUnitarioDesdeTexto } from "./precio-unitario";

/**
 * Aritmética exacta del precio de venta del catálogo (E2 mínimo §3.6): leer un precio de texto sin lanzar, sumar el precio base y los
 * recargos (la ÚNICA cuenta del precio que ve la caja y que usará la carta) y llevar un precio de una unidad a otra sin redondear. Todo
 * con `bigint` y escala 6; nunca `number`. El redondeo es del comprobante, una vez (ADR-006).
 */
export type ErrorDePrecio = "PRECIO_INVALIDO";

/** Un precio de texto decimal exacto (punto decimal, hasta 6 decimales, sin signo ni exponente ni miles), o el error. */
export function precioDeVentaDesdeTexto(texto: string): Resultado<PrecioUnitario, ErrorDePrecio> {
  try {
    return ok(precioUnitarioDesdeTexto(texto));
  } catch (error) {
    if (error instanceof ErrorDeValor) return err("PRECIO_INVALIDO");
    throw error;
  }
}

/** Precio base más todos los recargos. Lanza `ErrorDeValor` (`FUERA_DE_RANGO`) si no entra en `numeric(18,6)`. */
export function sumarPrecios(
  base: PrecioUnitario,
  recargos: readonly PrecioUnitario[],
): PrecioUnitario {
  return crearPrecioUnitario(recargos.reduce((suma, r) => suma + r.unidades, base.unidades));
}

/**
 * `precio × numerador / denominador` solo si el resultado es exacto en 6 decimales y entra en el rango; si no, `null` (el llamador
 * decide qué hace: en el catálogo, deja el producto en precio abierto, decisión 169). `denominador` positivo.
 */
export function precioPorFactor(
  precio: PrecioUnitario,
  numerador: bigint,
  denominador: bigint,
): PrecioUnitario | null {
  if (denominador <= 0n || numerador < 0n) throw new RangeError("factor inválido");
  const producto = precio.unidades * numerador;
  if (producto % denominador !== 0n) return null;
  try {
    return crearPrecioUnitario(producto / denominador);
  } catch (error) {
    if (error instanceof ErrorDeValor) return null;
    throw error;
  }
}
