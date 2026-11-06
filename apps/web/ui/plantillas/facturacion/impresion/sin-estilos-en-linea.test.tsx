import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ComprobanteImpreso } from "./ComprobanteImpreso.cliente";
import { EstiloDePagina } from "./EstiloDePagina";
import { HojasA4 } from "./HojasA4";
import { MedidorDeLaHoja } from "./MedidorDeLaHoja.cliente";
import { TicketDe80mm } from "./TicketDe80mm.cliente";
import { VistaPrevia } from "./VistaPrevia.cliente";
import { comprobanteDePrueba, QR_DE_PRUEBA } from "./ayudas-de-impresion";
import { entradaDelPaginador, type Medidas } from "./medicion";
import { armarLaHoja } from "./modelo-de-la-hoja";
import { paginar } from "./paginador";

/**
 * Contrato entre la vista de impresión y la CSP real (`style-src 'self' 'nonce-…'`, sin `unsafe-inline`). Previene: un atributo `style=`
 * o un `<style>` sin nonce en el HTML del servidor: Chromium los bloquea y React no los vuelve a poner al hidratar, así que la geometría
 * de la hoja A4 y del ticket (`@page`, alto de hoja, escala) quedaba sin aplicar en Vercel. Se probó en la app real con `next start`;
 * el Chromium de las pruebas de componentes no aplica las cabeceras de Next, así que solo esta prueba lo ata. Las medidas se ponen por
 * CSSOM (`aplicarEstilos`) y la `@page` en una hoja construida: `hoja-a4.test.tsx` y `ticket.test.tsx` miden en Chromium que rigen.
 */

/** Lo que de un HTML de servidor choca con la política: atributos `style=` y `<style>` sin el atributo `nonce`. */
function violacionesDeEstilo(html: string): string[] {
  const problemas: string[] = [];
  for (const m of html.matchAll(/<[a-z][^>]*?\sstyle\s*=/gi))
    problemas.push(`atributo style en ${m[0]}`);
  for (const m of html.matchAll(/<style\b[^>]*>/gi)) {
    if (!/\snonce\s*=/.test(m[0])) problemas.push(`<style> sin nonce: ${m[0]}`);
  }
  return problemas;
}

const COMPROBANTE = comprobanteDePrueba({ renglones: 4, leyendas: ["HOMOLOGACIÓN"] });
const MEDIDAS: Medidas = {
  encabezadoDeLaHoja: 120,
  encabezadoDeLaTabla: 24,
  filaDeTransporte: 24,
  renglones: COMPROBANTE.renglones.map(() => 30),
  pie: 150,
};
const A = armarLaHoja({}, COMPROBANTE, "A4");
const PAGINACION = paginar(
  entradaDelPaginador(
    MEDIDAS,
    COMPROBANTE.renglones.map((r) => r.importe),
  ),
);
const NOOP = () => undefined;

/** Cada pieza de la vista de impresión que se dibuja en el servidor, con una marca que prueba que salió contenido (no un HTML vacío). */
const PIEZAS: readonly { nombre: string; elemento: ReactElement; marca: string }[] = [
  {
    nombre: "ComprobanteImpreso A4",
    elemento: createElement(ComprobanteImpreso, {
      comprobante: COMPROBANTE,
      qrSvg: QR_DE_PRUEBA,
      formato: "A4",
    }),
    marca: "data-medidor",
  },
  {
    nombre: "ComprobanteImpreso ticket",
    elemento: createElement(ComprobanteImpreso, {
      comprobante: COMPROBANTE,
      qrSvg: QR_DE_PRUEBA,
      formato: "TICKET",
    }),
    marca: "data-ticket",
  },
  {
    nombre: "VistaPrevia",
    elemento: createElement(VistaPrevia, {
      anchoNatural: 794,
      children: createElement("p", null, "hola"),
    }),
    marca: "data-vista-previa",
  },
  {
    nombre: "EstiloDePagina A4",
    elemento: createElement(EstiloDePagina, { formato: "A4", altoDelTicketEnMm: null }),
    marca: "",
  },
  {
    nombre: "EstiloDePagina ticket",
    elemento: createElement(EstiloDePagina, { formato: "TICKET", altoDelTicketEnMm: 150 }),
    marca: "",
  },
  {
    nombre: "HojasA4",
    elemento: createElement(HojasA4, {
      a: A,
      paginacion: PAGINACION,
      altoDelPie: 150,
      qrSvg: QR_DE_PRUEBA,
      diccionario: {},
    }),
    marca: "data-hoja",
  },
  {
    nombre: "MedidorDeLaHoja",
    elemento: createElement(MedidorDeLaHoja, {
      a: A,
      qrSvg: QR_DE_PRUEBA,
      diccionario: {},
      alMedir: NOOP,
    }),
    marca: "data-medidor",
  },
  {
    nombre: "TicketDe80mm",
    elemento: createElement(TicketDe80mm, {
      a: armarLaHoja({}, COMPROBANTE, "TICKET"),
      qrSvg: QR_DE_PRUEBA,
      alMedirElAlto: NOOP,
    }),
    marca: "data-ticket",
  },
];

describe("la vista de impresión y la CSP: nada de estilos en línea en el HTML del servidor", () => {
  for (const { nombre, elemento, marca } of PIEZAS) {
    it(`${nombre}: sin atributo style ni <style> sin nonce`, () => {
      const html = renderToStaticMarkup(elemento);
      expect(html).toContain(marca);
      expect(violacionesDeEstilo(html)).toEqual([]);
    });
  }

  it("el verificador rechaza lo que la política bloquea y deja pasar un <style> con nonce", () => {
    expect(violacionesDeEstilo('<section style="--hoja-ancho:210mm">x</section>')).toHaveLength(1);
    expect(violacionesDeEstilo("<style>@page{size:A4}</style>")).toHaveLength(1);
    expect(violacionesDeEstilo('<style data-x="1">@page{size:A4}</style>')).toHaveLength(1);
    expect(violacionesDeEstilo('<STYLE nonce="AAAAAAAAAAAAAAAAAAAAAA">a{}</STYLE>')).toEqual([]);
    expect(violacionesDeEstilo('<p class="estilo">style="no es un atributo"</p>')).toEqual([]);
  });
});
