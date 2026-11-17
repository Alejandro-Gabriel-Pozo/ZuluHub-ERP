import type { Importe } from "../../../primitivas/dinero/importe";
import type { PrecioUnitario } from "../../../primitivas/dinero/precio-unitario";

/**
 * Cortesía (decisión 155; E4 §3.5 paso 2): vender a $0 es posible pero SIEMPRE con confirmación y marcado para revisar. `TOTAL`: el
 * ticket vale 0 (estado `CORTESIA`, sin cobro). `PARCIAL`: alguna línea vale 0 dentro de un ticket de total mayor que 0 (el ticket sigue
 * su camino y queda marcado). Puro.
 */
export type TipoDeCortesia = "TOTAL" | "PARCIAL";

/** Una línea a $0 pide la confirmación `VENTA_A_CERO` al agregarla. */
export function lineaEsACero(precioUnitario: PrecioUnitario): boolean {
  return precioUnitario.unidades === 0n;
}

export function tipoDeCortesia(
  total: Importe,
  preciosUnitarios: readonly PrecioUnitario[],
): TipoDeCortesia | null {
  if (total.unidades === 0n) return "TOTAL";
  return preciosUnitarios.some(lineaEsACero) ? "PARCIAL" : null;
}
