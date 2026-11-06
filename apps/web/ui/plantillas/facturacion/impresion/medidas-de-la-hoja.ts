import { ALTO_A4_MM, HOLGURA_MM, MARGEN_A4_MM, mmAPx } from "./geometria";
import type { EntradaDelPaginador } from "./paginador";

/**
 * Las alturas medidas de las piezas de la hoja (en px) y cómo se vuelven la entrada del paginador. Sin DOM: la hoja de pantalla las mide con
 * el navegador (`medicion.ts`) y el PDF las mide con su propia tipografía (`src/adaptadores/pdf`), y las dos reparten con la MISMA función.
 * Previene: que el PDF y la pantalla corten la hoja con fórmulas distintas.
 *
 * OJO: lo que NO se comparte es el dibujo. Los anchos de columna (cantidad 18 mm, precio 30 mm, IVA 22 mm, importe 30 mm), el ancho de la letra
 * (24 mm), el del QR (28 mm) y los tamaños de letra de la hoja se REPITEN en `HojaA4.module.css` (pantalla) y en
 * `src/adaptadores/pdf/medidas-del-papel.ts` (PDF): el adaptador no puede importar la web. Si cambiás una medida en el CSS, cambiala también
 * allá: `src/adaptadores/pdf/medidas-del-papel.test.ts` compara las dos y falla si difieren.
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
