import { importeCero, restar, sumar, type Importe } from "../dinero/importe";
import { prorratear } from "../dinero/prorrateo";
import { err, ok, type Resultado } from "../resultado/resultado";
import { pesoEntero } from "./peso-entero";

/**
 * Reparto de un total en N noches iguales al centavo, con el resto de centavos en la última (D-30):
 * 100,00 en 3 noches = 33,33 + 33,33 + 33,34. Las primeras N−1 son iguales y la última es el total
 * menos esas, así que la suma da siempre el total. Valor puro.
 */
export type ErrorDeRepartoEnNoches = "NOCHES_INVALIDAS" | "TOTAL_NEGATIVO";

export function repartirEnNoches(
  total: Importe,
  noches: number,
): Resultado<Importe[], ErrorDeRepartoEnNoches> {
  if (!Number.isSafeInteger(noches) || noches < 1) return err("NOCHES_INVALIDAS");
  if (total.unidades < 0n) return err("TOTAL_NEGATIVO");
  // Con pesos iguales los centavos sobrantes van a las primeras partes: la última queda en el piso.
  const iguales = prorratear(
    total,
    Array.from({ length: noches }, () => pesoEntero(total.moneda, 1)),
  );
  const base = iguales[noches - 1] as Importe;
  const primeras = iguales.slice(0, noches - 1).map(() => base);
  const ultima = restar(total, primeras.reduce(sumar, importeCero(total.moneda)));
  return ok([...primeras, ultima]);
}
