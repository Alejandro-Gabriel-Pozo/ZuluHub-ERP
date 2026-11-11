import { describe, expect, it } from "vitest";
import { FORMATO_DE_PAIS, paisDesdeTexto } from "./pais";

describe("paisDesdeTexto", () => {
  it("la forma está en una sola constante", () => {
    expect(FORMATO_DE_PAIS.source).toBe("^[A-Z]{2}$");
  });

  it("acepta dos letras mayúsculas", () => {
    for (const texto of ["AR", "BR", "UY", "ZZ"]) {
      expect(paisDesdeTexto(texto), texto).toEqual({ ok: true, valor: texto });
    }
  });

  it("rechaza minúsculas, otro largo, dígitos, tildes, blancos y vacío", () => {
    for (const texto of [
      "ar",
      "Ar",
      "ARG",
      "A",
      "",
      "A1",
      "1A",
      "Ñ",
      "ÑA",
      " AR",
      "AR ",
      "A R",
      "AR\n",
    ]) {
      expect(paisDesdeTexto(texto), JSON.stringify(texto)).toEqual({
        ok: false,
        error: "PAIS_INVALIDO",
      });
    }
  });
});
