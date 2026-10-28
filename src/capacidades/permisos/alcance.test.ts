import { describe, expect, it } from "vitest";
import { sucursalId } from "../../primitivas/identificadores/marca";
import { exigirSucursal, resolverSucursal, sucursalesEnAlcance } from "./alcance";

const A = sucursalId("sucursal-a");
const B = sucursalId("sucursal-b");
const C = sucursalId("sucursal-c");

describe("exigirSucursal", () => {
  it('"TODAS" deja pasar cualquier sucursal', () => {
    expect(exigirSucursal("TODAS", A)).toEqual({ ok: true, valor: null });
  });

  it("una lista deja pasar la sucursal que contiene, entre otras", () => {
    expect(exigirSucursal([A], A)).toEqual({ ok: true, valor: null });
    expect(exigirSucursal([B, A], A)).toEqual({ ok: true, valor: null });
  });

  it("una sucursal que la lista no contiene da SUCURSAL_FUERA_DE_ALCANCE", () => {
    expect(exigirSucursal([B], A)).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
  });

  it("un operador sin asignaciones (lista vacía) no opera en ninguna sucursal", () => {
    expect(exigirSucursal([], A)).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
  });

  it("no confunde un identificador con otro que lo contiene o es un prefijo", () => {
    expect(exigirSucursal([sucursalId("sucursal-a2")], A).ok).toBe(false);
    expect(exigirSucursal([sucursalId("sucursal-")], A).ok).toBe(false);
  });
});

describe("sucursalesEnAlcance", () => {
  const activas = [{ id: A }, { id: B }, { id: C }];

  it('"TODAS" deja elegir todas las activas, en su orden', () => {
    expect(sucursalesEnAlcance("TODAS", activas)).toEqual(activas);
  });

  it("una lista deja elegir solo las activas que contiene", () => {
    expect(sucursalesEnAlcance([C, A], activas)).toEqual([{ id: A }, { id: C }]);
  });

  it("una sucursal de la lista que no está entre las activas no se ofrece", () => {
    expect(sucursalesEnAlcance([A, sucursalId("sucursal-apagada")], activas)).toEqual([{ id: A }]);
  });

  it("sin asignaciones o sin sucursales activas no hay nada para elegir", () => {
    expect(sucursalesEnAlcance([], activas)).toEqual([]);
    expect(sucursalesEnAlcance("TODAS", [])).toEqual([]);
  });

  it("conserva el resto de los datos de cada sucursal (el nombre)", () => {
    expect(sucursalesEnAlcance([A], [{ id: A, nombre: "Centro" }])).toEqual([
      { id: A, nombre: "Centro" },
    ]);
  });
});

describe("resolverSucursal", () => {
  it("elegió una de las elegibles: esa, con una o con varias", () => {
    expect(resolverSucursal(A, [A])).toEqual({ ok: true, valor: A });
    expect(resolverSucursal(B, [A, B, C])).toEqual({ ok: true, valor: B });
  });

  it("elegió una que no está entre las elegibles: fuera de alcance, también con una sola elegible", () => {
    expect(resolverSucursal(C, [A, B])).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
    expect(resolverSucursal(C, [A])).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
  });

  it("elegió y no tiene ninguna elegible: fuera de alcance", () => {
    expect(resolverSucursal(A, [])).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
  });

  it("no eligió y tiene exactamente una: la toma sola", () => {
    expect(resolverSucursal(null, [B])).toEqual({ ok: true, valor: B });
  });

  it("no eligió y tiene varias: SUCURSAL_NO_ELEGIDA, nunca todas ni la primera", () => {
    expect(resolverSucursal(null, [A, B])).toEqual({ ok: false, error: "SUCURSAL_NO_ELEGIDA" });
    expect(resolverSucursal(null, [A, B, C])).toEqual({ ok: false, error: "SUCURSAL_NO_ELEGIDA" });
  });

  it("no eligió y no tiene ninguna: fuera de alcance (como un operador sin asignaciones)", () => {
    expect(resolverSucursal(null, [])).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
  });
});
