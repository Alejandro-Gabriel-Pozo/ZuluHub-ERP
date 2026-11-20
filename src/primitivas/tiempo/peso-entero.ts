import { formatearDecimalFijo } from "../cantidad/decimal-fijo";
import { exactoDeImporte, type MontoExacto } from "../dinero/monto-exacto";
import { importeDesdeTexto } from "../dinero/importe";
import { decimalesDe, type Moneda } from "../dinero/moneda";

/**
 * Peso entero `k` para `prorratear` (dinero): solo cuenta la proporción entre pesos, así que `k`
 * unidades mínimas sirven de peso sin necesitar un constructor de `MontoExacto` (que es interno).
 */
export function pesoEntero(m: Moneda, k: number): MontoExacto {
  return exactoDeImporte(importeDesdeTexto(m, formatearDecimalFijo(BigInt(k), decimalesDe(m))));
}
