import type { Cantidad } from "../../../primitivas/cantidad/cantidad";
import type { Porcentaje } from "../../../primitivas/cantidad/porcentaje";
import { dividirRedondeando } from "../../../primitivas/cantidad/redondeo-entero";
import { POLITICA_VIGENTE } from "../../../primitivas/dinero/redondeo";
import { compararTexto, UNIDADES_POR_ENTERO } from "./movimiento";

/**
 * El costo de una receta (E6 §3.3, D74, D77, D91): una CONSULTA, no se guarda. `Σ costo_unitario × bruto ÷ rinde` (la receta carga el BRUTO: la merma no se vuelve a aplicar, `merma.ts`),
 * en fracciones exactas y redondeado UNA vez, a 6 decimales (la escala de `numeric(18,6)` del costo). Un componente sin costo NO vale
 * cero (D125): deja el total incompleto y se lista; los insumos operativos (packaging, limpieza) no suman al costo y van aparte (D77).
 * Puro. `costoUnitario` en unidades de 10⁻⁶ pesos por unidad base; cantidades en unidades mínimas (10⁻⁴). Previene un food cost
 * optimista por tratar «sin costo» como cero y una receta que suma el packaging.
 */
export type ComponenteParaCosto = Readonly<{
  clave: string;
  /** Un insumo operativo: se muestra aparte y no entra al costo. */
  noEntraAlCosto: boolean;
  /** La cantidad BRUTA cargada en la receta, en la unidad de costo. */
  bruto: Cantidad;
  /** Solo para comparar versiones: no entra a la cuenta del costo. */
  merma: Porcentaje | null;
  /** 10⁻⁶ pesos por unidad base; `null` = sin costo. */
  costoUnitario: bigint | null;
}>;

export type LineaDeCosto = Readonly<{
  clave: string;
  noEntraAlCosto: boolean;
  /** Costo de la línea en 10⁻⁶ pesos para toda la receta, redondeado una vez; `null` si no hay costo. */
  costo: bigint | null;
}>;

export type CostoDeReceta = Readonly<{
  lineas: readonly LineaDeCosto[];
  /** Cuánto cuesta lo que rinde la receta entera, en 10⁻⁶ pesos (un redondeo). */
  costoTotal: bigint;
  /** Cuánto cuesta cada unidad que rinde, en 10⁻⁶ pesos (un redondeo, del total exacto). */
  costoPorUnidad: bigint;
  /** Hay componentes que cuentan y no tienen costo: el total y el costo por unidad están incompletos. */
  incompleto: boolean;
  sinCosto: readonly string[];
}>;

const ESCALA = UNIDADES_POR_ENTERO;

export function costearReceta(
  rinde: Cantidad,
  componentes: readonly ComponenteParaCosto[],
): CostoDeReceta {
  if (rinde.unidades <= 0n) throw new RangeError("costo de receta: el rinde es mayor que cero");
  let exacto = 0n; // Σ costoUnitario × bruto, sobre ESCALA (10⁻⁶ pesos)
  let denominador = 1n;
  const lineas: LineaDeCosto[] = [];
  const sinCosto: string[] = [];
  for (const c of componentes) {
    if (c.costoUnitario === null) {
      lineas.push({ clave: c.clave, noEntraAlCosto: c.noEntraAlCosto, costo: null });
      if (!c.noEntraAlCosto) sinCosto.push(c.clave);
      continue;
    }
    const numerador = c.costoUnitario * c.bruto.unidades;
    const den = ESCALA;
    lineas.push({
      clave: c.clave,
      noEntraAlCosto: c.noEntraAlCosto,
      costo: dividirRedondeando(numerador, den, POLITICA_VIGENTE),
    });
    if (c.noEntraAlCosto) continue;
    exacto = exacto * den + numerador * denominador;
    denominador = denominador * den;
  }
  return {
    lineas,
    costoTotal: dividirRedondeando(exacto, denominador, POLITICA_VIGENTE),
    costoPorUnidad: dividirRedondeando(
      exacto * ESCALA,
      denominador * rinde.unidades,
      POLITICA_VIGENTE,
    ),
    incompleto: sinCosto.length > 0,
    sinCosto,
  };
}

/** Diferencia entre dos versiones de una receta (D99): qué componentes se agregan, quitan o cambian, con los precios de hoy. */
export type CambioDeVersion = Readonly<{
  clave: string;
  tipo: "AGREGADO" | "QUITADO" | "CAMBIADO";
}>;

export function compararVersiones(
  desde: readonly Pick<ComponenteParaCosto, "clave" | "bruto" | "merma">[],
  hasta: readonly Pick<ComponenteParaCosto, "clave" | "bruto" | "merma">[],
): readonly CambioDeVersion[] {
  const antes = new Map(desde.map((c) => [c.clave, c]));
  const despues = new Map(hasta.map((c) => [c.clave, c]));
  const cambios: CambioDeVersion[] = [];
  for (const c of hasta) {
    const previo = antes.get(c.clave);
    if (previo === undefined) cambios.push({ clave: c.clave, tipo: "AGREGADO" });
    else if (
      previo.bruto.unidades !== c.bruto.unidades ||
      (previo.merma?.unidades ?? 0n) !== (c.merma?.unidades ?? 0n)
    ) {
      cambios.push({ clave: c.clave, tipo: "CAMBIADO" });
    }
  }
  for (const c of desde) {
    if (!despues.has(c.clave)) cambios.push({ clave: c.clave, tipo: "QUITADO" });
  }
  return cambios.sort((a, b) => compararTexto(a.clave, b.clave));
}
