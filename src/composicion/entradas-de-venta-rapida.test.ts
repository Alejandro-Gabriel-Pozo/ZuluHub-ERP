import { describe, expect, it } from "vitest";
import {
  MAXIMO_DE_LINEAS_DEL_CARRITO,
  MAXIMO_DE_OPCIONES_POR_LINEA,
  entradaDeCotizarElCarrito,
} from "./entradas-de-venta-rapida";

const ID = "0b0b0b0b-1111-4222-8333-444444444444";
const OTRO = "1c1c1c1c-2222-4333-8444-555555555555";
const linea = { productoId: ID, opcionIds: [], cantidad: "1" };

describe("entradaDeCotizarElCarrito: la frontera del carrito", () => {
  it("toma solo lo que el esquema declara: la empresa, la sucursal y un precio que manda el navegador se descartan", () => {
    const r = entradaDeCotizarElCarrito({
      empresaId: OTRO,
      sucursalId: OTRO,
      total: "1",
      lineas: [{ ...linea, precioUnitario: "1", empresaId: OTRO, varianteId: OTRO }],
    });
    expect(r).toEqual({
      ok: true,
      valor: { lineas: [{ productoId: ID, opcionIds: [], cantidad: "1", varianteId: OTRO }] },
    });
  });

  it("acepta un carrito vacío y la cantidad como texto decimal", () => {
    expect(entradaDeCotizarElCarrito({ lineas: [] }).ok).toBe(true);
    expect(entradaDeCotizarElCarrito({ lineas: [{ ...linea, cantidad: "0.25" }] }).ok).toBe(true);
  });

  it.each([
    ["sin lista", {}],
    ["lista que no es lista", { lineas: "x" }],
    ["null", null],
    ["producto que no es un uuid", { lineas: [{ ...linea, productoId: "no-uuid" }] }],
    ["opción que no es un uuid", { lineas: [{ ...linea, opcionIds: ["x"] }] }],
    ["cantidad como número", { lineas: [{ ...linea, cantidad: 1 }] }],
    ["cantidad enorme", { lineas: [{ ...linea, cantidad: "1".repeat(41) }] }],
    ["sin cantidad", { lineas: [{ productoId: ID, opcionIds: [] }] }],
    ["variante que no es un uuid", { lineas: [{ ...linea, varianteId: "x" }] }],
    ["precio abierto como número", { lineas: [{ ...linea, precioAbierto: 5 }] }],
  ])("falla cerrado: %s", (_nombre, crudo) => {
    expect(entradaDeCotizarElCarrito(crudo).ok).toBe(false);
  });

  it("los topes de forma cierran: más líneas u opciones que el tope", () => {
    const lineas = Array.from({ length: MAXIMO_DE_LINEAS_DEL_CARRITO + 1 }, () => linea);
    expect(entradaDeCotizarElCarrito({ lineas }).ok).toBe(false);
    expect(
      entradaDeCotizarElCarrito({ lineas: lineas.slice(0, MAXIMO_DE_LINEAS_DEL_CARRITO) }).ok,
    ).toBe(true);
    const opciones = Array.from({ length: MAXIMO_DE_OPCIONES_POR_LINEA + 1 }, () => OTRO);
    expect(entradaDeCotizarElCarrito({ lineas: [{ ...linea, opcionIds: opciones }] }).ok).toBe(
      false,
    );
  });
});
