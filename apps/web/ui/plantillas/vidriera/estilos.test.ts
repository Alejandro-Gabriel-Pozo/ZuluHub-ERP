import { describe, expect, it } from "vitest";

/**
 * Los CSS de la plantilla de la carta: texto solo con tokens semánticos (nunca el color de la marca, que
 * solo pinta fondos) y tamaños siempre relativos (rem/em).
 */
const fuentes = import.meta.glob("./*.module.css", {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("CSS de la carta", () => {
  it("encuentra los estilos", () => {
    expect(Object.keys(fuentes).length).toBeGreaterThanOrEqual(8);
  });

  it("ningún `color:` usa un valor de la marca: el texto es de los tokens semánticos", () => {
    for (const [archivo, texto] of Object.entries(fuentes)) {
      for (const m of (texto as string).matchAll(/(?<![-\w])color:\s*([^;]+);/g)) {
        const valor = m[1] ?? "";
        const permitido =
          /^var\(--color-(texto|texto-suave|fondo|agotado)\)$/.test(valor) ||
          valor === "inherit" ||
          // El texto sobre el color de la marca (la cabecera y el botón «Ver toda la carta») es el par que la
          // marca valida entre sí (`on-primary` sobre `primary`).
          valor === "var(--accion-primaria-texto)";
        expect(permitido, `${archivo}: color: ${valor}`).toBe(true);
      }
    }
  });

  it("la marca solo pinta fondos y bordes decorativos, nunca `color`", () => {
    for (const [archivo, texto] of Object.entries(fuentes)) {
      expect(texto as string, archivo).not.toMatch(
        /(?<![-\w])color:\s*var\(--(acento|secundario|accion-primaria-fondo|brand)/,
      );
    }
  });

  it("ningún font-size en px", () => {
    for (const [archivo, texto] of Object.entries(fuentes)) {
      expect(texto as string, archivo).not.toMatch(/font(-size)?:[^;]*\d\s*px/i);
    }
  });
});
