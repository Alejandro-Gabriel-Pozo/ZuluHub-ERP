import { describe, expect, it } from "vitest";
import { leerElPedidoDeOcultar } from "./entradas-de-ocultar";

const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";

describe("leerElPedidoDeOcultar", () => {
  it.each([
    ["LOCAL", true],
    ["LOCAL", false],
    ["EMPRESA", true],
    ["EMPRESA", false],
  ] as const)("acepta el alcance %s con oculto=%s", (alcance, oculto) => {
    expect(leerElPedidoDeOcultar({ productoId: ID, alcance, oculto })).toEqual({
      ok: true,
      valor: { productoId: ID, alcance, oculto },
    });
  });

  it.each([
    ["sin producto", { alcance: "LOCAL", oculto: true }],
    ["producto que no es un id", { productoId: "x", alcance: "LOCAL", oculto: true }],
    ["alcance fuera del conjunto", { productoId: ID, alcance: "TODAS", oculto: true }],
    ["alcance en minúscula", { productoId: ID, alcance: "local", oculto: true }],
    ["oculto como texto", { productoId: ID, alcance: "LOCAL", oculto: "true" }],
    ["sin oculto (no se alterna)", { productoId: ID, alcance: "LOCAL" }],
    [
      "una clave de más (el local no viaja en el pedido)",
      { productoId: ID, alcance: "LOCAL", oculto: true, sucursalId: ID },
    ],
    ["no es un objeto", "hola"],
    ["nulo", null],
  ])("rechaza: %s", (_caso, crudo) => {
    expect(leerElPedidoDeOcultar(crudo)).toEqual({ ok: false, error: "PEDIDO_INVALIDO" });
  });
});
