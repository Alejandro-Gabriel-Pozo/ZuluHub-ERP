import { ErrorDeValor } from "../cantidad/errores";
import {
  crearImporte,
  crearPrecioUnitario,
  mcm,
  type Importe,
  type MontoExacto,
  type PrecioUnitario,
} from "./interno";
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
    exigirPesoNoNegativo(peso, "prorrateo");
  }

  const partes = repartirPorRestosMayores(total.unidades, pesos, "prorrateo");
  return partes.map((unidades) => crearImporte(total.moneda, unidades));
}

/**
 * Reparte un precio unitario (micro-pesos, escala 6) entre los pesos con el mismo método de los
 * restos mayores que `prorratear`: cada parte es el piso o el techo (en micro-pesos) de su parte
 * exacta, las partes suman exactamente `total` y, ante un empate de restos, gana el que está
 * primero en la lista. Sirve para repartir el precio de un combo entre sus componentes sin perder
 * ni inventar un micro-peso.
 *
 * Supuestos de v1: los pesos están todos en la misma moneda (`MONEDA_DISTINTA` si no); con todos
 * los pesos en cero (o sin pesos) y un total distinto de cero es `PESOS_INVALIDOS`; con total cero
 * devuelve ceros; un peso en cero recibe cero si hay otros pesos.
 */
export function repartirPrecioUnitario(
  total: PrecioUnitario,
  pesos: readonly MontoExacto[],
): PrecioUnitario[] {
  if (new Set(pesos.map((p) => p.moneda)).size > 1) {
    throw new ErrorDeValor("MONEDA_DISTINTA", "reparto de precio: pesos en monedas distintas");
  }
  for (const peso of pesos) exigirPesoNoNegativo(peso, "reparto de precio");
  return repartirPorRestosMayores(total.unidades, pesos, "reparto de precio").map(
    crearPrecioUnitario,
  );
}

function exigirPesoNoNegativo(peso: MontoExacto, contexto: string): void {
  if (peso.numerador < 0n) throw new ErrorDeValor("PESOS_INVALIDOS", `${contexto}: peso negativo`);
}

/**
 * Núcleo común de `prorratear` y `repartirPrecioUnitario`: reparte `total` (unidades enteras, no
 * negativo) en partes enteras proporcionales a los pesos, por restos mayores. Los pesos ya vienen
 * validados (no negativos, de una sola moneda); `contexto` encabeza el mensaje de `PESOS_INVALIDOS`.
 */
function repartirPorRestosMayores(
  total: bigint,
  pesos: readonly MontoExacto[],
  contexto: string,
): bigint[] {
  const denominadorComun = pesos.reduce((acumulado, p) => mcm(acumulado, p.denominador), 1n);
  const enteros = pesos.map((p) => p.numerador * (denominadorComun / p.denominador));
  const suma = enteros.reduce((acumulado, p) => acumulado + p, 0n);

  if (suma === 0n) {
    if (total !== 0n) {
      throw new ErrorDeValor("PESOS_INVALIDOS", `${contexto}: los pesos no suman nada`);
    }
    return pesos.map(() => 0n);
  }

  const partes = enteros.map((peso, posicion) => ({
    posicion,
    piso: (total * peso) / suma,
    resto: (total * peso) % suma,
  }));
  const extra = new Set<number>();
  for (
    let faltan = total - partes.reduce((acumulado, p) => acumulado + p.piso, 0n);
    faltan > 0n;
    faltan -= 1n
  ) {
    extra.add(indiceDelMayorResto(partes, extra));
  }

  return partes.map((parte) => parte.piso + (extra.has(parte.posicion) ? 1n : 0n));
}

/** El mayor resto que aún no recibió un centavo; ante un empate gana el que está primero. */
function indiceDelMayorResto(
  partes: readonly { posicion: number; resto: bigint }[],
  elegidos: ReadonlySet<number>,
): number {
  const candidatas = partes.filter((parte) => !elegidos.has(parte.posicion));
  return candidatas.reduce((mejor, parte) => (parte.resto > mejor.resto ? parte : mejor)).posicion;
}
