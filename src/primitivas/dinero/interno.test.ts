import { describe, expect, it } from "vitest";
import { crearImporte, crearMontoExacto, crearPrecioUnitario, mcd, mcm } from "./interno";
import { ARS } from "./moneda";

describe("mcd y mcm", () => {
  it("mcd: casos conocidos, con signos y con cero", () => {
    expect(mcd(12n, 18n)).toBe(6n);
    expect(mcd(-12n, 18n)).toBe(6n);
    expect(mcd(7n, 13n)).toBe(1n);
    expect(mcd(0n, 5n)).toBe(5n);
    expect(mcd(5n, 0n)).toBe(5n);
  });

  it("mcm: el menor múltiplo común, no cualquiera", () => {
    expect(mcm(4n, 6n)).toBe(12n);
    expect(mcm(1n, 7n)).toBe(7n);
    expect(mcm(10n, 10n)).toBe(10n);
  });
});

describe("crearMontoExacto", () => {
  it("reduce la fracción y exige denominador positivo", () => {
    const m = crearMontoExacto(ARS, 6n, 4n);
    expect([m.numerador, m.denominador]).toEqual([3n, 2n]);
    const negativo = crearMontoExacto(ARS, -6n, 4n);
    expect([negativo.numerador, negativo.denominador]).toEqual([-3n, 2n]);
    expect(() => crearMontoExacto(ARS, 1n, 0n)).toThrow(RangeError);
    expect(() => crearMontoExacto(ARS, 1n, -1n)).toThrow(/denominador debe ser positivo/);
  });

  it("el cero se guarda como 0/1", () => {
    const m = crearMontoExacto(ARS, 0n, 7n);
    expect([m.numerador, m.denominador]).toEqual([0n, 1n]);
  });
});

describe("rangos de los constructores internos", () => {
  it("importe: ±(10^18 − 1); precio unitario: 0 a 10^18 − 1", () => {
    const maximo = 10n ** 18n - 1n;
    expect(crearImporte(ARS, maximo).unidades).toBe(maximo);
    expect(crearImporte(ARS, -maximo).unidades).toBe(-maximo);
    expect(() => crearImporte(ARS, maximo + 1n)).toThrow(/importe/);
    expect(() => crearImporte(ARS, -maximo - 1n)).toThrow(/importe/);
    expect(crearPrecioUnitario(maximo).unidades).toBe(maximo);
    expect(() => crearPrecioUnitario(maximo + 1n)).toThrow(/precio unitario/);
    expect(() => crearPrecioUnitario(-1n)).toThrow(/precio unitario/);
  });
});
