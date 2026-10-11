import { crearImporte, type Importe, type MontoExacto } from "./interno";

/**
 * Política de redondeo del comprobante: un único valor para todo el sistema (ADR-006). Cambiarla
 * es cambiar `POLITICA_VIGENTE`, no el código de cálculo.
 *
 * - `MITAD_SUBE_SIMETRICA`: la mitad se aleja del cero (10,005 → 10,01; −10,005 → −10,01).
 * - `MITAD_PAR`: la mitad va al par (10,005 → 10,00; 10,015 → 10,02). Es el criterio con el que ARCA
 *   mide su margen; queda disponible por si el contador lo prefiere.
 */
export type Politica = "MITAD_SUBE_SIMETRICA" | "MITAD_PAR";

/** Supuesto vigente, a confirmar con el contador. */
export const POLITICA_VIGENTE: Politica = "MITAD_SUBE_SIMETRICA";

/** Única puerta de `MontoExacto` a `Importe`. */
export function redondear(monto: MontoExacto, politica: Politica): Importe {
  const negativo = monto.numerador < 0n;
  const absoluto = negativo ? -monto.numerador : monto.numerador;
  const entero = absoluto / monto.denominador;
  const doble = (absoluto % monto.denominador) * 2n;
  const sube =
    doble > monto.denominador ||
    (doble === monto.denominador && (politica === "MITAD_SUBE_SIMETRICA" || entero % 2n === 1n));
  const redondeado = sube ? entero + 1n : entero;
  return crearImporte(monto.moneda, negativo ? -redondeado : redondeado);
}
