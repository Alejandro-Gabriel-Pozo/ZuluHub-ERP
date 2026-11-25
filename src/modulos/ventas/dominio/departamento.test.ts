import { describe, expect, it } from "vitest";
import { departamentoDeLaCuenta, type NodoParaElegir } from "./departamento";

const dep = (id: string, activo = true): NodoParaElegir => ({ id, padreId: null, activo });
const hijo = (id: string, padreId: string, activo = true): NodoParaElegir => ({
  id,
  padreId,
  activo,
});

describe("departamento de una cuenta nueva", () => {
  it("se pidió uno que existe y está activo: ese", () => {
    expect(departamentoDeLaCuenta([dep("a"), dep("b")], "b")).toEqual({ ok: true, valor: "b" });
  });
  it("se pidió uno que no existe: no encontrado, aunque haya otros", () => {
    expect(departamentoDeLaCuenta([dep("a")], "z")).toEqual({
      ok: false,
      error: "DEPARTAMENTO_NO_ENCONTRADO",
    });
    expect(departamentoDeLaCuenta([], "z")).toEqual({
      ok: false,
      error: "DEPARTAMENTO_NO_ENCONTRADO",
    });
  });
  it("se pidió uno desactivado: inactivo", () => {
    expect(departamentoDeLaCuenta([dep("a"), dep("b", false)], "b")).toEqual({
      ok: false,
      error: "DEPARTAMENTO_INACTIVO",
    });
  });
  it("un nodo que no es de primer nivel no es un departamento", () => {
    expect(departamentoDeLaCuenta([dep("a"), hijo("c", "a")], "c")).toEqual({
      ok: false,
      error: "DEPARTAMENTO_NO_ENCONTRADO",
    });
  });
  it("no se pidió y no hay departamentos activos: sin departamento (null)", () => {
    expect(departamentoDeLaCuenta([], undefined)).toEqual({ ok: true, valor: null });
    expect(departamentoDeLaCuenta([dep("a", false)], undefined)).toEqual({
      ok: true,
      valor: null,
    });
    // las categorías no cuentan como departamentos
    expect(departamentoDeLaCuenta([hijo("c", "a")], undefined)).toEqual({ ok: true, valor: null });
  });
  it("no se pidió y hay uno, dos o tres activos: sin departamento; nunca «todos» ni el primero, y sin error", () => {
    const sinPedir = (nodos: readonly NodoParaElegir[]) => departamentoDeLaCuenta(nodos, undefined);
    expect(sinPedir([dep("a", false), dep("b"), hijo("c", "b")])).toEqual({
      ok: true,
      valor: null,
    });
    expect(sinPedir([dep("a"), dep("b")])).toEqual({ ok: true, valor: null });
    expect(sinPedir([dep("a"), dep("b"), dep("c"), hijo("d", "a")])).toEqual({
      ok: true,
      valor: null,
    });
    expect(sinPedir([dep("a"), dep("b"), dep("c", false)])).toEqual({ ok: true, valor: null });
  });
  it("con dos o tres activos, pedir uno lo valida igual: el pedido es de ese y no se mezcla con otro", () => {
    const tres = [dep("a"), dep("b"), dep("c")];
    expect(departamentoDeLaCuenta(tres, "a")).toEqual({ ok: true, valor: "a" });
    expect(departamentoDeLaCuenta(tres, "c")).toEqual({ ok: true, valor: "c" });
    expect(departamentoDeLaCuenta([dep("a"), dep("b", false)], "b")).toEqual({
      ok: false,
      error: "DEPARTAMENTO_INACTIVO",
    });
  });
});
