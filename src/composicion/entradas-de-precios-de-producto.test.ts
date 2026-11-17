import { describe, expect, it } from "vitest";
import { leerElPedidoDePrecio } from "./entradas-de-precios-de-producto";

const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const CLAVE = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const VISTO = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a";
const PEDIDO = { productoId: ID, precioId: CLAVE, precioIdEsperado: VISTO, precio: "13000.00" };

describe("leerElPedidoDePrecio", () => {
  it("lee las cuatro cosas del pedido y el importe sigue siendo texto", () => {
    expect(leerElPedidoDePrecio(PEDIDO)).toEqual({ ok: true, valor: PEDIDO });
  });

  it("la fila vista puede ser null (el producto no tenía precio)", () => {
    expect(leerElPedidoDePrecio({ ...PEDIDO, precioIdEsperado: null })).toEqual({
      ok: true,
      valor: { ...PEDIDO, precioIdEsperado: null },
    });
  });

  it("un precio que no es un precio válido igual pasa: lo rechaza la primitiva dentro del caso de uso", () => {
    expect(leerElPedidoDePrecio({ ...PEDIDO, precio: "" })).toMatchObject({ ok: true });
    expect(leerElPedidoDePrecio({ ...PEDIDO, precio: "abc" })).toMatchObject({ ok: true });
  });

  it("descarta lo que el pedido no declara: la empresa, la sucursal, la opción y la persona no se pueden mandar", () => {
    const r = leerElPedidoDePrecio({
      ...PEDIDO,
      empresaId: "otra",
      sucursalId: ID,
      opcionId: ID,
      personaId: "x",
    });
    expect(r).toEqual({ ok: true, valor: PEDIDO });
  });

  it.each([
    ["sin producto", { ...PEDIDO, productoId: undefined }],
    ["producto que no es un id", { ...PEDIDO, productoId: "no-es-un-id" }],
    ["sin clave del cambio", { ...PEDIDO, precioId: undefined }],
    ["clave que no es un id", { ...PEDIDO, precioId: "1" }],
    ["fila vista que no es un id", { ...PEDIDO, precioIdEsperado: "x" }],
    ["fila vista ausente", { ...PEDIDO, precioIdEsperado: undefined }],
    ["precio que no es texto", { ...PEDIDO, precio: 13000 }],
    ["precio sin fin", { ...PEDIDO, precio: "1".repeat(41) }],
    ["nada", null],
    ["un texto", "x"],
  ])("%s: PEDIDO_INVALIDO, sin decir cuál campo", (_caso, pedido) => {
    expect(leerElPedidoDePrecio(pedido)).toEqual({ ok: false, error: "PEDIDO_INVALIDO" });
  });

  it("40 caracteres de precio todavía es la forma pedida", () => {
    expect(leerElPedidoDePrecio({ ...PEDIDO, precio: "1".repeat(40) })).toMatchObject({
      ok: true,
    });
  });
});
