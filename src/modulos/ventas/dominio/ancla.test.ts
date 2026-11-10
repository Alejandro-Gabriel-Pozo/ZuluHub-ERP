import { describe, expect, it } from "vitest";
import { anclaValida, etiquetaDeCuenta } from "./ancla";

const id = "11111111-1111-4111-8111-111111111111";

describe("ancla de una cuenta", () => {
  it("tipo de letras minúsculas y guion bajo con un punto opcional, y un uuid", () => {
    expect(anclaValida({ tipo: "salon.mesa", id }).ok).toBe(true);
    expect(anclaValida({ tipo: "mesa", id }).ok).toBe(true);
    expect(anclaValida({ tipo: "mesa_alta", id }).ok).toBe(true);
  });
  it("rechaza mayúsculas, dígitos, dos puntos, vacío, largo de más y un id que no es uuid", () => {
    for (const tipo of [
      "Mesa",
      "mesa1",
      "a.b.c",
      "",
      ".mesa",
      "mesa.",
      "x".repeat(41),
      "mesa mesa",
    ]) {
      expect(anclaValida({ tipo, id })).toEqual({ ok: false, error: "ANCLA_INVALIDA" });
    }
    expect(anclaValida({ tipo: "x".repeat(40), id }).ok).toBe(true);
    expect(anclaValida({ tipo: "mesa", id: "no-es-uuid" })).toEqual({
      ok: false,
      error: "ANCLA_INVALIDA",
    });
  });
});

describe("etiqueta de una cuenta", () => {
  it("un texto corto de una línea", () => {
    expect(etiquetaDeCuenta("Mesa 4")).toEqual({ ok: true, valor: "Mesa 4" });
    expect(etiquetaDeCuenta("x".repeat(40)).ok).toBe(true);
    // No exige letra: «12» o «2x1» son etiquetas posibles.
    expect(etiquetaDeCuenta("12")).toEqual({ ok: true, valor: "12" });
  });
  it("rechaza vacío, largo de más, saltos de línea, HTML y fórmulas", () => {
    for (const mala of ["", "  ", "x".repeat(41), "a\nb", "<b>", "=1+1", "+54"]) {
      expect(etiquetaDeCuenta(mala)).toEqual({ ok: false, error: "ETIQUETA_INVALIDA" });
    }
  });
});
