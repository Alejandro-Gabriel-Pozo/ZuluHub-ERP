import {
  ESCALA_DE_CANTIDAD,
  CIEN_POR_CIENTO,
  type Cantidad,
  type Porcentaje,
} from "../cantidad/interno";
import {
  crearMontoExacto,
  ESCALA_DE_PRECIO,
  mcm,
  type Importe,
  type MontoExacto,
  type PrecioUnitario,
} from "./interno";
import { decimalesDe, exigirMismaMoneda, type Moneda } from "./moneda";

export type { MontoExacto } from "./interno";

/**
 * Operaciones permitidas sobre valores intermedios (ADR-006). Ninguna redondea: el único paso de
 * `MontoExacto` a `Importe` es `redondear`.
 */

/** PrecioUnitario × Cantidad → MontoExacto. */
export function multiplicarPrecioPorCantidad(
  m: Moneda,
  precio: PrecioUnitario,
  cantidad: Cantidad,
): MontoExacto {
  return crearMontoExacto(
    m,
    precio.unidades * cantidad.unidades * 10n ** BigInt(decimalesDe(m)),
    10n ** BigInt(ESCALA_DE_PRECIO + ESCALA_DE_CANTIDAD),
  );
}

/** Un importe ya final, visto como valor exacto (por ejemplo, como peso de un prorrateo). */
export function exactoDeImporte(importe: Importe): MontoExacto {
  return crearMontoExacto(importe.moneda, importe.unidades, 1n);
}

export function sumarExactos(a: MontoExacto, b: MontoExacto): MontoExacto {
  exigirMismaMoneda(a.moneda, b.moneda);
  const denominador = mcm(a.denominador, b.denominador);
  return crearMontoExacto(
    a.moneda,
    a.numerador * (denominador / a.denominador) + b.numerador * (denominador / b.denominador),
    denominador,
  );
}

export function restarExactos(a: MontoExacto, b: MontoExacto): MontoExacto {
  exigirMismaMoneda(a.moneda, b.moneda);
  const denominador = mcm(a.denominador, b.denominador);
  return crearMontoExacto(
    a.moneda,
    a.numerador * (denominador / a.denominador) - b.numerador * (denominador / b.denominador),
    denominador,
  );
}

/** MontoExacto × Porcentaje → MontoExacto (el porcentaje está en puntos: 10 es el 10 %). */
export function porcentajeDe(monto: MontoExacto, porcentaje: Porcentaje): MontoExacto {
  return crearMontoExacto(
    monto.moneda,
    monto.numerador * porcentaje.unidades,
    monto.denominador * CIEN_POR_CIENTO,
  );
}

/** Importe × Porcentaje → MontoExacto. */
export function porcentajeDeImporte(importe: Importe, porcentaje: Porcentaje): MontoExacto {
  return porcentajeDe(exactoDeImporte(importe), porcentaje);
}

/**
 * Extrae la base de un monto que ya contiene un porcentaje: `monto / (1 + p / 100)`. Es la
 * operación inversa de sumar el porcentaje; sirve para el neto de un precio con IVA incluido.
 */
export function quitarPorcentajeIncluido(monto: MontoExacto, porcentaje: Porcentaje): MontoExacto {
  return crearMontoExacto(
    monto.moneda,
    monto.numerador * CIEN_POR_CIENTO,
    monto.denominador * (CIEN_POR_CIENTO + porcentaje.unidades),
  );
}
