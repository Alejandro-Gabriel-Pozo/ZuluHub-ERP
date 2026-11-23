import { describe, expect, it } from "vitest";
import { ErrorDeValor } from "../cantidad/errores";
import { importeATexto, importeDesdeTexto } from "./importe";
import { ARS } from "./moneda";
import { exactoDeImporte } from "./monto-exacto";
import { prorratear, prorratearConSobranteAlPrimero } from "./prorrateo";

const ars = (t: string) => importeDesdeTexto(ARS, t);
const pesos = (...textos: string[]) => textos.map((t) => exactoDeImporte(ars(t)));
const textos = (total: string, ...p: string[]) =>
  prorratear(ars(total), pesos(...p)).map(importeATexto);

function codigoDe(accion: () => unknown): string | undefined {
  try {
    accion();
  } catch (e) {
    if (e instanceof ErrorDeValor) return e.codigo;
    throw e;
  }
  return undefined;
}

describe("prorratear", () => {
  it("E1: 80,60 entre tres pesos iguales → 26,87 / 26,87 / 26,86 (el empate lo gana el orden)", () => {
    expect(textos("80.60", "1", "1", "1")).toEqual(["26.87", "26.87", "26.86"]);
  });

  it("reparte el resto al mayor resto, no al primero", () => {
    // 1,00 entre 1/3 y 2/3: partes exactas 33,33 y 66,67 centavos → 0,33 y 0,67.
    expect(textos("1.00", "1", "2")).toEqual(["0.33", "0.67"]);
  });

  it("el centavo sobrante va al mayor resto, no al mayor peso", () => {
    // 1,00 entre 5/6 y 1/6: partes exactas 83,33 y 16,67 centavos → 0,83 y 0,17.
    expect(textos("1.00", "5", "1")).toEqual(["0.83", "0.17"]);
    expect(textos("1.00", "1", "5")).toEqual(["0.17", "0.83"]);
  });

  it("varios sobrantes: van a los restos mayores, y a igual resto al que está primero", () => {
    // 1,00 entre pesos 1, 1, 1, 1 y 3 (suma 7): pisos 14 ×4 y 42 (98 centavos), restos 2 ×4 y 6.
    // Sobran 2: uno al resto 6 (el peso 3) y otro, entre los empatados en 2, al primero.
    expect(textos("1.00", "1", "1", "1", "1", "3")).toEqual([
      "0.15",
      "0.14",
      "0.14",
      "0.14",
      "0.43",
    ]);
    expect(textos("0.05", "1", "1", "1", "1")).toEqual(["0.02", "0.01", "0.01", "0.01"]);
    expect(textos("0.02", "1", "1", "1", "1")).toEqual(["0.01", "0.01", "0.00", "0.00"]);
  });

  it("con un solo peso devuelve el total", () => {
    expect(textos("12.34", "5")).toEqual(["12.34"]);
  });

  it("los pesos en cero no reciben nada si hay otros", () => {
    expect(textos("10.00", "0", "3", "0")).toEqual(["0.00", "10.00", "0.00"]);
  });

  it("total cero devuelve ceros, aunque los pesos sean cero o no haya pesos", () => {
    expect(textos("0.00", "0", "0")).toEqual(["0.00", "0.00"]);
    expect(textos("0.00")).toEqual([]);
  });

  it("PESOS_INVALIDOS: pesos que no suman o lista vacía con total distinto de cero", () => {
    expect(codigoDe(() => textos("1.00", "0", "0"))).toBe("PESOS_INVALIDOS");
    expect(codigoDe(() => textos("1.00"))).toBe("PESOS_INVALIDOS");
    expect(codigoDe(() => textos("1.00", "-1", "2"))).toBe("PESOS_INVALIDOS");
  });

  it("los mensajes de error dicen qué pasó", () => {
    expect(() => textos("-1.00", "1")).toThrow("prorrateo: el total no puede ser negativo");
    expect(() => textos("1.00", "-1", "2")).toThrow("prorrateo: peso negativo");
    expect(() => textos("1.00", "0", "0")).toThrow("prorrateo: los pesos no suman nada");
  });

  it("FUERA_DE_RANGO: total negativo; MONEDA_DISTINTA: peso de otra moneda", () => {
    expect(codigoDe(() => textos("-1.00", "1"))).toBe("FUERA_DE_RANGO");
    const otra = { ...exactoDeImporte(ars("1.00")), moneda: "USD" } as unknown as ReturnType<
      typeof exactoDeImporte
    >;
    expect(codigoDe(() => prorratear(ars("1.00"), [otra]))).toBe("MONEDA_DISTINTA");
  });

  it("acepta pesos fraccionarios (montos exactos intermedios)", () => {
    const m = exactoDeImporte(ars("0.01"));
    expect(prorratear(ars("0.01"), [m, m, m]).map(importeATexto)).toEqual(["0.01", "0.00", "0.00"]);
  });
});

describe("prorratearConSobranteAlPrimero", () => {
  const sobrante = (total: string, ...p: string[]) =>
    prorratearConSobranteAlPrimero(ars(total), pesos(...p)).map(importeATexto);

  it("10,00 entre tres pesos iguales → 3,34 / 3,33 / 3,33 (lo que confirmó el dueño el 21/11)", () => {
    expect(sobrante("10.00", "1", "1", "1")).toEqual(["3.34", "3.33", "3.33"]);
  });

  it("TODO el sobrante va al primero, aunque sea más de un centavo (0,10 entre siete pesos iguales: 0,04 y seis de 0,01)", () => {
    expect(sobrante("0.10", "1", "1", "1", "1", "1", "1", "1")).toEqual([
      "0.04",
      "0.01",
      "0.01",
      "0.01",
      "0.01",
      "0.01",
      "0.01",
    ]);
  });

  it("con pesos desiguales cada parte es el piso de su proporción y el sobrante, al primero (no al mayor resto)", () => {
    // 1,00 en 1:1:1:7 → exactas 0,10 / 0,10 / 0,10 / 0,70: sin sobrante. 0,07 en 5:5:5:1 → pisos 0,02 / 0,02 / 0,02 / 0,00; el centavo que sobra, al primero.
    expect(sobrante("1.00", "1", "1", "1", "7")).toEqual(["0.10", "0.10", "0.10", "0.70"]);
    expect(sobrante("0.07", "5", "5", "5", "1")).toEqual(["0.03", "0.02", "0.02", "0.00"]);
    // 0,05 en 1:9 → pisos 0,00 y 0,04; el centavo que sobra va al primero, no al de mayor resto.
    expect(sobrante("0.05", "1", "9")).toEqual(["0.01", "0.04"]);
  });

  it("el sobrante va al primero con peso POSITIVO (uno con peso cero no recibe nada)", () => {
    expect(sobrante("0.10", "0", "1", "1", "1")).toEqual(["0.00", "0.04", "0.03", "0.03"]);
  });

  it("total cero devuelve ceros; todos los pesos en cero con un total distinto de cero es PESOS_INVALIDOS; un total negativo, FUERA_DE_RANGO", () => {
    expect(sobrante("0.00", "1", "2")).toEqual(["0.00", "0.00"]);
    expect(codigoDe(() => sobrante("1.00", "0", "0"))).toBe("PESOS_INVALIDOS");
    expect(codigoDe(() => sobrante("-1.00", "1"))).toBe("FUERA_DE_RANGO");
    expect(
      codigoDe(() => prorratearConSobranteAlPrimero(ars("1.00"), [exactoDeImporte(ars("-1.00"))])),
    ).toBeDefined();
  });

  it("total cero con todos los pesos en cero (o sin pesos) devuelve ceros, uno por peso", () => {
    expect(sobrante("0.00", "0", "0")).toEqual(["0.00", "0.00"]);
    expect(sobrante("0.00")).toEqual([]);
  });

  it("los mensajes de error dicen qué pasó", () => {
    expect(() => sobrante("-1.00", "1")).toThrow("prorrateo: el total no puede ser negativo");
    expect(() => sobrante("1.00", "0", "0")).toThrow("prorrateo: los pesos no suman nada");
    expect(() => sobrante("1.00")).toThrow("prorrateo: los pesos no suman nada");
    expect(() =>
      prorratearConSobranteAlPrimero(ars("1.00"), [exactoDeImporte(ars("-1.00"))]),
    ).toThrow("prorrateo: peso negativo");
  });

  it("MONEDA_DISTINTA: un peso de otra moneda se rechaza", () => {
    const otra = { ...exactoDeImporte(ars("1.00")), moneda: "USD" } as unknown as ReturnType<
      typeof exactoDeImporte
    >;
    expect(codigoDe(() => prorratearConSobranteAlPrimero(ars("1.00"), [otra]))).toBe(
      "MONEDA_DISTINTA",
    );
  });
});
