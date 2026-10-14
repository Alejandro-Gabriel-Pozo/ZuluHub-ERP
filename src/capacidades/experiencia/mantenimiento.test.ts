import { describe, expect, it } from "vitest";
import { cabecerasDe, nonceDe } from "./cabeceras";
import { REINTENTO_DE_MANTENIMIENTO_EN_S, respuestaDeMantenimiento } from "./mantenimiento";

const NONCE = nonceDe(new Uint8Array(16).fill(3));
const REFERENCIA = "ZH-1A2B-3C4D";
const armar = (produccion = false) =>
  respuestaDeMantenimiento({
    referencia: REFERENCIA,
    cabeceras: cabecerasDe("NEUTRA", NONCE, { produccion }),
  });

describe("respuestaDeMantenimiento", () => {
  it("es un 503 (falla del servicio, no una página que no existe) con Retry-After", () => {
    const r = armar();
    expect(r.estado).toBe(503);
    expect(REINTENTO_DE_MANTENIMIENTO_EN_S).toBe(60);
    expect(r.encabezados["Retry-After"]).toBe("60");
  });

  it("el HTML es exactamente este (sin nada de más)", () => {
    expect(armar().cuerpo).toBe(
      [
        "<!doctype html>",
        '<html lang="es-AR">',
        "<head>",
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        '<meta name="robots" content="noindex">',
        "<title>En mantenimiento</title>",
        "</head>",
        "<body>",
        "<main>",
        "<h1>En mantenimiento</h1>",
        "<p>Estamos actualizando el sistema. Volvé a intentar en unos minutos.</p>",
        "<p>Si sigue igual, avisale a soporte esta referencia: <strong>ZH-1A2B-3C4D</strong></p>",
        "</main>",
        "</body>",
        "</html>",
      ].join("\n"),
    );
  });

  it("dice «En mantenimiento» y la referencia, en castellano rioplatense, y nada más del sistema", () => {
    const { cuerpo } = armar();
    expect(cuerpo).toContain("<title>En mantenimiento</title>");
    expect(cuerpo).toContain("<h1>En mantenimiento</h1>");
    expect(cuerpo).toContain("Volvé a intentar en unos minutos.");
    expect(cuerpo).toContain(`<strong>${REFERENCIA}</strong>`);
    expect(cuerpo).toContain('<html lang="es-AR">');
    expect(cuerpo.startsWith("<!doctype html>")).toBe(true);
    // No dice por qué ni cuál migración, ni de qué marca es.
    expect(cuerpo.toLowerCase()).not.toMatch(/migraci|base de datos|postgres|vercel|neon/);
  });

  it("no lleva scripts ni estilos en línea ni enlaces a recursos", () => {
    const { cuerpo } = armar();
    expect(cuerpo).not.toMatch(/<script|<style|style=|<link|<img|<iframe|href=|src=/i);
  });

  it("es de contenido HTML en UTF-8 y trae las mismas cabeceras que la página neutra", () => {
    const r = armar(true);
    expect(r.encabezados["Content-Type"]).toBe("text/html; charset=utf-8");
    for (const [nombre, valor] of Object.entries(
      cabecerasDe("NEUTRA", NONCE, { produccion: true }),
    )) {
      expect(r.encabezados[nombre], nombre).toBe(valor);
    }
  });

  it("nunca se indexa, ni en producción, no se cachea y no pone cookies", () => {
    for (const produccion of [true, false]) {
      const e = armar(produccion).encabezados;
      expect(e["X-Robots-Tag"]).toBe("noindex");
      expect(e["Cache-Control"]).toBe("private, no-store");
      expect(Object.keys(e).map((n) => n.toLowerCase())).not.toContain("set-cookie");
    }
    expect(armar().cuerpo).toContain('<meta name="robots" content="noindex">');
  });

  it.each([
    "",
    "ZH-1A2B-3C4D<script>",
    "<b>ZH-1A2B-3C4D</b>",
    "zh-1a2b-3c4d",
    "ZH-1A2B-3C4",
    "ZH-1A2B-3C4D5",
    "ZH-1A2B3C4D",
    "ZH-1A2G-3C4D",
    " ZH-1A2B-3C4D",
    "ZH-1A2B-3C4D\n",
    "XZH-1A2B-3C4D",
  ])("rechaza la referencia %j antes de ponerla en el HTML", (referencia) => {
    expect(() =>
      respuestaDeMantenimiento({
        referencia,
        cabeceras: cabecerasDe("NEUTRA", NONCE, { produccion: false }),
      }),
    ).toThrow(RangeError);
    expect(() =>
      respuestaDeMantenimiento({
        referencia,
        cabeceras: cabecerasDe("NEUTRA", NONCE, { produccion: false }),
      }),
    ).toThrow(/ZH-XXXX-XXXX/);
  });

  it("las cabeceras que recibe pasan tal cual, y las suyas (tipo y reintento) pisan a las que coincidan", () => {
    const r = respuestaDeMantenimiento({
      referencia: REFERENCIA,
      cabeceras: { "X-Uno": "1", "Content-Type": "otro", "Retry-After": "0" },
    });
    expect(r.encabezados).toEqual({
      "X-Uno": "1",
      "Content-Type": "text/html; charset=utf-8",
      "Retry-After": "60",
    });
  });
});
