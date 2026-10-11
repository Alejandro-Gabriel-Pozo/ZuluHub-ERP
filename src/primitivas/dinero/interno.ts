import { MAXIMO_DE_UNIDADES, validarRango } from "../cantidad/decimal-fijo";
import type { Marca } from "../identificadores/marca";
import type { Moneda } from "./moneda";

/**
 * Constructores sin parser, solo para `primitivas/dinero` y `primitivas/cantidad`. Una regla de
 * arquitectura impide importarlos desde otro lugar. Por eso, fuera de las primitivas, un `Importe`
 * solo nace de texto validado, de una suma/resta de importes, de `redondear` o de `prorratear`.
 */

/** Escala de `numeric(18,6)`. */
export const ESCALA_DE_PRECIO = 6;

/** Importe final en unidad mínima (centavos). Se guarda, se muestra, se informa. */
export type Importe = Marca<{ readonly moneda: Moneda; readonly unidades: bigint }, "Importe">;

/** Precio por unidad, no negativo, escala 6. Sin moneda: la moneda la pone el comprobante. */
export type PrecioUnitario = Marca<{ readonly unidades: bigint }, "PrecioUnitario">;

/**
 * Valor intermedio exacto, en unidades mínimas, como fracción reducida. No se persiste, no se
 * muestra, no se serializa: `JSON.stringify` falla porque contiene `bigint`.
 */
export type MontoExacto = Marca<
  { readonly moneda: Moneda; readonly numerador: bigint; readonly denominador: bigint },
  "MontoExacto"
>;

export function crearImporte(moneda: Moneda, unidades: bigint): Importe {
  validarRango(unidades, -MAXIMO_DE_UNIDADES, MAXIMO_DE_UNIDADES, "importe");
  return Object.freeze({ moneda, unidades }) as Importe;
}

export function crearPrecioUnitario(unidades: bigint): PrecioUnitario {
  validarRango(unidades, 0n, MAXIMO_DE_UNIDADES, "precio unitario");
  return Object.freeze({ unidades }) as PrecioUnitario;
}

export function mcd(a: bigint, b: bigint): bigint {
  // Stryker disable next-line EqualityOperator: con cero, `-0n` y `0n` son el mismo valor
  let x = a < 0n ? -a : a;
  let y = b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

export function mcm(a: bigint, b: bigint): bigint {
  return (a / mcd(a, b)) * b;
}

export function crearMontoExacto(
  moneda: Moneda,
  numerador: bigint,
  denominador: bigint,
): MontoExacto {
  if (denominador <= 0n) throw new RangeError("el denominador debe ser positivo");
  const divisor = mcd(numerador, denominador);
  return Object.freeze({
    moneda,
    numerador: numerador / divisor,
    denominador: denominador / divisor,
  }) as MontoExacto;
}
