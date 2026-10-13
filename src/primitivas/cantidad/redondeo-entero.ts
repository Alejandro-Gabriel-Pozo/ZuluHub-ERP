/**
 * Política de redondeo de una división entera, una sola para cantidades y dinero (ADR-006):
 *
 * - `MITAD_SUBE_SIMETRICA`: la mitad se aleja del cero (10,005 → 10,01; −10,005 → −10,01).
 * - `MITAD_PAR`: la mitad va al par (10,005 → 10,00; 10,015 → 10,02).
 */
export type PoliticaDeRedondeo = "MITAD_SUBE_SIMETRICA" | "MITAD_PAR";

/**
 * `numerador / denominador` redondeado a entero según la política. El denominador es positivo (lo
 * garantizan quienes llaman). Vive en `cantidad` porque `dinero` depende de `cantidad` y no al revés.
 */
export function dividirRedondeando(
  numerador: bigint,
  denominador: bigint,
  politica: PoliticaDeRedondeo,
): bigint {
  // Stryker disable next-line EqualityOperator: con numerador cero el signo no cambia el resultado
  const negativo = numerador < 0n;
  const absoluto = negativo ? -numerador : numerador;
  const entero = absoluto / denominador;
  const doble = (absoluto % denominador) * 2n;
  const sube =
    doble > denominador ||
    (doble === denominador && (politica === "MITAD_SUBE_SIMETRICA" || entero % 2n === 1n));
  const redondeado = sube ? entero + 1n : entero;
  return negativo ? -redondeado : redondeado;
}
