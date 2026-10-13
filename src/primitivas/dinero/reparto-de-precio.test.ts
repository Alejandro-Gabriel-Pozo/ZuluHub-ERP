import { describe, expect, it } from "vitest";
import { ErrorDeValor } from "../cantidad/errores";
import { crearMontoExacto } from "./interno";
import { ARS } from "./moneda";
import { importeDesdeTexto } from "./importe";
import { exactoDeImporte } from "./monto-exacto";
import { precioUnitarioATexto, precioUnitarioDesdeTexto } from "./precio-unitario";
import { repartirPrecioUnitario } from "./prorrateo";

const pesos = (...textos: string[]) =>
  textos.map((t) => exactoDeImporte(importeDesdeTexto(ARS, t)));
const reparto = (total: string, ...p: string[]) =>
  repartirPrecioUnitario(precioUnitarioDesdeTexto(total), pesos(...p)).map(precioUnitarioATexto);

function errorDe(accion: () => unknown): ErrorDeValor {
  try {
    accion();
  } catch (e) {
    if (e instanceof ErrorDeValor) return e;
    throw e;
  }
  throw new Error("se esperaba un ErrorDeValor");
}

describe("repartirPrecioUnitario", () => {
  it("el ejemplo del combo «Desayuno»: 4.000 entre 3.300 y 1.600 → 2.693,877551 y 1.306,122449", () => {
    expect(reparto("4000", "3300", "1600")).toEqual(["2693.877551", "1306.122449"]);
  });

  it("80,60 entre tres pesos iguales: el micro-peso sobrante lo gana el primero", () => {
    expect(reparto("80.600000", "1", "1", "1")).toEqual(["26.866667", "26.866667", "26.866666"]);
    expect(reparto("0.000002", "1", "1", "1")).toEqual(["0.000001", "0.000001", "0.000000"]);
  });

  it("el sobrante va al mayor resto, no al mayor peso ni al primero", () => {
    // 1 micro-peso entre 1/3 y 2/3: partes exactas 0,33 y 0,67 → todo el sobrante al segundo.
    expect(reparto("0.000001", "1", "2")).toEqual(["0.000000", "0.000001"]);
    expect(reparto("0.000001", "2", "1")).toEqual(["0.000001", "0.000000"]);
    // 1,000000 entre 5/6 y 1/6: 833333,33 y 166666,67 micro-pesos → 833333 y 166667.
    expect(reparto("1", "5", "1")).toEqual(["0.833333", "0.166667"]);
    expect(reparto("1", "1", "5")).toEqual(["0.166667", "0.833333"]);
  });

  it("varios sobrantes: a los restos mayores y, a igual resto, al que está primero", () => {
    // 100 micro-pesos entre 1, 1, 1, 1 y 3 (suma 7): pisos 14 ×4 y 42 (98); restos 2 ×4 y 6.
    expect(reparto("0.000100", "1", "1", "1", "1", "3")).toEqual([
      "0.000015",
      "0.000014",
      "0.000014",
      "0.000014",
      "0.000043",
    ]);
    expect(reparto("0.000005", "1", "1", "1", "1")).toEqual([
      "0.000002",
      "0.000001",
      "0.000001",
      "0.000001",
    ]);
    expect(reparto("0.000002", "1", "1", "1", "1")).toEqual([
      "0.000001",
      "0.000001",
      "0.000000",
      "0.000000",
    ]);
  });

  it("con un solo peso devuelve el total", () => {
    expect(reparto("12.345678", "5")).toEqual(["12.345678"]);
  });

  it("un peso en cero no recibe nada si hay otros", () => {
    expect(reparto("10", "0", "3", "0")).toEqual(["0.000000", "10.000000", "0.000000"]);
  });

  it("total cero devuelve ceros, aunque los pesos sean cero o no haya pesos", () => {
    expect(reparto("0", "0", "0")).toEqual(["0.000000", "0.000000"]);
    expect(reparto("0", "2", "3")).toEqual(["0.000000", "0.000000"]);
    expect(reparto("0")).toEqual([]);
  });

  it("acepta pesos fraccionarios (montos exactos intermedios)", () => {
    const tercio = crearMontoExacto(ARS, 1n, 3n);
    const sexto = crearMontoExacto(ARS, 1n, 6n);
    // 1/3 : 1/6 = 2 : 1.
    expect(
      repartirPrecioUnitario(precioUnitarioDesdeTexto("1"), [tercio, sexto]).map(
        precioUnitarioATexto,
      ),
    ).toEqual(["0.666667", "0.333333"]);
  });

  it("PESOS_INVALIDOS: pesos que no suman o lista vacía con total distinto de cero", () => {
    expect(errorDe(() => reparto("1", "0", "0")).codigo).toBe("PESOS_INVALIDOS");
    expect(errorDe(() => reparto("1")).codigo).toBe("PESOS_INVALIDOS");
    expect(errorDe(() => reparto("1", "-1", "2")).codigo).toBe("PESOS_INVALIDOS");
  });

  it("los mensajes de error dicen qué pasó", () => {
    expect(errorDe(() => reparto("1", "-1", "2")).message).toBe(
      "PESOS_INVALIDOS: reparto de precio: peso negativo",
    );
    expect(errorDe(() => reparto("1", "0", "0")).message).toBe(
      "PESOS_INVALIDOS: reparto de precio: los pesos no suman nada",
    );
  });

  it("MONEDA_DISTINTA: pesos de monedas distintas entre sí", () => {
    const otra = {
      ...exactoDeImporte(importeDesdeTexto(ARS, "1")),
      moneda: "USD",
    } as unknown as ReturnType<typeof exactoDeImporte>;
    const e = errorDe(() =>
      repartirPrecioUnitario(precioUnitarioDesdeTexto("1"), [...pesos("1"), otra]),
    );
    expect(e.codigo).toBe("MONEDA_DISTINTA");
    expect(e.message).toBe("MONEDA_DISTINTA: reparto de precio: pesos en monedas distintas");
  });

  it("las partes son inmutables y no comparten el total", () => {
    const partes = repartirPrecioUnitario(precioUnitarioDesdeTexto("1"), pesos("1", "1"));
    expect(partes.every((p) => Object.isFrozen(p))).toBe(true);
  });
});
