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
  const todas = [
    { id: A, activa: true },
    { id: B, activa: false },
    { id: C, activa: true },
  ];

  it('"TODAS" deja elegir todas, abiertas y cerradas, en su orden', () => {
    expect(sucursalesEnAlcance("TODAS", todas)).toEqual(todas);
  });

  it("una lista deja elegir solo las que contiene, también una cerrada (para ver su historial)", () => {
    expect(sucursalesEnAlcance([C, A], todas)).toEqual([todas[0], todas[2]]);
    expect(sucursalesEnAlcance([B], todas)).toEqual([todas[1]]);
  });

  it("una sucursal de la lista que no está entre las de la empresa no se ofrece", () => {
    expect(sucursalesEnAlcance([A, sucursalId("sucursal-ajena")], todas)).toEqual([todas[0]]);
  });

  it("sin asignaciones o sin sucursales no hay nada para elegir", () => {
    expect(sucursalesEnAlcance([], todas)).toEqual([]);
    expect(sucursalesEnAlcance("TODAS", [])).toEqual([]);
  });

  it("conserva el resto de los datos de cada sucursal (el nombre)", () => {
    expect(sucursalesEnAlcance([A], [{ id: A, activa: true, nombre: "Centro" }])).toEqual([
      { id: A, activa: true, nombre: "Centro" },
    ]);
  });
});

describe("resolverSucursal", () => {
  const abierta = (id: typeof A) => ({ id, activa: true });
  const cerrada = (id: typeof A) => ({ id, activa: false });
  const FUERA = { ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" };
  const NO_ELEGIDA = { ok: false, error: "SUCURSAL_NO_ELEGIDA" };

  it("eligió una de las elegibles: esa, abierta o cerrada, con una o con varias", () => {
    expect(resolverSucursal(A, [abierta(A)])).toEqual({ ok: true, valor: A });
    expect(resolverSucursal(B, [abierta(A), abierta(B), abierta(C)])).toEqual({
      ok: true,
      valor: B,
    });
    expect(resolverSucursal(B, [abierta(A), cerrada(B)])).toEqual({ ok: true, valor: B });
    expect(resolverSucursal(B, [cerrada(B)])).toEqual({ ok: true, valor: B });
  });

  it("eligió una que no está entre las elegibles: fuera de alcance, también con una sola abierta", () => {
    expect(resolverSucursal(C, [abierta(A), abierta(B)])).toEqual(FUERA);
    expect(resolverSucursal(C, [abierta(A)])).toEqual(FUERA);
    expect(resolverSucursal(C, [cerrada(A)])).toEqual(FUERA);
  });

  it("eligió y no tiene ninguna elegible: fuera de alcance", () => {
    expect(resolverSucursal(A, [])).toEqual(FUERA);
  });

  it("no eligió y tiene exactamente una ABIERTA: la toma sola, con o sin cerradas", () => {
    expect(resolverSucursal(null, [abierta(B)])).toEqual({ ok: true, valor: B });
    expect(resolverSucursal(null, [cerrada(A), abierta(B), cerrada(C)])).toEqual({
      ok: true,
      valor: B,
    });
  });

  it("no eligió y tiene dos o más abiertas: SUCURSAL_NO_ELEGIDA, nunca todas ni la primera", () => {
    expect(resolverSucursal(null, [abierta(A), abierta(B)])).toEqual(NO_ELEGIDA);
    expect(resolverSucursal(null, [abierta(A), abierta(B), abierta(C)])).toEqual(NO_ELEGIDA);
    expect(resolverSucursal(null, [abierta(A), abierta(B), cerrada(C)])).toEqual(NO_ELEGIDA);
  });

  it("no eligió y solo tiene cerradas: no se toma sola (las cerradas se eligen a mano)", () => {
    expect(resolverSucursal(null, [cerrada(A)])).toEqual(NO_ELEGIDA);
    expect(resolverSucursal(null, [cerrada(A), cerrada(B)])).toEqual(NO_ELEGIDA);
  });

  it("no eligió y no tiene ninguna: fuera de alcance (como un operador sin asignaciones)", () => {
    expect(resolverSucursal(null, [])).toEqual(FUERA);
  });
});
