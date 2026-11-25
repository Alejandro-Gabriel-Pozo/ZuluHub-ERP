import { describe, expect, it } from "vitest";
import {
  leerElPedidoDeCambiarElEstado,
  leerElPedidoDeCrearPresentacion,
  leerElPedidoDeLasPresentaciones,
  leerElPedidoDeRenombrarPresentacion,
} from "./entradas-de-presentaciones";

/**
 * La entrada de la solapa «Cómo se compra»: solo se leen las claves declaradas (la empresa, la persona, la cantidad de una presentación ya creada y su estado no se pueden mandar), con la forma
 * pedida; lo demás es `PEDIDO_INVALIDO` sin decir cuál campo. Qué es un nombre o una cantidad válidos lo decide el dominio.
 */
const P = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const A = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

describe("leerElPedidoDeCrearPresentacion", () => {
  const pedido = { productoId: P, nombre: "Caja", cantidad: "5", pesoVariable: false };

  it("acepta la forma pedida y descarta lo que no declara (empresa, persona, activa, versión)", () => {
    const r = leerElPedidoDeCrearPresentacion({
      ...pedido,
      empresaId: "otra",
      personaId: "otra",
      activa: false,
      version: 9,
    });
    expect(r).toEqual({ ok: true, valor: pedido });
  });

  it.each([
    ["un producto que no tiene forma de id", { ...pedido, productoId: "x" }],
    ["un nombre que no es texto", { ...pedido, nombre: 5 }],
    ["una cantidad que no es texto", { ...pedido, cantidad: 5 }],
    ["una cantidad enorme", { ...pedido, cantidad: "1".repeat(41) }],
    ["un peso variable que no es un sí o un no", { ...pedido, pesoVariable: "on" }],
    ["sin peso variable", { productoId: P, nombre: "Caja", cantidad: "5" }],
    ["algo que no es un objeto", "hola"],
  ])("rechaza %s", (_nombre, crudo) => {
    expect(leerElPedidoDeCrearPresentacion(crudo)).toEqual({ ok: false, error: "PEDIDO_INVALIDO" });
  });
});

describe("leerElPedidoDeRenombrarPresentacion", () => {
  it("acepta la versión como número o como dígitos y descarta lo no declarado", () => {
    for (const versionEsperada of [3, "3"]) {
      expect(
        leerElPedidoDeRenombrarPresentacion({
          productoId: P,
          presentacionId: A,
          versionEsperada,
          nombre: "Nueva",
          cantidad: "99",
        }),
      ).toEqual({
        ok: true,
        valor: { productoId: P, presentacionId: A, versionEsperada: 3, nombre: "Nueva" },
      });
    }
  });

  it.each([
    ["una versión negativa", { versionEsperada: "-1" }],
    ["una versión decimal", { versionEsperada: "3.5" }],
    ["una presentación sin forma de id", { presentacionId: "x" }],
    ["sin nombre", { nombre: undefined }],
  ])("rechaza %s", (_nombre, cambio) => {
    expect(
      leerElPedidoDeRenombrarPresentacion({
        productoId: P,
        presentacionId: A,
        versionEsperada: 1,
        nombre: "Nueva",
        ...cambio,
      }),
    ).toEqual({ ok: false, error: "PEDIDO_INVALIDO" });
  });
});

describe("leerElPedidoDeCambiarElEstado y leerElPedidoDeLasPresentaciones", () => {
  it("el estado no viaja en el pedido: lo fija la acción; el producto y la presentación tienen que ser ids", () => {
    expect(
      leerElPedidoDeCambiarElEstado({
        productoId: P,
        presentacionId: A,
        versionEsperada: 2,
        activa: false,
      }),
    ).toEqual({ ok: true, valor: { productoId: P, presentacionId: A, versionEsperada: 2 } });
    expect(leerElPedidoDeCambiarElEstado({ productoId: P, versionEsperada: 2 })).toEqual({
      ok: false,
      error: "PEDIDO_INVALIDO",
    });
  });

  it("las presentaciones de un producto piden solo el id del producto", () => {
    expect(leerElPedidoDeLasPresentaciones({ productoId: P, otro: 1 })).toEqual({
      ok: true,
      valor: { productoId: P },
    });
    expect(leerElPedidoDeLasPresentaciones({ productoId: "x" })).toEqual({
      ok: false,
      error: "PEDIDO_INVALIDO",
    });
  });
});
