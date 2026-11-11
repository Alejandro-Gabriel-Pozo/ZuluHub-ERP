import type { Cantidad } from "../../../primitivas/cantidad/cantidad";
import { cantidadATexto } from "../../../primitivas/cantidad/cantidad";
import { MAXIMO_DE_UNIDADES } from "../../../primitivas/cantidad/decimal-fijo";
import { porcentajeDesdeTexto, type Porcentaje } from "../../../primitivas/cantidad/porcentaje";
import { dividirRedondeando } from "../../../primitivas/cantidad/redondeo-entero";
import { POLITICA_VIGENTE } from "../../../primitivas/dinero/redondeo";
import { cantidadDeUnidades } from "./movimiento";

/**
 * La merma de un componente de receta (E6 §3.3, decisión P-1 del 10/11/2026): la merma se SUMA al neto, como el prototipo aprobado
 * (`receta.html`): bruto = neto × (1 + merma ÷ 100); 20 % sobre 1 kg neto son 1,2 kg brutos. Es la ÚNICA función que decide la fórmula: lo que
 * se descuenta del stock, lo que se costea y lo que muestra la ficha de cocina salen de acá. Cambiar la fórmula (P-1 corregida a
 * «porcentaje del bruto»: neto × 100 ÷ (100 − merma)) es tocar solo `fraccionDeBruto`. Puro y exacto: devuelve una fracción de
 * unidades mínimas, para que quien suma varios renglones redondee UNA sola vez. Previene que el costo y el descuento de stock usen
 * fórmulas distintas.
 */
export type FraccionDeUnidades = Readonly<{ numerador: bigint; denominador: bigint }>;

const CIEN = porcentajeDesdeTexto("100").unidades;
export const SIN_MERMA: Porcentaje = porcentajeDesdeTexto("0");

/** Bruto exacto como fracción de unidades mínimas: `neto × (100 + merma) ÷ 100` (el `+` es la decisión P-1). */
export function fraccionDeBruto(
  netoUnidades: bigint,
  merma: Porcentaje | null,
): FraccionDeUnidades {
  const puntos = merma === null ? 0n : merma.unidades;
  return { numerador: netoUnidades * (CIEN + puntos), denominador: CIEN };
}

/** El bruto a cantidad de 4 decimales (un solo redondeo): lo que muestra la ficha de cocina. `null` si se sale del rango de una cantidad. */
export function brutoDeNeto(neto: Cantidad, merma: Porcentaje | null): Cantidad | null {
  const { numerador, denominador } = fraccionDeBruto(neto.unidades, merma);
  const unidades = dividirRedondeando(numerador, denominador, POLITICA_VIGENTE);
  return unidades > MAXIMO_DE_UNIDADES ? null : cantidadDeUnidades(unidades);
}

export const brutoComoTexto = (neto: Cantidad, merma: Porcentaje | null): string | null => {
  const bruto = brutoDeNeto(neto, merma);
  return bruto === null ? null : cantidadATexto(bruto);
};
