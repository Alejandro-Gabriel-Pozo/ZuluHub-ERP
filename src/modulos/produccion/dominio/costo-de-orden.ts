import { dividirRedondeando } from "../../../primitivas/cantidad/redondeo-entero";
import { POLITICA_VIGENTE } from "../../../primitivas/dinero/redondeo";

/**
 * El costo de una orden (E6 §3.3, D95, D24): se CONGELA al cerrar y no se recalcula nunca. `costo_total = Σ cantidad_real × costo_congelado`
 * (exacto), `costo_unitario = costo_total ÷ obtenido` redondeado UNA vez a 6 decimales. Si algún renglón consumido no tiene costo, el
 * producto nace `SIN_COSTO` (no se inventa un costo parcial, S-11). Puro: cantidades en unidades mínimas (10⁻⁴), costos en 10⁻⁶ pesos por
 * unidad. Previene un costo de producto que ignora un ingrediente sin costo o que acumula redondeos por renglón.
 */
export type ConsumoCosteado = Readonly<{
  /** Lo realmente consumido, en unidades mínimas (> 0). */
  unidades: bigint;
  /** El costo congelado del renglón del libro, 10⁻⁶ pesos por unidad; `null` = sin costo. */
  costoUnitario: bigint | null;
}>;

export type CostoDeOrden =
  | Readonly<{ estado: "SIN_COSTO" }>
  | Readonly<{
      estado: "DEFINITIVO";
      /** Σ cantidad × costo, exacto, en 10⁻¹⁰ pesos. */
      costoTotalExacto: bigint;
      /** 10⁻⁶ pesos por unidad obtenida. */
      costoUnitario: bigint;
      /** `costoUnitario × obtenido − costoTotalExacto` en 10⁻¹⁰ pesos: lo que el redondeo suma o resta. */
      residuo: bigint;
    }>;

export function costearOrden(consumos: readonly ConsumoCosteado[], obtenido: bigint): CostoDeOrden {
  if (obtenido <= 0n) throw new RangeError("costo de orden: lo obtenido es mayor que cero");
  let total = 0n;
  for (const c of consumos) {
    if (c.unidades === 0n) continue;
    if (c.costoUnitario === null) return { estado: "SIN_COSTO" };
    total += c.unidades * c.costoUnitario;
  }
  const costoUnitario = dividirRedondeando(total, obtenido, POLITICA_VIGENTE);
  return {
    estado: "DEFINITIVO",
    costoTotalExacto: total,
    costoUnitario,
    residuo: costoUnitario * obtenido - total,
  };
}
