import { cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import { sumar, type Importe } from "../../../primitivas/dinero/importe";
import { multiplicarPrecioPorCantidad } from "../../../primitivas/dinero/monto-exacto";
import { prorratear } from "../../../primitivas/dinero/prorrateo";
import type { PrecioUnitario } from "../../../primitivas/dinero/precio-unitario";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

/**
 * El reparto del precio de un combo entre sus componentes, al centavo (E8 §3.2, ADR-006; el dueño confirmó el reparto proporcional al valor de lista el 12/11/2026):
 * una función PURA, sin base ni reloj. Recibe el importe de la línea en el ejemplar (ya redondeado por el ticket: la línea no se redondea sola) y, por cada unidad
 * de componente EN ORDEN `(posición, unidad)`, su precio de lista congelado (sin recargos; precio abierto = 0) y su alícuota. Devuelve la parte de cada componente
 * (la suma es EXACTAMENTE el importe; el centavo sobrante va al mayor resto y, a igual resto, al primero de la lista: lo decide `prorratear`) y las partes por
 * alícuota, que son las que van a la factura. Depende solo de `(importe, precios sellados)`: una corrección que repite la línea repite las mismas partes.
 * Previene: un combo facturado con un centavo de más o de menos, o con el precio de lista de HOY en una corrección de ayer.
 */
export type ComponenteParaRepartir = Readonly<{
  /** El precio de lista congelado con que se sella la unidad del componente (el peso del reparto). */
  precioDeLista: PrecioUnitario;
  /** La alícuota de IVA del producto del componente, tal cual la guarda la línea. */
  alicuota: string;
}>;

export type ParteDePorAlicuota = Readonly<{ alicuota: string; importe: Importe }>;

export type PartesDelConjunto = Readonly<{
  /** Una por componente, en el mismo orden que la entrada. */
  partes: readonly Importe[];
  /** Una por alícuota, en el orden en que aparece cada una por primera vez. */
  porAlicuota: readonly ParteDePorAlicuota[];
}>;

export type ErrorDeReparto = "CONJUNTO_SIN_COMPONENTES" | "CONJUNTO_SIN_PRECIOS_DE_REFERENCIA";

const UNA_VEZ = cantidadDesdeTexto("1");

export function repartirPrecioDelConjunto(
  importe: Importe,
  componentes: readonly ComponenteParaRepartir[],
): Resultado<PartesDelConjunto, ErrorDeReparto> {
  if (componentes.length === 0) return err("CONJUNTO_SIN_COMPONENTES");
  const pesos = componentes.map((c) =>
    multiplicarPrecioPorCantidad(importe.moneda, c.precioDeLista, UNA_VEZ),
  );
  // Con todos los precios de lista en cero no hay con qué repartir: se rechaza, no se inventa un reparto (un importe cero reparte ceros).
  if (importe.unidades !== 0n && pesos.every((p) => p.numerador === 0n)) {
    return err("CONJUNTO_SIN_PRECIOS_DE_REFERENCIA");
  }
  const partes = prorratear(importe, pesos);
  // `Map` conserva el orden de la primera aparición de cada alícuota.
  const sumas = new Map<string, Importe>();
  for (const [i, parte] of partes.entries()) {
    const { alicuota } = componentes[i] as ComponenteParaRepartir;
    const previa = sumas.get(alicuota);
    sumas.set(alicuota, previa === undefined ? parte : sumar(previa, parte));
  }
  const porAlicuota = [...sumas].map(([alicuota, importe]) => ({ alicuota, importe }));
  return ok({ partes, porAlicuota });
}
