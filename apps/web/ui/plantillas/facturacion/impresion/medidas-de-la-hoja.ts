import { ALTO_A4_MM, HOLGURA_MM, MARGEN_A4_MM, mmAPx } from "./geometria";
import type { EntradaDelPaginador } from "./paginador";

/**
 * Las alturas medidas de las piezas de la hoja (en px) y cómo se vuelven la entrada del paginador. Sin DOM: la hoja de pantalla las mide con
 * el navegador (`medicion.ts`) y el PDF las mide con su propia tipografía (`src/adaptadores/pdf`), y las dos reparten con la MISMA función.
 * Previene: que el PDF y la pantalla corten la hoja con fórmulas distintas.
 */

export type Medidas = Readonly<{
  encabezadoDeLaHoja: number;
  encabezadoDeLaTabla: number;
  filaDeTransporte: number;
  renglones: readonly number[];
  pie: number;
}>;

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
