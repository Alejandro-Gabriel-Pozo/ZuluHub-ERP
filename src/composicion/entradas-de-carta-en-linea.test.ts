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

describe("guardar la identidad (cara, color y logo)", () => {
  const base = {
    cartaId: CARTA,
    sucursalId: SUCURSAL,
    versionEsperada: 3,
    nombre: "P",
    rubro: "",
    lugar: "",
  };
  const LOGO = "https://res.cloudinary.com/demo/image/upload/v1700000000/logos/parador.png";

  it("sin identidad en el pedido no la trae (conserva lo vigente): ni undefined ni vacío se inventan", () => {
    const r = leerElPedidoDeGuardarLaCarta(base);
    expect(r).toEqual({ ok: true, valor: base });
    expect(r.ok && Object.keys(r.valor)).not.toContain("cara");
  });

  it("la cara es una de la lista cerrada o vacía («sin elegir»)", () => {
    for (const cara of ["DIA", "BOLICHE", "NOCHE"])
      expect(leerElPedidoDeGuardarLaCarta({ ...base, cara })).toMatchObject({
        ok: true,
        valor: { cara },
      });
    expect(leerElPedidoDeGuardarLaCarta({ ...base, cara: "" })).toMatchObject({
      ok: true,
      valor: { cara: null },
    });
    for (const mala of ["X", "dia", "Día", " DIA", "DIA ", 3, null])
      expect(leerElPedidoDeGuardarLaCarta({ ...base, cara: mala })).toEqual({
        ok: false,
        error: "PEDIDO_INVALIDO",
      });
  });

  it("la paleta vacía es «usar lo de la empresa»; un `#rrggbb` es ese color; «otro» toma `colorPropio`", () => {
    expect(leerElPedidoDeGuardarLaCarta({ ...base, paleta: "" })).toMatchObject({
      valor: { colorPropio: null },
    });
    expect(leerElPedidoDeGuardarLaCarta({ ...base, paleta: "#1f4e79" })).toMatchObject({
      valor: { colorPropio: "#1f4e79" },
    });
    expect(
      leerElPedidoDeGuardarLaCarta({ ...base, paleta: "otro", colorPropio: "#0e7490" }),
    ).toMatchObject({ valor: { colorPropio: "#0e7490" } });
    // `colorPropio` solo cuenta con «otro»: con una paleta se ignora.
    expect(
      leerElPedidoDeGuardarLaCarta({ ...base, paleta: "#1f4e79", colorPropio: "#000000" }),
    ).toMatchObject({ valor: { colorPropio: "#1f4e79" } });
  });

  it("colores fuera de la forma `#rrggbb` en minúsculas se rechazan, también un script", () => {
    for (const malo of [
      { paleta: "#12345" },
      { paleta: "#1F4E79" },
      { paleta: "1f4e79" },
      { paleta: "rgb(0,0,0)" },
      { paleta: "<script>alert(1)</script>" },
      { paleta: "otro" },
      { paleta: "otro", colorPropio: "" },
      { paleta: "otro", colorPropio: "#12345" },
      { paleta: "otro", colorPropio: "<script>" },
      { paleta: "otro", colorPropio: "#0e74900" },
    ])
      expect(leerElPedidoDeGuardarLaCarta({ ...base, ...malo }), JSON.stringify(malo)).toEqual({
        ok: false,
        error: "PEDIDO_INVALIDO",
      });
  });

  it("el logo viaja en PARTES (nunca la dirección pegada); vacío lo quita; otro proveedor o lo que no es una dirección se rechaza", () => {
    expect(leerElPedidoDeGuardarLaCarta({ ...base, logo: LOGO })).toMatchObject({
      ok: true,
      valor: {
        logo: {
          proveedor: "CLOUDINARY",
          cuenta: "demo",
          idPublico: "logos/parador",
          version: "1700000000",
          extension: "png",
        },
      },
    });
    expect(JSON.stringify(leerElPedidoDeGuardarLaCarta({ ...base, logo: LOGO }))).not.toContain(
      "https:",
    );
    expect(leerElPedidoDeGuardarLaCarta({ ...base, logo: "  " })).toMatchObject({
      valor: { logo: null },
    });
    for (const malo of [
      "https://ejemplo.com/logo.png",
      "javascript:alert(1)",
      "<img src=x>",
      "https://res.cloudinary.com/demo/video/upload/v1/x.png",
      "x".repeat(1001),
    ])
      expect(leerElPedidoDeGuardarLaCarta({ ...base, logo: malo })).toEqual({
        ok: false,
        error: "PEDIDO_INVALIDO",
      });
  });

  it("el modelo viaja si es Lista o Libro; el estado no viaja: se descarta", () => {
    for (const modelo of ["LISTA", "LIBRO"]) {
      expect(leerElPedidoDeGuardarLaCarta({ ...base, modelo, estado: "EN_LINEA" })).toEqual({
        ok: true,
        valor: { ...base, modelo },
      });
    }
    expect(leerElPedidoDeGuardarLaCarta(base)).toEqual({ ok: true, valor: base });
  });

  it("un modelo que la pantalla no ofrece (Cuadrícula, vacío, inventado) es PEDIDO_INVALIDO", () => {
    for (const modelo of ["CUADRICULA", "", "libro", "X", 3]) {
      expect(leerElPedidoDeGuardarLaCarta({ ...base, modelo })).toEqual({
        ok: false,
        error: "PEDIDO_INVALIDO",
      });
    }
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
