import type { Medidas } from "./medidas-de-la-hoja";

/**
 * Lo que se mide en la tabla de medición oculta (alto REAL de cada pieza, en px, con `getBoundingClientRect`); cómo se vuelve la entrada
 * del paginador está en `medidas-de-la-hoja.ts` (sin DOM). Medir con el DOM (y no con una fórmula de caracteres por línea) previene que otra tipografía, un renglón de
 * 200 caracteres o un cambio de ancho corran el corte de hoja. La tabla de medición NO puede estar dentro de un `transform`:
 * `getBoundingClientRect` devuelve el alto ya escalado. Chequeo: `hoja-a4.test.tsx` (otra tipografía, vista previa de 360 px).
 */

const alto = (e: Element | null): number | null =>
  e === null ? null : e.getBoundingClientRect().height;

/**
 * Lee las medidas de la tabla de medición; `null` si todavía no tiene todas sus piezas o si no tiene layout (`display: none`, p. ej.
 * en `@media print`): ahí todos los altos dan 0 y el paginador repartiría todo en UNA hoja. Previene: hojas colapsadas al pasar a imprimir.
 */
export function leerLasMedidas(raiz: Element): Medidas | null {
  if (raiz.getClientRects().length === 0) return null;
  const encabezadoDeLaHoja = alto(raiz.querySelector('[data-medida="encabezado"]'));
  const encabezadoDeLaTabla = alto(raiz.querySelector("thead"));
  const filaDeTransporte = alto(raiz.querySelector("tr[data-transporte]"));
  const pie = alto(raiz.querySelector('[data-medida="pie"]'));
  if (
    encabezadoDeLaHoja === null ||
    encabezadoDeLaTabla === null ||
    filaDeTransporte === null ||
    pie === null
  ) {
    return null;
  }
  return {
    encabezadoDeLaHoja,
    encabezadoDeLaTabla,
    filaDeTransporte,
    renglones: [...raiz.querySelectorAll("tbody tr[data-fila]")].map((fila) => alto(fila) ?? 0),
    pie,
  };
}
