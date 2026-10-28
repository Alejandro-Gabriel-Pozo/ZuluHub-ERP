import { describe, expect, it } from "vitest";
import { cuitConGuiones } from "../../apps/plataforma/logica/formato-de-cuit";

describe("cuitConGuiones", () => {
  it("formatea 11 dígitos como XX-XXXXXXXX-X", () => {
    expect(cuitConGuiones("30701112223")).toBe("30-70111222-3");
  });

  it("si ya tiene guiones lo devuelve igual", () => {
    expect(cuitConGuiones("30-70111222-3")).toBe("30-70111222-3");
  });

  it.each([
    "3070111222",
    "307011122233",
    "3070111222a",
    "abcdefghijk",
    "",
    " ",
    "30701112223 ",
    " 30701112223",
  ])("devuelve tal cual %j", (texto) => {
    expect(cuitConGuiones(texto)).toBe(texto);
  });

  it("no lanza con caracteres raros", () => {
    for (const texto of [
      "\n",
      "\u0000",
      "💥",
      "３０７０１１１２２２３",
      "30701112223\n",
      "<b>x</b>",
      "'; --",
    ]) {
      expect(() => cuitConGuiones(texto)).not.toThrow();
      expect(cuitConGuiones(texto)).toBe(texto);
    }
  });
});
