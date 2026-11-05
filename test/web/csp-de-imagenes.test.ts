import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { politicaDeContenido } from "../../src/capacidades/experiencia/cabeceras";
import { Qr } from "../../apps/web/ui/plantillas/facturacion/impresion/PiezasDeLaHoja";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * Contrato entre lo que la app usa como `src` de una imagen y la CSP real. Previene: el QR fiscal roto en el
 * navegador porque `img-src` no admitía el esquema `data:` con el que se dibuja (Chromium de las pruebas de
 * componentes no aplica las cabeceras de Next, así que solo esta prueba lo ata). Cubre el QR, la única imagen
 * con `src` no relativo de la app; las fotos de producto usan rutas propias (`'self'`).
 */
const NONCE = "AAAAAAAAAAAAAAAAAAAAAA";
const SVG_DE_EJEMPLO =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>';

function fuentesDeImagen(): string[] {
  const html = renderToStaticMarkup(createElement(Qr, { qrSvg: SVG_DE_EJEMPLO }));
  return [...html.matchAll(/<img\b[^>]*?\ssrc="([^"]*)"/g)].map((m) =>
    (m[1] ?? "").replace(/&amp;/g, "&"),
  );
}

const imgSrc = (): string[] =>
  politicaDeContenido(NONCE)
    .split("; ")
    .find((d) => d.startsWith("img-src "))
    ?.slice("img-src ".length)
    .split(" ") ?? [];

/** Una ruta relativa o del mismo origen la cubre `'self'`; un esquema (`data:`, `https:`) tiene que figurar explícito. */
function permitida(src: string, fuentes: string[]): boolean {
  const esquema = /^([a-z][a-z0-9+.-]*:)/i.exec(src)?.[1]?.toLowerCase();
  if (esquema === undefined) return src.startsWith("/") && fuentes.includes("'self'");
  return fuentes.includes(esquema);
}

describe("las imágenes de la app y img-src de la CSP", () => {
  it("el QR se dibuja con un esquema que la política permite", () => {
    const fuentes = fuentesDeImagen();
    expect(fuentes).toHaveLength(1);
    expect(fuentes[0]).toMatch(/^data:image\/svg\+xml/);
    for (const src of fuentes) expect(permitida(src, imgSrc()), src).toBe(true);
  });

  it("img-src no abre más esquemas que los necesarios", () => {
    expect(imgSrc().sort()).toEqual(["'self'", "data:"]);
  });

  it("el verificador rechaza lo que la política no admite", () => {
    expect(permitida("https://x.test/a.png", ["'self'", "data:"])).toBe(false);
    expect(permitida("data:image/svg+xml,x", ["'self'"])).toBe(false);
    expect(permitida("/fotos/a.png", ["'self'"])).toBe(true);
  });
});
