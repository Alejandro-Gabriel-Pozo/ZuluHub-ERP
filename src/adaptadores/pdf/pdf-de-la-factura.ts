import PDFDocument from "pdfkit";
import { qrDeFacturaComoMatriz } from "../qr/qr-de-factura";
import { encabezado, pie, type DatosDelPie, type QrParaElPdf } from "./bloques-del-pdf";
import { exigirTextoSoportado } from "./caracteres-del-pdf";
import { crearPincel, mm, PX_POR_PT, type Pincel } from "./pincel-del-pdf";
import {
  anchosDeLasColumnas,
  encabezadoDeLaTabla,
  filaDeTransporte,
  renglonDeLaTabla,
} from "./tabla-del-pdf";
import type { HojaParaElPdf, MedidasDeLaHoja, ReglasDeLaHoja } from "./tipos-del-pdf";

export type {
  ColumnaDelPdf,
  HojaParaElPdf,
  HojaRepartida,
  MedidasDeLaHoja,
  ReglasDeLaHoja,
  RenglonDelPdf,
  TotalDelPdf,
} from "./tipos-del-pdf";
export { CaracterNoSoportadoEnElPdf } from "./caracteres-del-pdf";

/**
 * El PDF de un comprobante A4 (decisión del dueño, 2026-11-05: una librería de PDF en el servidor, con su propio diseño y sin capturar la
 * página). Recibe la hoja YA ARMADA por la misma función que arma la pantalla, así que los textos, los importes y las fechas son los
 * de la pantalla; acá solo se reparte en hojas con el MISMO paginador y se dibuja. Devuelve los bytes del PDF.
 *
 * - Tipografía: Helvetica del propio PDF (no se embebe). Un carácter que no tiene corta la generación (ver `caracteres-del-pdf.ts`).
 * - QR: vector, de la misma matriz que el de la pantalla (`qrDeFacturaComoMatriz`); módulos negros sobre papel con su zona silenciosa.
 * - Un renglón que no entra ni solo en una hoja vacía corta la generación: no se dibuja encima del pie (falla cerrado).
 * - Sin hora del reloj adentro: la fecha de creación entra como dato, así el mismo comprobante da los mismos bytes.
 *
 * Previene: un PDF que difiera de la pantalla en un dato, un importe o un corte de hoja. Chequeo: `pdf-de-la-factura.test.ts` (contenido
 * del PDF contra la hoja, QR decodificado contra el de la pantalla, hojas, mutaciones).
 */

export type EntradaDelPdf = Readonly<{
  hoja: HojaParaElPdf;
  /**
   * El importe de cada renglón TAL COMO LO TRAE EL MODELO (texto decimal sin formato, en el orden de `hoja.renglones`): el paginador suma
   * los parciales de «Transporte» y «A transportar» en centavos enteros y no puede leer el texto ya formateado de la hoja.
   */
  importes: readonly string[];
  /** La URL del QR de ARCA (`modelo.qr.url`): la misma que dibuja la pantalla. */
  qrUrl: string;
  reglas: ReglasDeLaHoja;
  creadoEn: Date;
}>;

/** El QR de la pantalla mide 28 mm de lado con su zona silenciosa (4 módulos por lado) incluida. */
const LADO_DEL_QR = mm(28);
const MODULOS_DE_MARGEN = 4;

function qrParaElPdf(url: string): QrParaElPdf {
  const matriz = qrDeFacturaComoMatriz(url);
  const modulo = LADO_DEL_QR / (matriz.length + 2 * MODULOS_DE_MARGEN);
  return {
    lado: LADO_DEL_QR,
    cuadrados: (x, y) => {
      const tramos: [number, number, number, number][] = [];
      matriz.forEach((fila, f) => {
        for (const tramo of fila
          .map((oscuro) => (oscuro ? "1" : "0"))
          .join("")
          .matchAll(/1+/g)) {
          tramos.push([
            x + (tramo.index + MODULOS_DE_MARGEN) * modulo,
            y + (f + MODULOS_DE_MARGEN) * modulo,
            tramo[0].length * modulo,
            modulo,
          ]);
        }
      });
      return tramos;
    },
  };
}

/** El pie final medido (el que más lugar pide): el mismo en todas las hojas, como en la pantalla. */
const piePara = (
  hoja: HojaParaElPdf,
  reglas: ReglasDeLaHoja,
  qr: QrParaElPdf,
  aTransportar: string | null,
  k: number,
  n: number,
): DatosDelPie => ({ aTransportar, numeroDeHoja: reglas.textoDeLaHoja(k, n), qr });

function medir(
  doc: PDFDocument,
  hoja: HojaParaElPdf,
  reglas: ReglasDeLaHoja,
  qr: QrParaElPdf,
  anchos: readonly number[],
  ancho: number,
): MedidasDeLaHoja {
  const p = crearPincel(doc, false);
  const aPx = (puntos: number): number => puntos * PX_POR_PT;
  return {
    encabezadoDeLaHoja: aPx(encabezado(p, hoja, 0, 0, ancho)),
    encabezadoDeLaTabla: aPx(encabezadoDeLaTabla(p, hoja, anchos, 0, 0)),
    filaDeTransporte: aPx(filaDeTransporte(p, hoja, reglas.formatearImporte("0"), anchos, 0, 0)),
    renglones: hoja.renglones.map((r) => aPx(renglonDeLaTabla(p, hoja, r, anchos, 0, 0))),
    pie: aPx(pie(p, hoja, piePara(hoja, reglas, qr, null, 1, 1), 0, 0, ancho, null)),
  };
}

function dibujarHoja(
  p: Pincel,
  hoja: HojaParaElPdf,
  reglas: ReglasDeLaHoja,
  qr: QrParaElPdf,
  anchos: readonly number[],
  geometria: Readonly<{ margen: number; ancho: number; altoDeLaHoja: number; altoDelPie: number }>,
  reparto: Readonly<{
    desde: number;
    hasta: number;
    transporte: string | null;
    aTransportar: string | null;
    k: number;
    n: number;
  }>,
): void {
  const { margen, ancho, altoDeLaHoja, altoDelPie } = geometria;
  let y = margen + encabezado(p, hoja, margen, margen, ancho);
  y += encabezadoDeLaTabla(p, hoja, anchos, margen, y);
  if (reparto.transporte !== null) {
    y += filaDeTransporte(p, hoja, reglas.formatearImporte(reparto.transporte), anchos, margen, y);
  }
  for (const renglon of hoja.renglones.slice(reparto.desde, reparto.hasta)) {
    y += renglonDeLaTabla(p, hoja, renglon, anchos, margen, y);
  }
  const datos = piePara(
    hoja,
    reglas,
    qr,
    reparto.aTransportar === null ? null : reglas.formatearImporte(reparto.aTransportar),
    reparto.k,
    reparto.n,
  );
  pie(p, hoja, datos, margen, altoDeLaHoja - margen - altoDelPie, ancho, altoDelPie);
}

/** Junta los trozos que va largando pdfkit en un solo arreglo de bytes. */
function juntar(trozos: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(trozos.reduce((suma, t) => suma + t.length, 0));
  let desde = 0;
  for (const trozo of trozos) {
    bytes.set(trozo, desde);
    desde += trozo.length;
  }
  return bytes;
}

export async function generarPdfDeLaFactura(
  entrada: EntradaDelPdf,
): Promise<Uint8Array<ArrayBuffer>> {
  const { hoja, reglas } = entrada;
  const titulo = `${hoja.rotulo} ${hoja.letra} ${hoja.numero}`;
  exigirTextoSoportado(titulo);
  const ancho = mm(reglas.papel.anchoMm);
  const alto = mm(reglas.papel.altoMm);
  const margen = mm(reglas.papel.margenMm);
  const doc = new PDFDocument({
    size: [ancho, alto],
    margin: 0,
    autoFirstPage: false,
    info: { Title: titulo, CreationDate: entrada.creadoEn, ModDate: entrada.creadoEn },
  });
  const trozos: Uint8Array[] = [];
  doc.on("data", (trozo) => trozos.push(trozo));
  const terminado = new Promise<void>((resolver, rechazar) => {
    doc.on("end", resolver);
    doc.on("error", rechazar);
  });

  doc.addPage();
  const util = ancho - 2 * margen;
  const anchos = anchosDeLasColumnas(hoja.columnas, util);
  const qr = qrParaElPdf(entrada.qrUrl);
  const medidas = medir(doc, hoja, reglas, qr, anchos, util);
  if (entrada.importes.length !== hoja.renglones.length) {
    throw new RangeError("tiene que haber un importe por cada renglón");
  }
  const reparto = reglas.repartir(medidas, entrada.importes);
  if (reparto.excedeLaHoja) throw new RangeError("un renglón no entra en una hoja del PDF");

  const geometria = {
    margen,
    ancho: util,
    altoDeLaHoja: alto,
    // El pie se fija en el alto medido, redondeado para arriba en píxeles (igual que la pantalla): nunca más corto que su contenido.
    altoDelPie: Math.ceil(medidas.pie) / PX_POR_PT,
  };
  const dibujo = crearPincel(doc, true);
  reparto.hojas.forEach((hojaRepartida, i) => {
    if (i > 0) doc.addPage();
    dibujarHoja(dibujo, hoja, reglas, qr, anchos, geometria, {
      ...hojaRepartida,
      k: i + 1,
      n: reparto.hojas.length,
    });
  });
  doc.end();
  await terminado;
  return juntar(trozos);
}
