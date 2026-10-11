import { describe, expect, it } from "vitest";
import { cantidadATexto, cantidadDesdeTexto } from "./cantidad";
import { ErrorDeValor } from "./errores";
import { formatearDecimalFijo, parsearDecimalFijo } from "./decimal-fijo";
import { porcentajeATexto, porcentajeDesdeTexto } from "./porcentaje";

function codigoDe(accion: () => unknown): string | undefined {
  try {
    accion();
  } catch (e) {
    if (e instanceof ErrorDeValor) return e.codigo;
    throw e;
  }
  return undefined;
}

describe("parsearDecimalFijo", () => {
  it("convierte a unidades mínimas sin pasar por number", () => {
    expect(parsearDecimalFijo("1234.56", 2, "x")).toBe(123456n);
    expect(parsearDecimalFijo("0.05", 2, "x")).toBe(5n);
    expect(parsearDecimalFijo("7", 2, "x")).toBe(700n);
    expect(parsearDecimalFijo("7.5", 2, "x")).toBe(750n);
    expect(parsearDecimalFijo("-0.50", 2, "x")).toBe(-50n);
    expect(parsearDecimalFijo("9007199254740993.01", 2, "x")).toBe(900719925474099301n);
  });

  it.each([
    ["", "FORMATO_INVALIDO"],
    [" 1.00", "FORMATO_INVALIDO"],
    ["1.00 ", "FORMATO_INVALIDO"],
    ["1,00", "FORMATO_INVALIDO"],
    ["1e3", "FORMATO_INVALIDO"],
    ["NaN", "FORMATO_INVALIDO"],
    ["Infinity", "FORMATO_INVALIDO"],
    ["+1.00", "FORMATO_INVALIDO"],
    ["01.00", "FORMATO_INVALIDO"],
    [".5", "FORMATO_INVALIDO"],
    ["5.", "FORMATO_INVALIDO"],
    ["1.00\n", "FORMATO_INVALIDO"],
    ["١٢٣", "FORMATO_INVALIDO"],
    ["-0", "FORMATO_INVALIDO"],
    ["-0.00", "FORMATO_INVALIDO"],
    ["1".repeat(41), "FORMATO_INVALIDO"],
    ["1.005", "DECIMALES_DE_MAS"],
    ["1.000", "DECIMALES_DE_MAS"],
  ])("rechaza %j con %s", (texto, codigo) => {
    expect(codigoDe(() => parsearDecimalFijo(texto, 2, "x"))).toBe(codigo);
  });

  it("acepta un texto de 40 caracteres y rechaza uno de 41", () => {
    expect(codigoDe(() => parsearDecimalFijo("1".repeat(40), 0, "x"))).toBeUndefined();
    expect(codigoDe(() => parsearDecimalFijo("1".repeat(41), 0, "x"))).toBe("FORMATO_INVALIDO");
  });
});

describe("formatearDecimalFijo", () => {
  it.each([
    [0n, 2, "0.00"],
    [5n, 2, "0.05"],
    [100n, 2, "1.00"],
    [123456n, 2, "1234.56"],
    [-50n, 2, "-0.50"],
    [7n, 0, "7"],
    [-7n, 0, "-7"],
    [1n, 6, "0.000001"],
  ])("%s con escala %s → %s", (unidades, escala, texto) => {
    expect(formatearDecimalFijo(unidades, escala)).toBe(texto);
  });
});

describe("cantidad y porcentaje", () => {
  it("ida y vuelta en forma canónica", () => {
    expect(cantidadATexto(cantidadDesdeTexto("3"))).toBe("3.0000");
    expect(cantidadATexto(cantidadDesdeTexto("0.0001"))).toBe("0.0001");
    expect(porcentajeATexto(porcentajeDesdeTexto("10.5"))).toBe("10.5000");
    expect(porcentajeATexto(porcentajeDesdeTexto("100"))).toBe("100.0000");
  });

  it("rechaza lo que está fuera de rango o tiene más escala", () => {
    expect(codigoDe(() => cantidadDesdeTexto("-1"))).toBe("FUERA_DE_RANGO");
    expect(codigoDe(() => cantidadDesdeTexto("0.00001"))).toBe("DECIMALES_DE_MAS");
    expect(codigoDe(() => cantidadDesdeTexto("99999999999999.9999"))).toBeUndefined();
    expect(codigoDe(() => cantidadDesdeTexto("100000000000000.0000"))).toBe("FUERA_DE_RANGO");
    expect(codigoDe(() => porcentajeDesdeTexto("100.0001"))).toBe("FUERA_DE_RANGO");
    expect(codigoDe(() => porcentajeDesdeTexto("-1"))).toBe("FUERA_DE_RANGO");
    expect(codigoDe(() => porcentajeDesdeTexto("10.55555"))).toBe("DECIMALES_DE_MAS");
  });
});
