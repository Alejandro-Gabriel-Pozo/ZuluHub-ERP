import { describe, expect, it } from "vitest";
import { numeroDeCorreccion } from "./rotulo";

describe("numeroDeCorreccion (decisión 177, P29)", () => {
  it("el original (ejemplar 1) no está corregido; cada corrección o anulación suma una", () => {
    expect(numeroDeCorreccion(1)).toBe(0);
    expect(numeroDeCorreccion(2)).toBe(1);
    expect(numeroDeCorreccion(3)).toBe(2);
  });
  it("un ejemplar vigente menor que 1, o no entero, es un dato roto y se frena", () => {
    for (const roto of [0, -1, 1.5, Number.NaN]) {
      expect(() => numeroDeCorreccion(roto)).toThrow(RangeError);
      expect(() => numeroDeCorreccion(roto)).toThrow("entero mayor o igual que 1");
    }
  });
});
