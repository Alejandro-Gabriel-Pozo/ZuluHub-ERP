import { describe, expect, it } from "vitest";
import {
  leerElPedidoDeCambiarElEstadoDeLaCarta,
  leerElPedidoDeGuardarLaCarta,
} from "./entradas-de-carta-en-linea";

/**
 * La entrada de la pantalla «Carta en línea» (C1): los pedidos solo leen las claves declaradas (no se puede mandar la empresa, la persona, el código, el estado de una carta que se edita ni el
 * mensaje de portada) y exigen la forma pedida; qué es un nombre válido lo decide el dominio, no esta capa.
 */
const CARTA = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const SUCURSAL = "5c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";

describe("guardar los textos", () => {
  it("lee la carta, la sucursal, la versión y los tres textos, y descarta lo demás", () => {
    expect(
      leerElPedidoDeGuardarLaCarta({
        cartaId: CARTA,
        sucursalId: SUCURSAL,
        versionEsperada: 3,
        nombre: "Parador",
        rubro: "Parrilla",
        lugar: "Huinganco",
        empresaId: "otra",
        codigo: "ABC",
        estado: "EN_LINEA",
        mensajeDePortada: "x",
      }),
    ).toEqual({
      ok: true,
      valor: {
        cartaId: CARTA,
        sucursalId: SUCURSAL,
        versionEsperada: 3,
        nombre: "Parador",
        rubro: "Parrilla",
        lugar: "Huinganco",
      },
    });
  });

  it("una carta nueva lleva la versión en `null`; la versión como texto de dígitos se acepta, un valor raro no", () => {
    const base = { cartaId: CARTA, sucursalId: SUCURSAL, nombre: "P", rubro: "", lugar: "" };
    expect(leerElPedidoDeGuardarLaCarta({ ...base, versionEsperada: null })).toMatchObject({
      ok: true,
    });
    expect(leerElPedidoDeGuardarLaCarta({ ...base, versionEsperada: "4" })).toMatchObject({
      ok: true,
      valor: { versionEsperada: 4 },
    });
    for (const mala of ["-1", "1e3", "3.5", undefined])
      expect(leerElPedidoDeGuardarLaCarta({ ...base, versionEsperada: mala })).toEqual({
        ok: false,
        error: "PEDIDO_INVALIDO",
      });
  });

  it("rechaza lo que no tiene la forma: ids que no son ids, textos que no son texto o enormes, un pedido vacío", () => {
    const bueno = {
      cartaId: CARTA,
      sucursalId: SUCURSAL,
      versionEsperada: null,
      nombre: "P",
      rubro: "",
      lugar: "",
    };
    for (const roto of [
      { ...bueno, cartaId: "nada" },
      { ...bueno, sucursalId: "x" },
      { ...bueno, nombre: 5 },
      { ...bueno, lugar: "x".repeat(1001) },
      null,
      "texto",
      {},
    ])
      expect(leerElPedidoDeGuardarLaCarta(roto)).toEqual({ ok: false, error: "PEDIDO_INVALIDO" });
  });
});

describe("poner en línea o sacar de línea", () => {
  it("lee la carta, la sucursal, la versión y el estado pedido, y descarta lo demás", () => {
    expect(
      leerElPedidoDeCambiarElEstadoDeLaCarta({
        cartaId: CARTA,
        sucursalId: SUCURSAL,
        versionEsperada: 2,
        estado: "EN_LINEA",
        nombre: "Otro",
        empresaId: "otra",
      }),
    ).toEqual({
      ok: true,
      valor: { cartaId: CARTA, sucursalId: SUCURSAL, versionEsperada: 2, estado: "EN_LINEA" },
    });
  });

  it("el estado es uno de los dos (no hay «alternar») y la versión es obligatoria", () => {
    const bueno = {
      cartaId: CARTA,
      sucursalId: SUCURSAL,
      versionEsperada: 2,
      estado: "FUERA_DE_LINEA",
    };
    expect(leerElPedidoDeCambiarElEstadoDeLaCarta(bueno)).toMatchObject({ ok: true });
    for (const roto of [
      { ...bueno, estado: "ALTERNAR" },
      { ...bueno, estado: undefined },
      { ...bueno, versionEsperada: null },
      { ...bueno, versionEsperada: undefined },
    ])
      expect(leerElPedidoDeCambiarElEstadoDeLaCarta(roto)).toEqual({
        ok: false,
        error: "PEDIDO_INVALIDO",
      });
  });
});
