import { GROSOR, mm, type Pincel } from "./pincel-del-pdf";
import type { ColumnaDelPdf, HojaParaElPdf, RenglonDelPdf } from "./tipos-del-pdf";

/**
 * La tabla de renglones: las mismas columnas y anchos que la hoja en pantalla (`HojaA4.module.css`: cantidad 18 mm, precio 30 mm, IVA 22 mm,
 * importe 30 mm, la descripción toma el resto). Cada fila mide con el ancho de su columna y la más alta manda. Un renglón nunca se parte:
 * el reparto en hojas es del paginador.
 */

const ANCHOS_FIJOS_MM = { cantidad: 18, precio: 30, iva: 22, importe: 30 } as const;
const RELLENO_HORIZONTAL = mm(1);
const RELLENO_VERTICAL = mm(1.2);
const FONDO_DE_TRANSPORTE = "#eeeeee";
const TAM = 9;

export function anchosDeLasColumnas(columnas: readonly ColumnaDelPdf[], ancho: number): number[] {
  const fijos = columnas.map((c) => (c.clave === "descripcion" ? 0 : mm(ANCHOS_FIJOS_MM[c.clave])));
  const resto = ancho - fijos.reduce((suma, a) => suma + a, 0);
  return columnas.map((c, i) => (c.clave === "descripcion" ? resto : (fijos[i] ?? 0)));
}

function valorDe(renglon: RenglonDelPdf, clave: ColumnaDelPdf["clave"]): string {
  switch (clave) {
    case "descripcion":
      return renglon.descripcion;
    case "cantidad":
      return renglon.cantidad;
    case "precio":
      return renglon.precio;
    case "iva":
      return renglon.iva ?? "";
    case "importe":
      return renglon.importe;
  }
}

/** Una fila de celdas (una por columna). Devuelve el alto, borde inferior incluido. */
function fila(
  p: Pincel,
  columnas: readonly ColumnaDelPdf[],
  celdas: readonly string[],
  anchos: readonly number[],
  x: number,
  y: number,
  negrita: boolean,
): number {
  let desplazamiento = 0;
  let alto = 0;
  columnas.forEach((columna, i) => {
    const ancho = anchos[i] ?? 0;
    const h = p.texto(
      celdas[i] ?? "",
      x + desplazamiento + RELLENO_HORIZONTAL,
      y + RELLENO_VERTICAL,
      ancho - 2 * RELLENO_HORIZONTAL,
      { tam: TAM, negrita },
      columna.numerica ? "right" : "left",
    );
    alto = Math.max(alto, h);
    desplazamiento += ancho;
  });
  const total = alto + 2 * RELLENO_VERTICAL;
  const ancho = anchos.reduce((suma, a) => suma + a, 0);
  p.linea(x, y + total, x + ancho, y + total, GROSOR);
  return total + GROSOR;
}

/** El encabezado de la tabla (los títulos de columna, en negrita). */
export function encabezadoDeLaTabla(
  p: Pincel,
  hoja: HojaParaElPdf,
  anchos: readonly number[],
  x: number,
  y: number,
): number {
  return fila(
    p,
    hoja.columnas,
    hoja.columnas.map((c) => c.titulo),
    anchos,
    x,
    y,
    true,
  );
}

/** Un renglón. */
export function renglonDeLaTabla(
  p: Pincel,
  hoja: HojaParaElPdf,
  renglon: RenglonDelPdf,
  anchos: readonly number[],
  x: number,
  y: number,
): number {
  return fila(
    p,
    hoja.columnas,
    hoja.columnas.map((c) => valorDe(renglon, c.clave)),
    anchos,
    x,
    y,
    false,
  );
}

/** «Transporte» con el parcial de la hoja anterior: el rótulo ocupa todas las columnas menos la última, el importe va en la última. */
export function filaDeTransporte(
  p: Pincel,
  hoja: HojaParaElPdf,
  importe: string,
  anchos: readonly number[],
  x: number,
  y: number,
): number {
  const ancho = anchos.reduce((suma, a) => suma + a, 0);
  const ultima = anchos[anchos.length - 1] ?? 0;
  const anchoDelRotulo = ancho - ultima;
  // El fondo va primero: el texto se dibuja encima.
  const hRotulo = p.alto(hoja.rotuloDeTransporte, anchoDelRotulo - 2 * RELLENO_HORIZONTAL, {
    tam: TAM,
    negrita: true,
  });
  const hImporte = p.alto(importe, ultima - 2 * RELLENO_HORIZONTAL, { tam: TAM, negrita: true });
  const total = Math.max(hRotulo, hImporte) + 2 * RELLENO_VERTICAL;
  p.relleno(x, y, ancho, total, FONDO_DE_TRANSPORTE);
  p.texto(
    hoja.rotuloDeTransporte,
    x + RELLENO_HORIZONTAL,
    y + RELLENO_VERTICAL,
    anchoDelRotulo - 2 * RELLENO_HORIZONTAL,
    { tam: TAM, negrita: true },
  );
  p.texto(
    importe,
    x + anchoDelRotulo + RELLENO_HORIZONTAL,
    y + RELLENO_VERTICAL,
    ultima - 2 * RELLENO_HORIZONTAL,
    { tam: TAM, negrita: true },
    "right",
  );
  p.linea(x, y + total, x + ancho, y + total, GROSOR);
  return total + GROSOR;
}
