import type { Cantidad } from "../../../primitivas/cantidad/cantidad";
import { importeCero, type Importe } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import {
  exactoDeImporte,
  multiplicarPrecioPorCantidad,
  sumarExactos,
} from "../../../primitivas/dinero/monto-exacto";
import { prorratear } from "../../../primitivas/dinero/prorrateo";
import type { PrecioUnitario } from "../../../primitivas/dinero/precio-unitario";
import { POLITICA_VIGENTE, redondear } from "../../../primitivas/dinero/redondeo";

/**
 * `calcularTicket` (E4 §3.2 y §3.5 paso 5): LA cuenta del ticket, una sola. El importe exacto de cada línea es `precio unitario ×
 * cantidad` (escala 6 + 4, sin perder nada) y NINGUNA línea se redondea sola: el total se redondea UNA vez para todo el grupo (mitad
 * hacia arriba, ADR-006; un solo grupo por ticket en E4) y el redondeo se reparte entre las líneas por restos mayores, de modo que la
 * suma de los renglones es el total al centavo. Ejemplo (decisión 162): dos líneas de 0,5 × $ 9,95 valen $ 4,975 cada una; redondeadas
 * una por una darían 4,98 + 4,98 = 9,96, y el total exacto es 9,95, que es lo que se cobra. Puro: sin reloj ni azar, sin `number`.
 * Previene: el centavo de más o de menos entre el ticket y el cobro (el error que ADR-006 describe).
 */
export type LineaACalcular = Readonly<{
  id: string;
  precioUnitario: PrecioUnitario;
  cantidad: Cantidad;
}>;

export type RenglonCalculado = Readonly<{ id: string; importe: Importe }>;

export type TicketCalculado = Readonly<{
  total: Importe;
  /** En el mismo orden que las líneas recibidas. */
  renglones: readonly RenglonCalculado[];
}>;

export function calcularTicket(lineas: readonly LineaACalcular[]): TicketCalculado {
  const exactos = lineas.map((l) =>
    multiplicarPrecioPorCantidad(ARS, l.precioUnitario, l.cantidad),
  );
  const suma = exactos.reduce(sumarExactos, exactoDeImporte(importeCero(ARS)));
  const total = redondear(suma, POLITICA_VIGENTE);
  const importes = prorratear(total, exactos);
  return {
    total,
    renglones: lineas.map((l, i) => ({ id: l.id, importe: importes[i] as Importe })),
  };
}
