import { ALTO_A4_MM, HOLGURA_MM, MARGEN_A4_MM, mmAPx } from "./geometria";
import type { EntradaDelPaginador } from "./paginador";

/**
 * Lo que se mide en la tabla de medición oculta (alto REAL de cada pieza, en px, con `getBoundingClientRect`) y cómo se vuelve la
 * entrada del paginador. Medir con el DOM (y no con una fórmula de caracteres por línea) previene que otra tipografía, un renglón de
 * 200 caracteres o un cambio de ancho corran el corte de hoja. La tabla de medición NO puede estar dentro de un `transform`:
 * `getBoundingClientRect` devuelve el alto ya escalado. Chequeo: `hoja-a4.test.tsx` (otra tipografía, vista previa de 360 px).
 */

export type Medidas = Readonly<{
  encabezadoDeLaHoja: number;
  encabezadoDeLaTabla: number;
  filaDeTransporte: number;
  renglones: readonly number[];
  pie: number;
}>;

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

export function medidasIguales(a: Medidas | null, b: Medidas): boolean {
  return (
    a !== null &&
    a.encabezadoDeLaHoja === b.encabezadoDeLaHoja &&
    a.encabezadoDeLaTabla === b.encabezadoDeLaTabla &&
    a.filaDeTransporte === b.filaDeTransporte &&
    a.pie === b.pie &&
    a.renglones.length === b.renglones.length &&
    a.renglones.every((valor, i) => valor === b.renglones[i])
  );
}

/** El alto del pie que se fija en TODAS las hojas: el medido, redondeado para arriba (nunca más corto que su contenido). */
export const altoFijoDelPie = (medidas: Medidas): number => Math.ceil(medidas.pie);

/**
 * La entrada del paginador: el alto útil es el de la hoja menos sus dos márgenes, el encabezado de la hoja (se repite en cada una) y la
 * holgura; el pie lo descuenta el paginador.
 */
export function entradaDelPaginador(
  medidas: Medidas,
  importes: readonly string[],
): EntradaDelPaginador {
  return {
    altosDeLosRenglones: medidas.renglones,
    importes,
    altoUtilDeLaHoja:
      mmAPx(ALTO_A4_MM) - 2 * mmAPx(MARGEN_A4_MM) - medidas.encabezadoDeLaHoja - mmAPx(HOLGURA_MM),
    altoDelPie: altoFijoDelPie(medidas),
    altoDelEncabezadoDeLaTabla: medidas.encabezadoDeLaTabla,
    altoDeLaFilaDeTransporte: medidas.filaDeTransporte,
  };
}
