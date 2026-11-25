import { UNIDADES, type CodigoDeUnidad } from "../../../../primitivas/unidades/unidades";
import { ESCALA_DEL_PRECIO, textoDePrecio, UNO_DE_CANTIDAD } from "../decimal";

/**
 * Las cuentas de dinero de la exportación (dueño, 25/11/2026): todo en `bigint` en la unidad mínima, nunca `number`. El reparto del abonado y el costo por kilo son
 * columnas DERIVADAS: se calculan al exportar y no se guardan ni reemplazan lo cargado.
 */

/**
 * Reparte `total` (centavos, no negativo) entre `pesos` (no negativos) en proporción a cada peso, por el método del mayor resto: cada parte es el piso de su cuota
 * exacta y los centavos que sobran van de a uno a quien tiene el mayor resto (empate: el primero en el orden dado, para que el mismo pedido dé siempre el mismo archivo).
 * La suma de las partes es exactamente `total`. `null` si no hay a quién repartirle (sin pesos o todos en cero) y el total no es cero.
 */
export function repartirConMayorResto(total: bigint, pesos: readonly bigint[]): bigint[] | null {
  if (total < 0n || pesos.some((p) => p < 0n)) return null;
  const suma = pesos.reduce((a, p) => a + p, 0n);
  if (suma === 0n) return total === 0n ? pesos.map(() => 0n) : null;
  const partes = pesos.map((p) => (total * p) / suma);
  const restos = pesos.map((p) => (total * p) % suma);
  // Los centavos que sobran (menos que la cantidad de partes) van de a uno a quien tiene el mayor resto; con restos iguales, al primero en el orden dado.
  const elegidos = new Set<number>();
  for (let faltan = total - partes.reduce((a, p) => a + p, 0n); faltan > 0n; faltan -= 1n) {
    let mejor = -1;
    for (const [i, resto] of restos.entries()) {
      if (elegidos.has(i)) continue;
      if (mejor === -1 || resto > (restos[mejor] as bigint)) mejor = i;
    }
    elegidos.add(mejor);
    partes[mejor] = (partes[mejor] as bigint) + 1n;
  }
  return partes;
}

const FACTOR_DEL_KILO = UNIDADES.KILOGRAMO.factor;

/**
 * El costo por kilo derivado: `importe ÷ kilos`, en pesos por kilo con 6 decimales (el mismo redondeo del sistema: mitad hacia arriba). `importeEnCentavos` es el
 * importe vigente de la línea; `cantidad` está en diezmilésimas de `unidad` (el peso real, en la unidad de compra, o lo que entra al stock, en la unidad base).
 * `null` si la unidad no es de masa, la cantidad no es mayor que cero o no hay importe: nunca cero, nunca un número inventado.
 */
export function costoPorKiloDerivado(
  importeEnCentavos: bigint | null,
  cantidad: bigint,
  unidad: CodigoDeUnidad,
): string | null {
  if (importeEnCentavos === null || cantidad <= 0n || UNIDADES[unidad].dimension !== "MASA")
    return null;
  // kilos = cantidad / 10^4 * factor / 1000;  costo = (centavos / 100) / kilos, en millonésimos de peso.
  const numerador =
    importeEnCentavos * UNO_DE_CANTIDAD * FACTOR_DEL_KILO * 10n ** BigInt(ESCALA_DEL_PRECIO);
  const denominador = 100n * cantidad * UNIDADES[unidad].factor;
  return textoDePrecio((numerador * 2n + denominador) / (2n * denominador));
}
