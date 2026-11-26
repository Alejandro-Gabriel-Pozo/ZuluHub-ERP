import { describe, expect, it } from "vitest";
import { LARGO_MAXIMO_DE_LA_NOTA_DE_COCINA, notaDeCocinaDesdeTexto } from "./nota-de-cocina";

/** La nota para la cocina (SAL-G): una línea de la lista de permitidos del catálogo, 1 a 120; la nota nunca se interpreta. */
describe("notaDeCocinaDesdeTexto", () => {
  it("acepta una nota corta, con los signos del catálogo, y el largo justo; recorta los extremos", () => {
    expect(notaDeCocinaDesdeTexto("  sin cebolla ")).toEqual({ ok: true, valor: "sin cebolla" });
    expect(notaDeCocinaDesdeTexto("¡bien cocida! 2 x 1 (sin sal)").ok).toBe(true);
    expect(notaDeCocinaDesdeTexto("#12").ok).toBe(true);
    const justo = "a".repeat(LARGO_MAXIMO_DE_LA_NOTA_DE_COCINA);
    expect(notaDeCocinaDesdeTexto(justo)).toEqual({ ok: true, valor: justo });
  });

  it("rechaza vacío, solo espacios, más de 120, controles, saltos de línea, HTML, fórmulas y emojis", () => {
    expect(notaDeCocinaDesdeTexto("")).toEqual({ ok: false, error: "VACIO" });
    expect(notaDeCocinaDesdeTexto("   ")).toEqual({ ok: false, error: "VACIO" });
    expect(notaDeCocinaDesdeTexto("a".repeat(121))).toEqual({
      ok: false,
      error: "DEMASIADO_LARGO",
    });
    for (const texto of ["dos\nlíneas", "a\u0007b", "<b>x</b>", "=SUMA(A1)", "-1+1", "con 🍕"]) {
      expect(notaDeCocinaDesdeTexto(texto).ok, texto).toBe(false);
    }
  });

  it("el largo máximo es el de la base (0104: texto_de_catalogo_valido(nota, 120))", () => {
    expect(LARGO_MAXIMO_DE_LA_NOTA_DE_COCINA).toBe(120);
  });
});
