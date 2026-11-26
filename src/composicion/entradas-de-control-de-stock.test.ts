import { describe, expect, it } from "vitest";
import { leerElPedidoDeControlDeStock } from "./entradas-de-control-de-stock";

const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";

describe("leerElPedidoDeControlDeStock", () => {
  it.each([true, false])("acepta el estado controlado=%s", (controlado) => {
    expect(leerElPedidoDeControlDeStock({ productoId: ID, controlado })).toEqual({
      ok: true,
      valor: { productoId: ID, controlado },
    });
  });

  it.each([true, false])(
    "acepta confirmarCuentasAbiertas=%s (la confirmación del aviso)",
    (confirmarCuentasAbiertas) => {
      expect(
        leerElPedidoDeControlDeStock({
          productoId: ID,
          controlado: true,
          confirmarCuentasAbiertas,
        }),
      ).toEqual({
        ok: true,
        valor: { productoId: ID, controlado: true, confirmarCuentasAbiertas },
      });
    },
  );

  it.each(["true", 1, null])(
    "rechaza confirmarCuentasAbiertas que no es booleano (%s)",
    (confirmarCuentasAbiertas) => {
      expect(
        leerElPedidoDeControlDeStock({
          productoId: ID,
          controlado: true,
          confirmarCuentasAbiertas,
        }),
      ).toEqual({ ok: false, error: "PEDIDO_INVALIDO" });
    },
  );

  it.each([
    ["sin producto", { controlado: true }],
    ["producto que no es un id", { productoId: "x", controlado: true }],
    ["controlado como texto", { productoId: ID, controlado: "true" }],
    ["sin controlado (no se alterna)", { productoId: ID }],
    [
      "una clave de más (la empresa no viaja en el pedido)",
      { productoId: ID, controlado: true, empresaId: ID },
    ],
    ["no es un objeto", "hola"],
    ["nulo", null],
  ])("rechaza: %s", (_caso, crudo) => {
    expect(leerElPedidoDeControlDeStock(crudo)).toEqual({ ok: false, error: "PEDIDO_INVALIDO" });
  });
});
