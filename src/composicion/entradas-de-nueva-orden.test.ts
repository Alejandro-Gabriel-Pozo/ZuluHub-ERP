import { describe, expect, it } from "vitest";
import { entradaDeNuevaOrden } from "./entradas-de-nueva-orden";

const CLAVE = "11111111-1111-4111-8111-111111111111";
const PRODUCTO = "22222222-2222-4222-8222-222222222222";
const BASE = { clave: CLAVE, productoId: PRODUCTO, cantidad: "2.5" };

describe("la entrada de abrir una orden", () => {
  it("la forma completa pasa; sin «confirmar» no se confirma", () => {
    expect(entradaDeNuevaOrden(BASE)).toEqual({
      ok: true,
      valor: { clave: CLAVE, productoId: PRODUCTO, cantidad: "2.5", confirmar: false },
    });
    expect(entradaDeNuevaOrden({ ...BASE, confirmar: "" })).toMatchObject({
      ok: true,
      valor: { confirmar: false },
    });
  });

  it("«Producir igual» es solo confirmar = «1»", () => {
    expect(entradaDeNuevaOrden({ ...BASE, confirmar: "1" })).toMatchObject({
      ok: true,
      valor: { confirmar: true },
    });
    for (const confirmar of ["true", "si", "0", "11", 1, true]) {
      expect(entradaDeNuevaOrden({ ...BASE, confirmar }).ok).toBe(false);
    }
  });

  it("no lee la empresa, la persona, la sucursal, el depósito ni la unidad del pedido: se descartan", () => {
    const r = entradaDeNuevaOrden({
      ...BASE,
      empresaId: "otra",
      personaId: "otra",
      sucursalId: "otra",
      depositoId: "otro",
      unidadId: "kg",
    });
    expect(r).toEqual({
      ok: true,
      valor: { clave: CLAVE, productoId: PRODUCTO, cantidad: "2.5", confirmar: false },
    });
  });

  it.each([
    {},
    null,
    "x",
    { ...BASE, clave: "" },
    { ...BASE, clave: "no-es-un-id" },
    { ...BASE, productoId: "" },
    { ...BASE, productoId: "1; drop table" },
    { ...BASE, cantidad: 2 },
    { ...BASE, cantidad: "1".repeat(41) },
    { clave: CLAVE, productoId: PRODUCTO },
  ])("%j no tiene la forma: dato inválido", (crudo) => {
    expect(entradaDeNuevaOrden(crudo).ok).toBe(false);
  });
});
