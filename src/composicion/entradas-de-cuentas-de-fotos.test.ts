import { describe, expect, it } from "vitest";
import {
  leerElPedidoDeDeclararLaCuentaDeFotos,
  leerElPedidoDeRetirarLaCuentaDeFotos,
} from "./entradas-de-cuentas-de-fotos";

const CLAVE = "5c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const ID = "9d8c7b6a-5f4e-4d3c-8b2a-1a0b9c8d7e6f";

describe("el pedido de declarar la cuenta", () => {
  it("lee la clave del gesto y la cuenta, y descarta todo lo demás (empresa, persona, proveedor, estado)", () => {
    const r = leerElPedidoDeDeclararLaCuentaDeFotos({
      claveDeIdempotencia: CLAVE,
      cuenta: "mi-hotel",
      empresaId: "otra",
      personaId: "otra",
      proveedor: "IMAGEKIT",
      estado: "RETIRADA",
    });
    expect(r).toEqual({ ok: true, valor: { claveDeIdempotencia: CLAVE, cuenta: "mi-hotel" } });
  });

  it.each([
    ["sin clave", { cuenta: "x" }],
    ["sin cuenta", { claveDeIdempotencia: CLAVE }],
    ["cuenta que no es texto", { claveDeIdempotencia: CLAVE, cuenta: 7 }],
    ["clave que no es texto", { claveDeIdempotencia: 7, cuenta: "x" }],
    ["nada", undefined],
    ["un texto", "cuenta"],
  ])("%s es PEDIDO_INVALIDO", (_nombre, crudo) => {
    expect(leerElPedidoDeDeclararLaCuentaDeFotos(crudo)).toEqual({
      ok: false,
      error: "PEDIDO_INVALIDO",
    });
  });
});

describe("el pedido de retirar la cuenta", () => {
  it("lee la cuenta, la versión que se vio y el motivo, y descarta lo demás", () => {
    const r = leerElPedidoDeRetirarLaCuentaDeFotos({
      id: ID,
      versionEsperada: 2,
      motivo: "Cerramos la cuenta",
      empresaId: "otra",
    });
    expect(r).toEqual({
      ok: true,
      valor: { id: ID, versionEsperada: 2, motivo: "Cerramos la cuenta" },
    });
  });

  it.each([
    ["sin id", { versionEsperada: 1, motivo: "x" }],
    ["sin versión", { id: ID, motivo: "x" }],
    ["versión con decimales", { id: ID, versionEsperada: 1.5, motivo: "x" }],
    ["versión con texto no numérico", { id: ID, versionEsperada: "1e3", motivo: "x" }],
    ["sin motivo", { id: ID, versionEsperada: 1 }],
  ])("%s es PEDIDO_INVALIDO", (_nombre, crudo) => {
    expect(leerElPedidoDeRetirarLaCuentaDeFotos(crudo)).toEqual({
      ok: false,
      error: "PEDIDO_INVALIDO",
    });
  });
});
