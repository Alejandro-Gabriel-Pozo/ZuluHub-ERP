import { describe, expect, it } from "vitest";
import { cuitConGuiones, cuitDesdeTexto, digitoVerificadorDeCuit } from "./cuit";

describe("CUIT", () => {
  it.each([
    ["20123456786", "20123456786"],
    ["33693450239", "33693450239"],
    ["20-12345678-6", "20123456786"],
    ["33-69345023-9", "33693450239"],
  ])("acepta %s y lo guarda como %s", (entrada, canonico) => {
    expect(cuitDesdeTexto(entrada)).toEqual({ ok: true, valor: canonico });
  });

  it.each([
    "",
    "2012345678",
    "201234567866",
    "2012345678a",
    "20 12345678 6",
    "20-12345678-66",
    "2012-345678-6",
    "20_12345678_6",
    "２０１２３４５６７８６",
    "20123456786\n",
  ])("rechaza %j por formato", (entrada) => {
    expect(cuitDesdeTexto(entrada)).toEqual({ ok: false, error: "CUIT_FORMATO_INVALIDO" });
  });

  it("rechaza un dígito verificador equivocado", () => {
    expect(cuitDesdeTexto("20123456787")).toEqual({
      ok: false,
      error: "CUIT_DIGITO_VERIFICADOR_INVALIDO",
    });
    expect(cuitDesdeTexto("20-12345678-0")).toEqual({
      ok: false,
      error: "CUIT_DIGITO_VERIFICADOR_INVALIDO",
    });
  });

  it("dígito verificador: resto 11 da 0, resto 10 no tiene dígito válido", () => {
    expect(digitoVerificadorDeCuit("2012345678")).toBe(6);
    expect(digitoVerificadorDeCuit("3369345023")).toBe(9);
    // Solo pesa la última posición (peso 2): suma 0 → resto 11 → 0; suma 10 → resto 1; suma 12 → resto 10 → sin dígito.
    expect(digitoVerificadorDeCuit("0000000000")).toBe(0);
    expect(digitoVerificadorDeCuit("0000000005")).toBe(1);
    expect(digitoVerificadorDeCuit("0000000006")).toBeNull();
    expect(digitoVerificadorDeCuit("0000000001")).toBe(9);
  });

  it("un CUIT cuyo verificador correcto no existe se rechaza, con cualquier dígito", () => {
    for (let d = 0; d <= 9; d++) {
      expect(cuitDesdeTexto(`0000000006${d}`)).toEqual({
        ok: false,
        error: "CUIT_DIGITO_VERIFICADOR_INVALIDO",
      });
    }
  });

  it("se muestra con guiones", () => {
    const r = cuitDesdeTexto("20123456786");
    expect(r.ok && cuitConGuiones(r.valor)).toBe("20-12345678-6");
  });
});
