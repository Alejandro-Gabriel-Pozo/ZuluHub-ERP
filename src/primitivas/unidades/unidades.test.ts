import { describe, expect, it } from "vitest";
import { cantidadATexto, cantidadDesdeTexto } from "../cantidad/cantidad";
import { UNIDADES, type CodigoDeUnidad } from "./unidades";

const CODIGOS = Object.keys(UNIDADES) as CodigoDeUnidad[];

describe("UNIDADES", () => {
  it("tiene las 14 unidades fijadas por la especificación, incluidas unidad, gramo y kilogramo", () => {
    expect([...CODIGOS].sort()).toEqual(
      [
        "UNIDAD",
        "GRAMO",
        "KILOGRAMO",
        "TONELADA",
        "MILILITRO",
        "LITRO",
        "METRO_CUBICO",
        "MILIMETRO",
        "CENTIMETRO",
        "METRO",
        "CENTIMETRO_CUADRADO",
        "METRO_CUADRADO",
        "MINUTO",
        "HORA",
      ].sort(),
    );
  });

  it("los factores son enteros positivos y cada dimensión tiene una sola base (factor 1)", () => {
    const basesPorDimension = new Map<string, number>();
    for (const codigo of CODIGOS) {
      const { dimension, factor } = UNIDADES[codigo];
      expect(typeof factor).toBe("bigint");
      expect(factor > 0n).toBe(true);
      if (factor === 1n) basesPorDimension.set(dimension, (basesPorDimension.get(dimension) ?? 0) + 1);
    }
    const dimensiones = new Set(CODIGOS.map((c) => UNIDADES[c].dimension));
    expect(dimensiones.size).toBe(6);
    for (const dimension of dimensiones) expect(basesPorDimension.get(dimension), dimension).toBe(1);
  });

  it("los valores concretos de cada dimensión", () => {
    expect(UNIDADES.KILOGRAMO).toEqual({ dimension: "MASA", factor: 1000n });
    expect(UNIDADES.TONELADA.factor).toBe(1_000_000n);
    expect(UNIDADES.LITRO).toEqual({ dimension: "VOLUMEN", factor: 1000n });
    expect(UNIDADES.METRO_CUBICO.factor).toBe(1_000_000n);
    expect(UNIDADES.CENTIMETRO.factor).toBe(10n);
    expect(UNIDADES.METRO.factor).toBe(1000n);
    expect(UNIDADES.METRO_CUADRADO).toEqual({ dimension: "SUPERFICIE", factor: 10_000n });
    expect(UNIDADES.HORA).toEqual({ dimension: "TIEMPO", factor: 60n });
    expect(UNIDADES.UNIDAD).toEqual({ dimension: "CONTEO", factor: 1n });
  });

  it("la escala que usa la conversión es la de la cantidad: 1 unidad mínima = 0.0001", () => {
    expect(cantidadATexto(cantidadDesdeTexto("0.0001"))).toBe("0.0001");
    expect(cantidadDesdeTexto("0.0001").unidades).toBe(1n);
  });
});
