import { describe, expect, it } from "vitest";
import {
  MAXIMO_DE_PRODUCTOS_A_MOSTRAR,
  leerElPedidoDeMostrar,
  leerElPedidoDeOcultar,
} from "./entradas-de-ocultar";

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

describe("leerElPedidoDeMostrar", () => {
  it("acepta uno o varios ids y saca los repetidos", () => {
    expect(leerElPedidoDeMostrar({ productoIds: [ID] })).toEqual({
      ok: true,
      valor: { productoIds: [ID] },
    });
    expect(leerElPedidoDeMostrar({ productoIds: [ID, ID] })).toEqual({
      ok: true,
      valor: { productoIds: [ID] },
    });
  });

  it("acepta hasta el tope y rechaza uno más", () => {
    const id = (n: number) => `0b9f6a1e-2c3d-4e5f-8a7b-${String(n).padStart(12, "0")}`;
    const ids = (n: number) => Array.from({ length: n }, (_, i) => id(i));
    expect(leerElPedidoDeMostrar({ productoIds: ids(MAXIMO_DE_PRODUCTOS_A_MOSTRAR) }).ok).toBe(
      true,
    );
    expect(leerElPedidoDeMostrar({ productoIds: ids(MAXIMO_DE_PRODUCTOS_A_MOSTRAR + 1) }).ok).toBe(
      false,
    );
  });

  it.each([
    ["lista vacía", { productoIds: [] }],
    ["un id que no es un id", { productoIds: ["x"] }],
    ["sin la clave", {}],
    ["una clave de más (el alcance no viaja)", { productoIds: [ID], alcance: "EMPRESA" }],
    ["ids como texto", { productoIds: ID }],
    ["no es un objeto", "hola"],
  ])("rechaza: %s", (_nombre, crudo) => {
    expect(leerElPedidoDeMostrar(crudo)).toEqual({ ok: false, error: "PEDIDO_INVALIDO" });
  });
});
