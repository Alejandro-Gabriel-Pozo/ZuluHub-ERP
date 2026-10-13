import { describe, expect, it } from "vitest";
import { sucursalId } from "../../primitivas/identificadores/marca";
import { exigirSucursal } from "./alcance";

const A = sucursalId("sucursal-a");
const B = sucursalId("sucursal-b");

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
