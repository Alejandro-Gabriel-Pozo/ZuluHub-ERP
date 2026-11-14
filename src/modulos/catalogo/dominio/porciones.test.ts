import { describe, expect, it } from "vitest";
import { cantidadATexto } from "../../../primitivas/cantidad/cantidad";
import {
  esPorcion,
  fraccionesAdmitidasEn,
  pasoDePorciones,
  PORCIONES_PERMITIDAS,
  validarPorciones,
} from "./porciones";

describe("porciones", () => {
  it("solo se permiten 2, 4 y 8 (tercios y sextos quedan fuera)", () => {
    expect(PORCIONES_PERMITIDAS).toEqual([2, 4, 8]);
    for (const p of [2, 4, 8]) expect(esPorcion(p)).toBe(true);
    for (const p of [0, 1, 3, 5, 6, 7, 9, 16, -2, 2.5, Number.NaN])
      expect(esPorcion(p)).toBe(false);
  });

  it("valida una o varias porciones y las devuelve en orden ascendente", () => {
    expect(validarPorciones([8])).toEqual({ ok: true, valor: [8] });
    expect(validarPorciones([8, 2])).toEqual({ ok: true, valor: [2, 8] });
    expect(validarPorciones([4, 8, 2])).toEqual({ ok: true, valor: [2, 4, 8] });
  });

  it("rechaza una lista vacía, una porción que no se ofrece o repetida", () => {
    const mal = { ok: false, error: "PORCIONES_INVALIDAS" };
    expect(validarPorciones([])).toEqual(mal);
    expect(validarPorciones([3])).toEqual(mal);
    expect(validarPorciones([2, 6])).toEqual(mal);
    expect(validarPorciones([2, 2])).toEqual(mal);
    expect(validarPorciones([8, 4, 8])).toEqual(mal);
    expect(validarPorciones([2.5])).toEqual(mal);
  });

  it("el paso mínimo es el de la porción más fina: 2 → 0,5; 4 → 0,25; 8 → 0,125; 2 y 8 → 0,125", () => {
    const paso = (...p: (2 | 4 | 8)[]) => cantidadATexto(pasoDePorciones(p));
    expect(paso(2)).toBe("0.5000");
    expect(paso(4)).toBe("0.2500");
    expect(paso(8)).toBe("0.1250");
    expect(paso(2, 8)).toBe("0.1250");
    expect(paso(8, 2)).toBe("0.1250");
    expect(paso(2, 4)).toBe("0.2500");
  });

  it("sin porciones no hay paso que derivar (defecto de quien llama)", () => {
    expect(() => pasoDePorciones([])).toThrow(RangeError);
    expect(() => pasoDePorciones([])).toThrow("hace falta al menos una porción");
  });

  it("las fracciones solo se ofrecen en un producto «por unidad»: misma unidad de venta que la base y de conteo", () => {
    expect(fraccionesAdmitidasEn("UNIDAD", "UNIDAD")).toBe(true);
    expect(fraccionesAdmitidasEn("GRAMO", "GRAMO")).toBe(false);
    expect(fraccionesAdmitidasEn("GRAMO", "KILOGRAMO")).toBe(false);
    expect(fraccionesAdmitidasEn("UNIDAD", "GRAMO")).toBe(false);
    expect(fraccionesAdmitidasEn("GRAMO", "UNIDAD")).toBe(false);
    expect(fraccionesAdmitidasEn("INVENTADA", "INVENTADA")).toBe(false);
  });
});
