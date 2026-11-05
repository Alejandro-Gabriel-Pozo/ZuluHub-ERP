import { GROSOR, GROSOR_FUERTE, mm, type Pincel } from "./pincel-del-pdf";
import type { HojaParaElPdf } from "./tipos-del-pdf";

/**
 * El encabezado y el pie de la hoja, con las mismas medidas que la hoja en pantalla (`HojaA4.module.css`). Cada bloque se escribe una sola
 * vez y sirve para medir (`p.dibujar === false`) y para dibujar. Devuelven el alto que ocupan.
 */

const TAM = 9;
const ANCHO_DE_LA_LETRA = mm(24);
const RELLENO = mm(2);

/** Los cuadraditos del QR ya ubicados: `[x, y, ancho, alto]`. */
export type QrParaElPdf = Readonly<{
  lado: number;
  cuadrados: (x: number, y: number) => readonly (readonly [number, number, number, number])[];
}>;

export function encabezado(
  p: Pincel,
  h: HojaParaElPdf,
  x: number,
  y: number,
  ancho: number,
): number {
  let cy = y;
  // Avisos del sistema (homologación): recuadro, centrado y en negrita.
  for (const leyenda of h.leyendas) {
    const interior = ancho - 2 * GROSOR_FUERTE - 2 * mm(1);
    const alto = p.texto(
      leyenda,
      x + GROSOR_FUERTE + mm(1),
      cy + GROSOR_FUERTE + mm(1),
      interior,
      { tam: 12, negrita: true },
      "center",
    );
    const total = alto + 2 * mm(1) + 2 * GROSOR_FUERTE;
    p.recuadro(
      x + GROSOR_FUERTE / 2,
      cy + GROSOR_FUERTE / 2,
      ancho - GROSOR_FUERTE,
      total - GROSOR_FUERTE,
      GROSOR_FUERTE,
    );
    cy += total + mm(2);
  }
  // Textos legales de la norma: texto normal del comprobante.
  for (const leyenda of h.leyendasLegales) {
    cy += p.texto(leyenda, x, cy, ancho, { tam: TAM }) + mm(2);
  }
  cy += cabecera(p, h, x, cy, ancho);
  cy += correspondeA(p, h, x, cy, ancho);
  cy += receptor(p, h, x, cy, ancho);
  return cy + mm(3) - y;
}

/** Emisor | letra y código | tipo, número y datos. */
function cabecera(p: Pincel, h: HojaParaElPdf, x: number, y: number, ancho: number): number {
  const lado = (ancho - ANCHO_DE_LA_LETRA) / 2;
  const interior = lado - 2 * RELLENO;
  const xCentro = x + lado;
  const xDerecha = xCentro + ANCHO_DE_LA_LETRA;

  let yIzquierda = y + RELLENO;
  if (h.nombreDeFantasia !== null) {
    yIzquierda += p.texto(h.nombreDeFantasia, x + RELLENO, yIzquierda, interior, {
      tam: 13,
      negrita: true,
    });
  }
  for (const fila of h.emisor) yIzquierda += p.fila(fila, x + RELLENO, yIzquierda, interior, TAM);
  if (h.contacto !== null)
    yIzquierda += p.texto(h.contacto, x + RELLENO, yIzquierda, interior, { tam: TAM });

  let yCentro = y + RELLENO;
  const interiorCentro = ANCHO_DE_LA_LETRA - 2 * RELLENO;
  yCentro += p.texto(
    h.letra,
    xCentro + RELLENO,
    yCentro,
    interiorCentro,
    { tam: 30, negrita: true, interlineado: 1.1 },
    "center",
  );
  yCentro += p.texto(h.codigo, xCentro + RELLENO, yCentro, interiorCentro, { tam: 8 }, "center");

  let yDerecha = y + RELLENO;
  yDerecha += p.texto(h.rotulo, xDerecha + RELLENO, yDerecha, interior, { tam: 13, negrita: true });
  yDerecha += p.texto(h.numero, xDerecha + RELLENO, yDerecha, interior, { tam: 11, negrita: true });
  for (const fila of h.datos) yDerecha += p.fila(fila, xDerecha + RELLENO, yDerecha, interior, TAM);

  const alto = Math.max(yIzquierda, yCentro, yDerecha) - y + RELLENO;
  p.recuadro(x, y, ancho, alto, GROSOR);
  p.linea(xCentro, y, xCentro, y + alto, GROSOR);
  p.linea(xDerecha, y, xDerecha, y + alto, GROSOR);
  return alto;
}

/** «Corresponde a …» de las notas: recuadro pegado a la cabecera, en negrita. */
function correspondeA(p: Pincel, h: HojaParaElPdf, x: number, y: number, ancho: number): number {
  if (h.corresponde === null) return 0;
  const alto = p.texto(h.corresponde, x + mm(2), y + mm(1.5), ancho - 2 * mm(2), {
    tam: TAM,
    negrita: true,
  });
  const total = alto + 2 * mm(1.5);
  p.recuadro(x, y, ancho, total, GROSOR);
  return total;
}

/** El receptor en dos columnas, pegado a lo de arriba. */
function receptor(p: Pincel, h: HojaParaElPdf, x: number, y: number, ancho: number): number {
  const columna = (ancho - 2 * RELLENO - mm(4)) / 2;
  let cy = y + RELLENO;
  for (let i = 0; i < h.receptor.length; i += 2) {
    const izquierda = h.receptor[i];
    const derecha = h.receptor[i + 1];
    const alto = Math.max(
      izquierda === undefined ? 0 : p.fila(izquierda, x + RELLENO, cy, columna, TAM),
      derecha === undefined ? 0 : p.fila(derecha, x + RELLENO + columna + mm(4), cy, columna, TAM),
    );
    cy += alto + (i + 2 < h.receptor.length ? mm(0.8) : 0);
  }
  const total = cy - y + RELLENO;
  p.recuadro(x, y, ancho, total, GROSOR);
  return total;
}

/** Una fila con el rótulo a la izquierda y el valor pegado a la derecha (`display: flex; justify-content: space-between`). */
function filaDeDosLados(
  p: Pincel,
  izquierda: string,
  derecha: string,
  x: number,
  y: number,
  ancho: number,
  estilo: { tam: number; negrita?: boolean },
): number {
  const anchoDelValor = Math.min(p.ancho(derecha, estilo) + 1, ancho / 2);
  const anchoDelRotulo = ancho - anchoDelValor - mm(2);
  const hRotulo = p.texto(izquierda, x, y, anchoDelRotulo, estilo);
  const hValor = p.texto(derecha, x + ancho - anchoDelValor, y, anchoDelValor, estilo, "right");
  return Math.max(hRotulo, hValor);
}

/** Los totales (o «A transportar») y la transparencia fiscal de la columna izquierda del pie, con el número de hoja al final. */
function columnaIzquierda(
  p: Pincel,
  h: HojaParaElPdf,
  e: DatosDelPie,
  x: number,
  y: number,
  ancho: number,
  altoReservado: number | null,
): number {
  let cy = y;
  if (e.aTransportar === null) {
    h.totales.forEach((t) => {
      if (t.fuerte) {
        cy += mm(0.5);
        p.linea(x, cy, x + ancho, cy, GROSOR_FUERTE);
        cy += GROSOR_FUERTE + mm(1);
      }
      cy +=
        filaDeDosLados(
          p,
          t.rotulo,
          t.valor,
          x,
          cy,
          ancho,
          t.fuerte ? { tam: 11, negrita: true } : { tam: TAM },
        ) + mm(1);
    });
    if (h.transparencia !== null) cy += transparencia(p, h.transparencia, x, cy, ancho) + mm(1);
  } else {
    cy +=
      filaDeDosLados(p, h.rotuloDeATransportar, e.aTransportar, x, cy, ancho, {
        tam: TAM,
        negrita: true,
      }) + mm(1);
  }
  const hNumero = p.alto(e.numeroDeHoja, ancho, { tam: 8 });
  const yDelNumero = altoReservado === null ? cy : y + altoReservado - hNumero;
  p.texto(e.numeroDeHoja, x, yDelNumero, ancho, { tam: 8 });
  return altoReservado === null ? cy - y + hNumero : altoReservado;
}

function transparencia(
  p: Pincel,
  t: NonNullable<HojaParaElPdf["transparencia"]>,
  x: number,
  y: number,
  ancho: number,
): number {
  const relleno = mm(1.5);
  const interior = ancho - 2 * relleno - 2 * GROSOR;
  let cy = y + GROSOR + relleno;
  cy += p.texto(t.titulo, x + GROSOR + relleno, cy, interior, { tam: 8, negrita: true }) + mm(0.5);
  for (const fila of t.filas) {
    cy += filaDeDosLados(p, fila.rotulo ?? "", fila.valor, x + GROSOR + relleno, cy, interior, {
      tam: 8,
    });
  }
  const total = cy - y + relleno + GROSOR;
  p.recuadro(x, y, ancho, total, GROSOR);
  return total;
}

export type DatosDelPie = Readonly<{
  /** El parcial que cierra una hoja que no es la última (ya con formato); `null` en la última: ahí van los totales. */
  aTransportar: string | null;
  /** «Hoja 2 de 3». */
  numeroDeHoja: string;
  qr: QrParaElPdf;
}>;

/**
 * El pie: totales y transparencia (o «A transportar») a la izquierda, CAE y QR a la derecha. Con `altoReservado === null` mide el pie
 * FINAL (el que más pide) y devuelve su alto; con un alto lo dibuja anclado en `y` y deja el número de hoja al borde de abajo.
 */
export function pie(
  p: Pincel,
  h: HojaParaElPdf,
  e: DatosDelPie,
  x: number,
  y: number,
  ancho: number,
  altoReservado: number | null,
): number {
  const textoDelCae = `${h.cae.rotulo} ${h.cae.valor}`;
  const derecho = Math.max(
    e.qr.lado,
    Math.min(p.ancho(textoDelCae, { tam: 8, negrita: true }) + 1, mm(75)),
  );
  const izquierdo = ancho - derecho - mm(4);
  const xDerecho = x + ancho - derecho;
  p.linea(x, y, x + ancho, y, GROSOR_FUERTE);
  const arriba = y + GROSOR_FUERTE + mm(2);

  const altoIzquierdo = columnaIzquierda(
    p,
    h,
    e,
    x,
    arriba,
    izquierdo,
    altoReservado === null ? null : altoReservado - (arriba - y),
  );
  const altoDelCae = p.fila(h.cae, xDerecho, arriba, derecho, 8);
  const yDelQr = arriba + altoDelCae + mm(1.5);
  p.cuadrados(e.qr.cuadrados(xDerecho + derecho - e.qr.lado, yDelQr));
  const altoDerecho = altoDelCae + mm(1.5) + e.qr.lado;
  return arriba - y + Math.max(altoIzquierdo, altoDerecho);
}
