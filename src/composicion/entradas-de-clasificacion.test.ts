import { describe, expect, it } from "vitest";
import {
  leerElPedidoDeCambiarActivoDeNodo,
  leerElPedidoDeClasificarProducto,
  leerElPedidoDeCrearNodo,
  leerElPedidoDeMoverNodo,
  leerElPedidoDeRenombrarNodo,
} from "./entradas-de-clasificacion";

/** Las entradas de la clasificación comercial (A14): la forma de cada pedido, lo que se descarta y lo que se rechaza sin decir por qué. */
const A = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const B = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const INVALIDO = { ok: false, error: "PEDIDO_INVALIDO" };

describe("crear un nodo", () => {
  it("lee el id, el padre y el nombre; sin padre es un departamento", () => {
    expect(leerElPedidoDeCrearNodo({ id: A, padreId: B, nombre: "Comidas" })).toEqual({
      ok: true,
      valor: { id: A, padreId: B, nombre: "Comidas" },
    });
    expect(leerElPedidoDeCrearNodo({ id: A, padreId: null, nombre: "Restaurante" })).toEqual({
      ok: true,
      valor: { id: A, padreId: null, nombre: "Restaurante" },
    });
  });

  it("descarta lo que no declara: la empresa, la persona y la fecha las pone el servidor", () => {
    const r = leerElPedidoDeCrearNodo({
      id: A,
      padreId: null,
      nombre: "X",
      empresaId: "otra",
      personaId: "otra",
      vigenteDesde: "2100-01-01",
    });
    expect(r).toEqual({ ok: true, valor: { id: A, padreId: null, nombre: "X" } });
  });

  it.each([
    ["nada", undefined],
    ["un texto", "x"],
    ["sin id", { padreId: null, nombre: "X" }],
    ["id que no es un uuid", { id: "x", padreId: null, nombre: "X" }],
    ["padre que no es un uuid", { id: A, padreId: "x", nombre: "X" }],
    ["sin padre declarado", { id: A, nombre: "X" }],
    ["nombre que no es texto", { id: A, padreId: null, nombre: 1 }],
    ["nombre enorme", { id: A, padreId: null, nombre: "a".repeat(1001) }],
  ])("%s: pedido inválido", (_caso, crudo) => {
    expect(leerElPedidoDeCrearNodo(crudo)).toEqual(INVALIDO);
  });

  it("el nombre de hasta 1000 caracteres llega al dominio, que decide el largo propio", () => {
    expect(leerElPedidoDeCrearNodo({ id: A, padreId: null, nombre: "a".repeat(1000) }).ok).toBe(
      true,
    );
  });
});

describe("renombrar un nodo", () => {
  it("lee el nodo, la versión que se vio y el nombre", () => {
    expect(
      leerElPedidoDeRenombrarNodo({ nodoId: A, versionEsperada: 3, nombre: "Platos" }),
    ).toEqual({ ok: true, valor: { nodoId: A, versionEsperada: 3, nombre: "Platos" } });
  });

  it("la versión llega como número o como texto de dígitos", () => {
    expect(leerElPedidoDeRenombrarNodo({ nodoId: A, versionEsperada: "7", nombre: "X" })).toEqual({
      ok: true,
      valor: { nodoId: A, versionEsperada: 7, nombre: "X" },
    });
  });

  it.each([
    ["versión negativa", { nodoId: A, versionEsperada: -1, nombre: "X" }],
    ["versión con decimales", { nodoId: A, versionEsperada: "3.5", nombre: "X" }],
    ["versión que no es un número", { nodoId: A, versionEsperada: "tres", nombre: "X" }],
    ["sin versión", { nodoId: A, nombre: "X" }],
    ["sin nodo", { versionEsperada: 1, nombre: "X" }],
    ["sin nombre", { nodoId: A, versionEsperada: 1 }],
  ])("%s: pedido inválido", (_caso, crudo) => {
    expect(leerElPedidoDeRenombrarNodo(crudo)).toEqual(INVALIDO);
  });
});

describe("mover un nodo", () => {
  it("lee el nodo, la versión y el nuevo padre; descarta lo demás", () => {
    expect(
      leerElPedidoDeMoverNodo({ nodoId: A, versionEsperada: 2, nuevoPadreId: B, empresaId: "x" }),
    ).toEqual({ ok: true, valor: { nodoId: A, versionEsperada: 2, nuevoPadreId: B } });
  });

  it.each([
    ["sin nuevo padre", { nodoId: A, versionEsperada: 2 }],
    [
      "nuevo padre nulo (un departamento no se crea moviendo)",
      { nodoId: A, versionEsperada: 2, nuevoPadreId: null },
    ],
    ["nuevo padre que no es un uuid", { nodoId: A, versionEsperada: 2, nuevoPadreId: "x" }],
    ["nodo que no es un uuid", { nodoId: "x", versionEsperada: 2, nuevoPadreId: B }],
    ["sin versión", { nodoId: A, nuevoPadreId: B }],
  ])("%s: pedido inválido", (_caso, crudo) => {
    expect(leerElPedidoDeMoverNodo(crudo)).toEqual(INVALIDO);
  });
});

describe("desactivar y reactivar un nodo", () => {
  it("solo el nodo", () => {
    expect(leerElPedidoDeCambiarActivoDeNodo({ nodoId: A, activo: true })).toEqual({
      ok: true,
      valor: { nodoId: A },
    });
  });

  it.each([
    ["sin nodo", {}],
    ["nodo que no es un uuid", { nodoId: "x" }],
    ["nodo nulo", { nodoId: null }],
  ])("%s: pedido inválido", (_caso, crudo) => {
    expect(leerElPedidoDeCambiarActivoDeNodo(crudo)).toEqual(INVALIDO);
  });
});

describe("clasificar un producto", () => {
  it("lee la clave, el producto y el nodo; el nodo nulo es «Sin elegir»", () => {
    expect(leerElPedidoDeClasificarProducto({ id: A, productoId: B, nodoId: A })).toEqual({
      ok: true,
      valor: { id: A, productoId: B, nodoId: A },
    });
    expect(leerElPedidoDeClasificarProducto({ id: A, productoId: B, nodoId: null })).toEqual({
      ok: true,
      valor: { id: A, productoId: B, nodoId: null },
    });
  });

  it("descarta lo que no declara, también la fecha: el cambio rige desde ahora", () => {
    expect(
      leerElPedidoDeClasificarProducto({
        id: A,
        productoId: B,
        nodoId: null,
        vigenteDesde: "2100-01-01",
        cargadoPor: "otra",
      }),
    ).toEqual({ ok: true, valor: { id: A, productoId: B, nodoId: null } });
  });

  it.each([
    ["sin clave", { productoId: B, nodoId: null }],
    ["clave que no es un uuid", { id: "x", productoId: B, nodoId: null }],
    ["sin producto", { id: A, nodoId: null }],
    ["producto que no es un uuid", { id: A, productoId: "x", nodoId: null }],
    ["nodo que no es un uuid", { id: A, productoId: B, nodoId: "x" }],
    ["sin nodo declarado", { id: A, productoId: B }],
  ])("%s: pedido inválido", (_caso, crudo) => {
    expect(leerElPedidoDeClasificarProducto(crudo)).toEqual(INVALIDO);
  });
});
