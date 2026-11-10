import { describe, expect, it } from "vitest";
import { cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import { precioUnitarioDesdeTexto } from "../../../primitivas/dinero/precio-unitario";
import {
  esMultiploDelPaso,
  formaDeVentaDelPiloto,
  leerCantidad,
  precioEnOtraUnidad,
  validarFormaDeVenta,
} from "./forma-de-venta";

const c = (t: string) => cantidadDesdeTexto(t);

describe("forma de venta (162, 166)", () => {
  it("valida unidad, dimensión y paso", () => {
    expect(validarFormaDeVenta("UNIDAD", "UNIDAD", "1")).toMatchObject({ ok: true });
    expect(validarFormaDeVenta("UNIDAD", "KILOGRAMO", "1")).toEqual({
      ok: false,
      error: "DIMENSION_DISTINTA",
    });
    expect(validarFormaDeVenta("UNIDAD", "CAJA", "1")).toEqual({
      ok: false,
      error: "UNIDAD_INVALIDA",
    });
    expect(validarFormaDeVenta("CAJA", "UNIDAD", "1")).toEqual({
      ok: false,
      error: "UNIDAD_INVALIDA",
    });
    for (const paso of ["0", "-1", "abc", "0.00001", "", "1,5"]) {
      expect(validarFormaDeVenta("UNIDAD", "UNIDAD", paso), paso).toEqual({
        ok: false,
        error: "PASO_INVALIDO",
      });
    }
  });
  it("el paso tiene que llevarse exacto a la unidad base en 4 decimales (la misma regla que la base)", () => {
    expect(validarFormaDeVenta("GRAMO", "KILOGRAMO", "0.5")).toMatchObject({ ok: true });
    expect(validarFormaDeVenta("KILOGRAMO", "GRAMO", "1")).toMatchObject({ ok: true });
    expect(validarFormaDeVenta("KILOGRAMO", "GRAMO", "0.25")).toEqual({
      ok: false,
      error: "CONVERSION_NO_EXACTA",
    });
  });
  it("D8: con paso 0,5 pasa 1,5 y no 1,25; con paso 1 no pasa 0,5", () => {
    expect(esMultiploDelPaso(c("1.5"), c("0.5"))).toBe(true);
    expect(esMultiploDelPaso(c("1.25"), c("0.5"))).toBe(false);
    expect(esMultiploDelPaso(c("0.5"), c("1"))).toBe(false);
    expect(esMultiploDelPaso(c("3"), c("1"))).toBe(true);
    expect(esMultiploDelPaso(c("3"), c("0"))).toBe(false);
  });
  it("el piloto solo vende en la unidad base con paso 1", () => {
    const forma = (u: string, p: string) => {
      const r = validarFormaDeVenta("GRAMO", u, p);
      if (!r.ok) throw new Error("forma inválida de prueba");
      return r.valor;
    };
    expect(formaDeVentaDelPiloto("GRAMO", forma("GRAMO", "1"))).toBe(true);
    expect(formaDeVentaDelPiloto("GRAMO", forma("GRAMO", "0.5"))).toBe(false);
    expect(formaDeVentaDelPiloto("GRAMO", forma("KILOGRAMO", "1"))).toBe(false);
  });
  it("leerCantidad no lanza", () => {
    expect(leerCantidad("x")).toBeNull();
    expect(leerCantidad("1.5")).not.toBeNull();
  });
  it("cambiar de unidad: kilo → gramo convierte exacto o devuelve nulo (precio abierto, 169)", () => {
    const p = precioUnitarioDesdeTexto;
    expect(precioEnOtraUnidad(p("3000"), "KILOGRAMO", "GRAMO")).toEqual(p("3"));
    expect(precioEnOtraUnidad(p("3.333333"), "KILOGRAMO", "GRAMO")).toBeNull();
    expect(precioEnOtraUnidad(p("3"), "GRAMO", "KILOGRAMO")).toEqual(p("3000"));
  });
});
