import type { Importe } from "../dinero/importe";
import { prorratear } from "../dinero/prorrateo";
import { err, ok, type Resultado } from "../resultado/resultado";
import { pesoEntero } from "./peso-entero";

/**
 * Prorrateo mensual (D-5): importe del mes × días ocupados ÷ días reales del mes, al centavo y con
 * la mitad hacia arriba. Es `prorratear` de dinero con dos pesos (ocupados, libres): con dos partes
 * el centavo sobrante va a la de mayor resto y, en el empate exacto (la mitad), a la primera, o sea
 * la mitad sube. Nunca `number` decimal. Valor puro.
 */
export type ErrorDeProrrateoMensual =
  "IMPORTE_DEL_MES_NEGATIVO" | "DIAS_DEL_MES_INVALIDOS" | "DIAS_OCUPADOS_INVALIDOS";

/** Un mes calendario tiene de 28 a 31 días. */
const DIAS_PERMITIDOS_DEL_MES: ReadonlySet<number> = new Set([28, 29, 30, 31]);

export function prorratearMensual(
  importeDelMes: Importe,
  diasOcupados: number,
  diasDelMes: number,
): Resultado<Importe, ErrorDeProrrateoMensual> {
  if (!DIAS_PERMITIDOS_DEL_MES.has(diasDelMes)) return err("DIAS_DEL_MES_INVALIDOS");
  if (!Number.isInteger(diasOcupados) || diasOcupados < 1 || diasOcupados > diasDelMes) {
    return err("DIAS_OCUPADOS_INVALIDOS");
  }
  if (importeDelMes.unidades < 0n) return err("IMPORTE_DEL_MES_NEGATIVO");
  const moneda = importeDelMes.moneda;
  const [parte] = prorratear(importeDelMes, [
    pesoEntero(moneda, diasOcupados),
    pesoEntero(moneda, diasDelMes - diasOcupados),
  ]);
  return ok(parte as Importe);
}
