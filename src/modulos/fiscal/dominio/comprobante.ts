import type { Cantidad } from "../../../primitivas/cantidad/cantidad";
import type { Porcentaje } from "../../../primitivas/cantidad/porcentaje";
import { type Importe, importeCero, restar, sumar } from "../../../primitivas/dinero/importe";
import type { Moneda } from "../../../primitivas/dinero/moneda";
import {
  exactoDeImporte,
  multiplicarPrecioPorCantidad,
  porcentajeDe,
  quitarPorcentajeIncluido,
  restarExactos,
  sumarExactos,
  type MontoExacto,
} from "../../../primitivas/dinero/monto-exacto";
import type { PrecioUnitario } from "../../../primitivas/dinero/precio-unitario";
import { prorratear } from "../../../primitivas/dinero/prorrateo";
import { redondear, type Politica } from "../../../primitivas/dinero/redondeo";
import { CODIGOS_DE_ALICUOTA, porcentajeDeAlicuota, type CodigoDeAlicuota } from "./alicuota";

/**
 * Cálculo de un comprobante con precios con IVA incluido (ADR-006):
 * 1. cada línea se calcula exacta, sin redondear;
 * 2. el total se redondea UNA sola vez, sobre la suma de las líneas exactas;
 * 3. ese total se prorratea entre las líneas (pesos = sus montos exactos): las líneas suman el total;
 * 4. por alícuota: neto = redondear(total / (1 + a)), IVA = total − neto.
 *
 * Una nota de crédito se calcula igual y se informa en positivo: el tipo de comprobante da el
 * sentido, no el signo del importe.
 */

export type LineaDeComprobante = Readonly<{
  precioUnitario: PrecioUnitario;
  cantidad: Cantidad;
  /** El descuento va dentro de la línea, no como línea negativa. */
  descuento?: Porcentaje;
  alicuota: CodigoDeAlicuota;
}>;

export type DesgloseDeAlicuota = Readonly<{
  alicuota: CodigoDeAlicuota;
  total: Importe;
  neto: Importe;
  iva: Importe;
}>;

export type ComprobanteCalculado = Readonly<{
  total: Importe;
  /** Un importe por línea, en el mismo orden de entrada; suman exactamente `total`. */
  lineas: readonly Importe[];
  /** Solo las alícuotas que aparecen, en el orden de `CODIGOS_DE_ALICUOTA`. */
  desglose: readonly DesgloseDeAlicuota[];
  neto: Importe;
  iva: Importe;
}>;

function montoDeLinea(moneda: Moneda, linea: LineaDeComprobante): MontoExacto {
  const bruto = multiplicarPrecioPorCantidad(moneda, linea.precioUnitario, linea.cantidad);
  return linea.descuento === undefined
    ? bruto
    : restarExactos(bruto, porcentajeDe(bruto, linea.descuento));
}

export function desglosarAlicuota(
  codigo: CodigoDeAlicuota,
  total: Importe,
  politica: Politica,
): DesgloseDeAlicuota {
  const porcentaje = porcentajeDeAlicuota(codigo);
  if (porcentaje === null)
    return { alicuota: codigo, total, neto: total, iva: importeCero(total.moneda) };
  const neto = redondear(quitarPorcentajeIncluido(exactoDeImporte(total), porcentaje), politica);
  return { alicuota: codigo, total, neto, iva: restar(total, neto) };
}

export function calcularComprobante(
  moneda: Moneda,
  lineas: readonly LineaDeComprobante[],
  politica: Politica,
): ComprobanteCalculado {
  const exactas = lineas.map((linea) => montoDeLinea(moneda, linea));
  const sumaExacta = exactas.reduce(
    (acumulado, monto) => sumarExactos(acumulado, monto),
    exactoDeImporte(importeCero(moneda)),
  );
  const total = redondear(sumaExacta, politica);
  const importes = prorratear(total, exactas);

  const desglose = CODIGOS_DE_ALICUOTA.flatMap((codigo) => {
    // Stryker disable next-line OptionalChaining: `importes` y `lineas` tienen el mismo largo; el `?.` solo satisface noUncheckedIndexedAccess
    const delaAlicuota = importes.filter((_, posicion) => lineas[posicion]?.alicuota === codigo);
    if (delaAlicuota.length === 0) return [];
    const totalDeAlicuota = delaAlicuota.reduce(sumar, importeCero(moneda));
    return [desglosarAlicuota(codigo, totalDeAlicuota, politica)];
  });

  return {
    total,
    lineas: importes,
    desglose,
    neto: desglose.reduce((acumulado, d) => sumar(acumulado, d.neto), importeCero(moneda)),
    iva: desglose.reduce((acumulado, d) => sumar(acumulado, d.iva), importeCero(moneda)),
  };
}
