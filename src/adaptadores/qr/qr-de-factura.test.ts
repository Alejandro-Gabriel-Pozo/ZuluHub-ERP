import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CORRECCION_DEL_QR_DE_FACTURA, qrDeFacturaComoSvg } from "./qr-de-factura";
import { matrizDelQr, svgDeLaMatriz } from "./qr-svg";

/** La URL del QR de la factura B del golden de fiscal (la que arma `urlDelQr`; `qr-de-arca.test.ts` la verifica). */
const URL_DE_LA_FACTURA_B = readFileSync(
  "src/modulos/fiscal/dominio/golden/qr-factura-b.golden.txt",
  "utf8",
).trim();

describe("qrDeFacturaComoSvg", () => {
  it("la URL de la factura B del golden es una URL de ARCA con el parámetro p", () => {
    expect(URL_DE_LA_FACTURA_B).toMatch(
      /^https:\/\/www\.afip\.gob\.ar\/fe\/qr\/\?p=[A-Za-z0-9+/=]+$/,
    );
  });

  it("es determinista: el mismo texto da el mismo SVG, y otro texto, otro", () => {
    expect(qrDeFacturaComoSvg(URL_DE_LA_FACTURA_B)).toBe(qrDeFacturaComoSvg(URL_DE_LA_FACTURA_B));
    expect(qrDeFacturaComoSvg(URL_DE_LA_FACTURA_B)).not.toBe(
      qrDeFacturaComoSvg(`${URL_DE_LA_FACTURA_B}A`),
    );
  });

  it("es el dibujo de la matriz con el nivel supuesto, y el nivel se puede cambiar", () => {
    expect(CORRECCION_DEL_QR_DE_FACTURA).toBe("M");
    expect(qrDeFacturaComoSvg(URL_DE_LA_FACTURA_B)).toBe(
      svgDeLaMatriz(matrizDelQr(URL_DE_LA_FACTURA_B, "M")),
    );
    expect(qrDeFacturaComoSvg(URL_DE_LA_FACTURA_B, "H")).toBe(
      svgDeLaMatriz(matrizDelQr(URL_DE_LA_FACTURA_B, "H")),
    );
    expect(qrDeFacturaComoSvg(URL_DE_LA_FACTURA_B, "H")).not.toBe(
      qrDeFacturaComoSvg(URL_DE_LA_FACTURA_B, "M"),
    );
  });

  it("solo contiene formas: ni la URL ni ningún pedazo de ella aparecen como atributo de texto, y no hay texto nuevo", () => {
    const svg = qrDeFacturaComoSvg(URL_DE_LA_FACTURA_B);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" ')).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    const sinEspacioDeNombres = svg.replace('xmlns="http://www.w3.org/2000/svg"', "");
    for (const pedazo of [URL_DE_LA_FACTURA_B, "afip", "arca", "https", "?p=", "eyJ2ZXIi"]) {
      expect(sinEspacioDeNombres, pedazo).not.toContain(pedazo);
    }
    expect(svg).not.toMatch(/<script|<foreignObject|<image|<text|<title|<desc|href=|on\w+=/i);
    expect(svg).not.toMatch(/role=|aria-label=/);
    expect([...new Set([...svg.matchAll(/<([a-zA-Z]+)/g)].map((m) => m[1]))].sort()).toEqual([
      "path",
      "rect",
      "svg",
    ]);
    // Los únicos atributos son los de dibujo (medidas, colores y renderizado), todos con valor numérico, de color o fijo.
    const atributos = [...svg.matchAll(/ ([a-zA-Z:-]+)="[^"]*"/g)].map((m) => m[1]);
    expect([...new Set(atributos)].sort()).toEqual([
      "d",
      "fill",
      "height",
      "shape-rendering",
      "viewBox",
      "width",
      "xmlns",
    ]);
  });
});
