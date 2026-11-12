import { describe, expect, it } from "vitest";
import {
  entradaDeAltaDeMedio,
  entradaDeEdicionDeMedio,
  entradaDeEstadoDeMedio,
} from "./entradas-de-caja";

const ID = "0b0b0b0b-1111-4222-8333-444444444444";

describe("entradaDeAltaDeMedio", () => {
  it("toma el tipo y el nombre tal cual (el dominio recorta y valida)", () => {
    expect(entradaDeAltaDeMedio({ tipo: "QR", nombre: " Mercado Pago " })).toEqual({
      ok: true,
      valor: { tipo: "QR", nombre: " Mercado Pago " },
    });
  });

  it.each([undefined, null, "", "   ", "\t\n"])(
    "un nombre %j es «sin nombre propio» (null)",
    (nombre) => {
      expect(entradaDeAltaDeMedio({ tipo: "QR", nombre })).toEqual({
        ok: true,
        valor: { tipo: "QR", nombre: null },
      });
    },
  );

  it("solo toma lo declarado: la empresa y otros campos del pedido se descartan", () => {
    const r = entradaDeAltaDeMedio({ tipo: "OTRO", nombre: null, empresaId: ID, x: 1 });
    expect(r).toEqual({ ok: true, valor: { tipo: "OTRO", nombre: null } });
  });

  it.each([
    null,
    undefined,
    "texto",
    7,
    [],
    {},
    { tipo: 5 },
    { tipo: "x".repeat(1001) },
    { tipo: "QR", nombre: 3 },
  ])("un pedido sin la forma pedida (%j) es inválido", (crudo) => {
    expect(entradaDeAltaDeMedio(crudo).ok).toBe(false);
  });
});

describe("entradaDeEdicionDeMedio", () => {
  it("toma el id, la versión (número o texto de dígitos) y el nombre", () => {
    expect(
      entradaDeEdicionDeMedio({ medioDePagoId: ID, versionEsperada: 3, nombre: "Posnet" }),
    ).toEqual({
      ok: true,
      valor: { medioDePagoId: ID, versionEsperada: 3, nombre: "Posnet" },
    });
    expect(entradaDeEdicionDeMedio({ medioDePagoId: ID, versionEsperada: "4" })).toEqual({
      ok: true,
      valor: { medioDePagoId: ID, versionEsperada: 4, nombre: null },
    });
  });

  it.each([
    {},
    { medioDePagoId: "no-es-un-id", versionEsperada: 1 },
    { medioDePagoId: ID },
    { medioDePagoId: ID, versionEsperada: -1 },
    { medioDePagoId: ID, versionEsperada: "1.5" },
    { medioDePagoId: ID, versionEsperada: 1e12 },
  ])("un pedido sin la forma pedida (%j) es inválido", (crudo) => {
    expect(entradaDeEdicionDeMedio(crudo).ok).toBe(false);
  });
});

describe("entradaDeEstadoDeMedio", () => {
  it("toma solo el id", () => {
    expect(entradaDeEstadoDeMedio({ medioDePagoId: ID, activo: false })).toEqual({
      ok: true,
      valor: { medioDePagoId: ID },
    });
  });
  it.each([{}, { medioDePagoId: 1 }, { medioDePagoId: "x" }, null])("%j es inválido", (crudo) => {
    expect(entradaDeEstadoDeMedio(crudo).ok).toBe(false);
  });
});
