import { describe, expect, it } from "vitest";
import { LARGO_MAXIMO_DEL_DOMICILIO_LIBRE, domicilioLibreDesdeTexto } from "./domicilio-libre";

describe("domicilioLibreDesdeTexto", () => {
  it("ausente, vacío o en blanco es «no tiene»", () => {
    for (const texto of [null, "", "   ", " "]) {
      expect(domicilioLibreDesdeTexto(texto), JSON.stringify(texto)).toEqual({
        ok: true,
        valor: null,
      });
    }
  });

  it("acepta un domicilio común, también todo números, y lo deja en su forma canónica", () => {
    expect(domicilioLibreDesdeTexto("  Av.  Siempreviva 742 ")).toEqual({
      ok: true,
      valor: "Av. Siempreviva 742",
    });
    expect(domicilioLibreDesdeTexto("9 de Julio 1234, Piso 3 Dto. «B»").ok).toBe(true);
    expect(domicilioLibreDesdeTexto("1234").ok).toBe(true);
  });

  it("rechaza saltos de línea y otros caracteres de control (la base los rechaza: antes fallaba allá)", () => {
    for (const texto of ["Av. X\n742", "Av. X\t742", "Av. X\u0000742"]) {
      expect(domicilioLibreDesdeTexto(texto), JSON.stringify(texto)).toEqual({
        ok: false,
        error: "DOMICILIO_INVALIDO",
      });
    }
  });

  it("rechaza invisibles, bidi, etiquetas y emojis", () => {
    for (const texto of ["Av.‮ X", "Av.​ X", "<b>X</b>", "Av. X 🏠"]) {
      expect(domicilioLibreDesdeTexto(texto).ok, JSON.stringify(texto)).toBe(false);
    }
  });

  it("no puede empezar con `+`, `-`, `=` ni `@` (inyección de fórmulas)", () => {
    for (const texto of ["+54 11 4321", "-Av. X 742", "=Av. X", "@Av. X"]) {
      expect(domicilioLibreDesdeTexto(texto), texto).toEqual({
        ok: false,
        error: "DOMICILIO_INVALIDO",
      });
    }
    expect(domicilioLibreDesdeTexto("Av. 9-A 742").ok).toBe(true);
  });

  it("el largo exacto entra y uno más no; se cuenta por carácter", () => {
    expect(domicilioLibreDesdeTexto("d".repeat(LARGO_MAXIMO_DEL_DOMICILIO_LIBRE)).ok).toBe(true);
    expect(domicilioLibreDesdeTexto("d".repeat(LARGO_MAXIMO_DEL_DOMICILIO_LIBRE + 1))).toEqual({
      ok: false,
      error: "DOMICILIO_INVALIDO",
    });
  });

  it("el largo máximo es 300, el que el sistema ya tenía", () => {
    expect(LARGO_MAXIMO_DEL_DOMICILIO_LIBRE).toBe(300);
  });
});
