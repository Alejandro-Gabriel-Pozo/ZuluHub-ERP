import { ErrorDeValor } from "../cantidad/errores";
import { crearImporte, mcm, type Importe, type MontoExacto } from "./interno";
import { exigirMismaMoneda } from "./moneda";

/**
 * Reparte `total` entre los pesos con el método de los restos mayores: cada parte es el piso o el
 * techo (en centavos) de su parte exacta, las partes suman exactamente `total` y, ante un empate de
 * restos, gana el que está primero en la lista (ADR-006).
 *
 * Supuestos de v1: el total no es negativo; con todos los pesos en cero y un total distinto de cero
 * es `PESOS_INVALIDOS`; con total cero devuelve ceros.
 */
export function prorratear(total: Importe, pesos: readonly MontoExacto[]): Importe[] {
  if (total.unidades < 0n) {
    throw new ErrorDeValor("FUERA_DE_RANGO", "prorrateo: el total no puede ser negativo");
  }
  for (const peso of pesos) {
    exigirMismaMoneda(total.moneda, peso.moneda);
    if (peso.numerador < 0n) throw new ErrorDeValor("PESOS_INVALIDOS", "prorrateo: peso negativo");
  }

  const denominadorComun = pesos.reduce((acumulado, p) => mcm(acumulado, p.denominador), 1n);
  const enteros = pesos.map((p) => p.numerador * (denominadorComun / p.denominador));
  const suma = enteros.reduce((acumulado, p) => acumulado + p, 0n);

  if (suma === 0n) {
    if (total.unidades !== 0n) {
      throw new ErrorDeValor("PESOS_INVALIDOS", "prorrateo: los pesos no suman nada");
    }
    return pesos.map(() => crearImporte(total.moneda, 0n));
  }

  const partes = enteros.map((peso, posicion) => ({
    posicion,
    piso: (total.unidades * peso) / suma,
    resto: (total.unidades * peso) % suma,
  }));
  const extra = new Set<number>();
  for (
    let faltan = total.unidades - partes.reduce((acumulado, p) => acumulado + p.piso, 0n);
    faltan > 0n;
    faltan -= 1n
  ) {
    extra.add(indiceDelMayorResto(partes, extra));
  }

  return partes.map((parte) =>
    crearImporte(total.moneda, parte.piso + (extra.has(parte.posicion) ? 1n : 0n)),
  );
}

/** El mayor resto que aún no recibió un centavo; ante un empate gana el que está primero. */
function indiceDelMayorResto(
  partes: readonly { posicion: number; resto: bigint }[],
  elegidos: ReadonlySet<number>,
): number {
  const candidatas = partes.filter((parte) => !elegidos.has(parte.posicion));
  return candidatas.reduce((mejor, parte) => (parte.resto > mejor.resto ? parte : mejor)).posicion;
}
