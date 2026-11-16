import { describe, expect, it } from "vitest";
import {
  RANGO_DE_NUMERO_DE_PUNTO_DE_VENTA,
  esNumeroDePuntoDeVentaEnRango,
} from "./numero-de-punto-de-venta";

describe("número de punto de venta", () => {
  it("el rango es de 1 a 99999", () => {
    expect(RANGO_DE_NUMERO_DE_PUNTO_DE_VENTA).toEqual({ minimo: 1, maximo: 99999 });
  });

  it.each([1, 2, 500, 99998, 99999])("%i entra", (n) => {
    expect(esNumeroDePuntoDeVentaEnRango(n, RANGO_DE_NUMERO_DE_PUNTO_DE_VENTA)).toBe(true);
  });

  it.each([0, -1, 100000, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("%s no entra", (n) => {
    expect(esNumeroDePuntoDeVentaEnRango(n, RANGO_DE_NUMERO_DE_PUNTO_DE_VENTA)).toBe(false);
  });

  it("respeta un rango configurado, con sus dos extremos incluidos", () => {
    const rango = { minimo: 5, maximo: 7 };
    expect([4, 5, 6, 7, 8].map((n) => esNumeroDePuntoDeVentaEnRango(n, rango))).toEqual([
      false,
      true,
      true,
      true,
      false,
    ]);
  });
});
