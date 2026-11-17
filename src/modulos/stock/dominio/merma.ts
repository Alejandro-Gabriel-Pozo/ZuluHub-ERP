import type { Cantidad } from "../../../primitivas/cantidad/cantidad";
import { cantidadATexto } from "../../../primitivas/cantidad/cantidad";
import { porcentajeDesdeTexto, type Porcentaje } from "../../../primitivas/cantidad/porcentaje";
import { dividirRedondeando } from "../../../primitivas/cantidad/redondeo-entero";
import { POLITICA_VIGENTE } from "../../../primitivas/dinero/redondeo";
import { cantidadDeUnidades } from "./movimiento";

/**
 * La merma de un componente de receta (E6 §3.3; el dueño, 13/11/2026: «se carga el BRUTO; neto = bruto × (1 − merma)», 300 g bruto con 10 % de
 * merma son 270 g neto). La receta guarda el BRUTO: es lo que se descuenta del stock y lo que se costea, sin ninguna cuenta. El neto (lo que
 * llega al plato) es solo para mostrar y sale ÚNICAMENTE de `netoDeBruto`: una sola fórmula, un solo redondeo. Previene que el costo, el
 * descuento de stock y la ficha usen fórmulas distintas (el caso de la fórmula anterior, que sumaba la merma al neto).
 */
const CIEN = porcentajeDesdeTexto("100").unidades;
export const SIN_MERMA: Porcentaje = porcentajeDesdeTexto("0");

/**
 * `bruto × (100 − merma) ÷ 100`, redondeado una vez a 4 decimales. La merma tiene que ser menor que 100 %: con 100 % o más no queda nada
 * para el plato y se rechaza con un error (la base lo impide con `componente_perdida_ck`, 0 ≤ p < 100); nunca se acota en silencio.
 */
export function netoDeBruto(bruto: Cantidad, merma: Porcentaje | null): Cantidad {
  const puntos = merma === null ? 0n : merma.unidades;
  if (puntos >= CIEN) throw new RangeError("merma: tiene que ser menor que 100 %");
  return cantidadDeUnidades(
    dividirRedondeando(bruto.unidades * (CIEN - puntos), CIEN, POLITICA_VIGENTE),
  );
}

export const netoComoTexto = (bruto: Cantidad, merma: Porcentaje | null): string =>
  cantidadATexto(netoDeBruto(bruto, merma));
