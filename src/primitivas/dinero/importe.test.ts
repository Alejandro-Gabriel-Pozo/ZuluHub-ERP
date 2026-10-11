import { describe, expect, it } from "vitest";
import { ErrorDeValor } from "../cantidad/errores";
import * as modulo from "./importe";
import {
  importeAJson,
  importeATexto,
  importeCero,
  importeDesdeJson,
  importeDesdeTexto,
  importesIguales,
  restar,
  sumar,
} from "./importe";
import { ARS, decimalesDe, moneda } from "./moneda";

function codigoDe(accion: () => unknown): string | undefined {
  try {
    accion();
  } catch (e) {
    if (e instanceof ErrorDeValor) return e.codigo;
    throw e;
  }
  return undefined;
}

const ars = (texto: string) => importeDesdeTexto(ARS, texto);

describe("moneda", () => {
  it("v1 solo admite ARS, con 2 decimales", () => {
    expect(moneda("ARS")).toBe("ARS");
    expect(decimalesDe(ARS)).toBe(2);
    for (const otra of ["USD", "ars", "", "toString", "__proto__", "constructor"]) {
      expect(codigoDe(() => moneda(otra))).toBe("MONEDA_NO_SOPORTADA");
    }
  });
});

describe("Importe", () => {
  it("se crea desde texto y vuelve a texto en forma canónica", () => {
    expect(importeATexto(ars("1234.56"))).toBe("1234.56");
    expect(importeATexto(ars("7"))).toBe("7.00");
    expect(importeATexto(importeCero(ARS))).toBe("0.00");
  });

  it("rechaza más decimales que la moneda: no redondea en silencio", () => {
    expect(codigoDe(() => ars("10.005"))).toBe("DECIMALES_DE_MAS");
    expect(codigoDe(() => ars("10,50"))).toBe("FORMATO_INVALIDO");
  });

  it("suma y resta exactas", () => {
    expect(importeATexto(sumar(ars("0.10"), ars("0.20")))).toBe("0.30");
    expect(importeATexto(restar(ars("1.00"), ars("0.01")))).toBe("0.99");
    expect(importeATexto(restar(ars("1.00"), ars("1.50")))).toBe("-0.50");
  });

  it("el máximo es el de numeric(18,2) y no se pasa", () => {
    const maximo = ars("9999999999999999.99");
    expect(importeATexto(maximo)).toBe("9999999999999999.99");
    expect(codigoDe(() => ars("10000000000000000.00"))).toBe("FUERA_DE_RANGO");
    expect(codigoDe(() => sumar(maximo, ars("0.01")))).toBe("FUERA_DE_RANGO");
    expect(codigoDe(() => restar(ars("-9999999999999999.99"), ars("0.01")))).toBe("FUERA_DE_RANGO");
  });

  it("compara por moneda y unidades", () => {
    expect(importesIguales(ars("1.00"), ars("1.0"))).toBe(true);
    expect(importesIguales(ars("1.00"), ars("1.01"))).toBe(false);
  });

  it("JSON en la frontera: texto, nunca number", () => {
    expect(importeAJson(ars("1234.56"))).toEqual({ moneda: "ARS", monto: "1234.56" });
    expect(importeATexto(importeDesdeJson({ moneda: "ARS", monto: "1234.56" }))).toBe("1234.56");
    expect(codigoDe(() => importeDesdeJson({ moneda: "USD", monto: "1.00" }))).toBe(
      "MONEDA_NO_SOPORTADA",
    );
    const numerico = { moneda: "ARS", monto: 1234.56 } as unknown as modulo.ImporteJson;
    expect(codigoDe(() => importeDesdeJson(numerico))).toBe("FORMATO_INVALIDO");
    const sinMoneda = { monto: "1.00" } as unknown as modulo.ImporteJson;
    expect(codigoDe(() => importeDesdeJson(sinMoneda))).toBe("FORMATO_INVALIDO");
  });

  it("no existe una operación de negación en la API pública (la NC va en positivo)", () => {
    const nombres = Object.keys(modulo).filter((n) => /neg|opuest|invert/i.test(n));
    expect(nombres).toEqual([]);
  });
});
