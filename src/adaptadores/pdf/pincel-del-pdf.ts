import type PDFDocument from "pdfkit";
import { exigirTextoSoportado } from "./caracteres-del-pdf";

/**
 * El pincel del PDF: lo ÚNICO que escribe texto o traza en el documento. Cada bloque de la hoja se escribe UNA sola vez y se corre en dos
 * modos: `dibujar: false` solo mide (devuelve el alto), `dibujar: true` además traza. Medir y dibujar con el mismo código previene que el
 * alto que se reparte no sea el que se dibuja (un renglón encima del total). Todo texto pasa por `exigirTextoSoportado` antes de medirse
 * o dibujarse, así ningún carácter que la tipografía no tiene llega al documento (ver `caracteres-del-pdf.ts`).
 */

/** Un milímetro en puntos (la unidad del PDF: 72 por pulgada). */
const PT_POR_MM = 72 / 25.4;
export const mm = (milimetros: number): number => milimetros * PT_POR_MM;
/** Un punto en píxeles de CSS: el paginador de la hoja trabaja en px (96 por pulgada). */
export const PX_POR_PT = 96 / 72;

const NORMAL = "Helvetica";
const NEGRITA = "Helvetica-Bold";
/** El interlineado de la hoja en pantalla (`HojaA4.module.css`: `line-height: 1.25`). */
const INTERLINEADO = 1.25;
/** Los trazos de la hoja en pantalla: 1 px y 2 px. */
export const GROSOR = 0.75;
export const GROSOR_FUERTE = 1.5;
const TINTA = "#000000";

export type Estilo = Readonly<{ tam: number; negrita?: boolean; interlineado?: number }>;
export type Alineacion = "left" | "center" | "right";
/** Un rótulo en negrita seguido de su valor, o el valor solo (`rotulo: null`). */
export type FilaDelPdf = Readonly<{ rotulo: string | null; valor: string }>;

export type Pincel = Readonly<{
  dibujar: boolean;
  /** El alto que ocupa el texto en ese ancho, con ajuste de línea. 0 si está vacío. */
  alto: (texto: string, ancho: number, estilo: Estilo) => number;
  /** El ancho de una sola línea. */
  ancho: (texto: string, estilo: Estilo) => number;
  /** Escribe y devuelve el alto. */
  texto: (
    texto: string,
    x: number,
    y: number,
    ancho: number,
    estilo: Estilo,
    alinear?: Alineacion,
  ) => number;
  /** «Rótulo valor» con el rótulo en negrita. */
  fila: (fila: FilaDelPdf, x: number, y: number, ancho: number, tam: number) => number;
  recuadro: (x: number, y: number, ancho: number, alto: number, grosor: number) => void;
  linea: (x1: number, y1: number, x2: number, y2: number, grosor: number) => void;
  relleno: (x: number, y: number, ancho: number, alto: number, color: string) => void;
  /** Cuadraditos negros (los módulos del QR) en UN solo trazado: sin costuras entre vecinos. */
  cuadrados: (cuadrados: readonly (readonly [number, number, number, number])[]) => void;
}>;

export function crearPincel(doc: PDFDocument, dibujar: boolean): Pincel {
  const preparar = (estilo: Estilo): number => {
    doc.font(estilo.negrita === true ? NEGRITA : NORMAL).fontSize(estilo.tam);
    return estilo.tam * (estilo.interlineado ?? INTERLINEADO) - doc.currentLineHeight(true);
  };
  const alto = (texto: string, ancho: number, estilo: Estilo): number => {
    exigirTextoSoportado(texto);
    if (texto === "") return 0;
    const lineGap = preparar(estilo);
    return doc.heightOfString(texto, { width: ancho, lineGap });
  };
  const anchoDe = (texto: string, estilo: Estilo): number => {
    exigirTextoSoportado(texto);
    preparar(estilo);
    return doc.widthOfString(texto);
  };
  const texto = (
    cadena: string,
    x: number,
    y: number,
    ancho: number,
    estilo: Estilo,
    alinear: Alineacion = "left",
  ): number => {
    const h = alto(cadena, ancho, estilo);
    if (dibujar && cadena !== "") {
      const lineGap = preparar(estilo);
      doc.fillColor(TINTA).text(cadena, x, y, { width: ancho, align: alinear, lineGap });
    }
    return h;
  };
  return {
    dibujar,
    alto,
    ancho: anchoDe,
    texto,
    fila: (fila, x, y, ancho, tam) => {
      if (fila.rotulo === null) return texto(fila.valor, x, y, ancho, { tam });
      const rotulo = `${fila.rotulo} `;
      // Se mide todo en negrita (más ancho): nunca queda más corto que lo que se dibuja.
      const h = alto(`${rotulo}${fila.valor}`, ancho, { tam, negrita: true });
      if (dibujar) {
        const lineGap = preparar({ tam, negrita: true });
        doc.fillColor(TINTA).text(rotulo, x, y, { width: ancho, continued: true, lineGap });
        preparar({ tam });
        doc.text(fila.valor, { lineGap });
      }
      return h;
    },
    recuadro: (x, y, ancho, altoDelRecuadro, grosor) => {
      if (dibujar) {
        doc.lineWidth(grosor).strokeColor(TINTA).rect(x, y, ancho, altoDelRecuadro).stroke();
      }
    },
    linea: (x1, y1, x2, y2, grosor) => {
      if (dibujar) doc.lineWidth(grosor).moveTo(x1, y1).lineTo(x2, y2).stroke(TINTA);
    },
    relleno: (x, y, ancho, altoDelRelleno, color) => {
      if (dibujar) doc.rect(x, y, ancho, altoDelRelleno).fill(color);
    },
    cuadrados: (cuadrados) => {
      if (!dibujar) return;
      for (const [x, y, ancho, altoDelCuadrado] of cuadrados)
        doc.rect(x, y, ancho, altoDelCuadrado);
      doc.fill(TINTA);
    },
  };
}
