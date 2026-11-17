import { describe, expect, it } from "vitest";
import {
  entradaDeAltaDeCaja,
  entradaDeAltaDeCuenta,
  entradaDeAltaDeMedio,
  entradaDeEdicionDeCaja,
  entradaDeEdicionDeCuenta,
  entradaDeEdicionDeMedio,
  entradaDeEstadoDeCaja,
  entradaDeEstadoDeCuenta,
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

const SUCURSAL = "5c5c5c5c-1111-4222-8333-444444444444";

describe("entradaDeAltaDeCuenta", () => {
  const completa = {
    tipo: "TERMINAL",
    nombre: "Posnet 1",
    identificadorExterno: "T-0481",
    sucursalId: SUCURSAL,
  };

  it("toma el tipo, el nombre, el identificador y la sucursal", () => {
    expect(entradaDeAltaDeCuenta(completa)).toEqual({ ok: true, valor: completa });
  });

  it.each([undefined, null, "", "  "])(
    "un identificador %j es «sin dato» (null)",
    (identificadorExterno) => {
      expect(entradaDeAltaDeCuenta({ ...completa, identificadorExterno })).toEqual({
        ok: true,
        valor: { ...completa, identificadorExterno: null },
      });
    },
  );

  it("el nombre NO se vuelve null: un nombre vacío lo rechaza el dominio, no la frontera", () => {
    expect(entradaDeAltaDeCuenta({ ...completa, nombre: "" })).toEqual({
      ok: true,
      valor: { ...completa, nombre: "" },
    });
  });

  it("descarta lo que no declara (la empresa) y exige una sucursal que sea un identificador", () => {
    expect(entradaDeAltaDeCuenta({ ...completa, empresaId: SUCURSAL })).toEqual({
      ok: true,
      valor: completa,
    });
    for (const sucursalId of [undefined, "", "todas", 7]) {
      expect(entradaDeAltaDeCuenta({ ...completa, sucursalId }).ok).toBe(false);
    }
    expect(entradaDeAltaDeCuenta({ tipo: "QR" }).ok).toBe(false);
  });
});

describe("entradaDeEdicionDeCuenta", () => {
  const completa = {
    cuentaDeCobroId: ID,
    versionEsperada: 2,
    nombre: "Posnet",
    identificadorExterno: null,
    sucursalId: SUCURSAL,
  };

  it("toma el id, la versión, el nombre, el identificador y la sucursal", () => {
    expect(entradaDeEdicionDeCuenta(completa)).toEqual({ ok: true, valor: completa });
    expect(entradaDeEdicionDeCuenta({ ...completa, versionEsperada: "5" })).toEqual({
      ok: true,
      valor: { ...completa, versionEsperada: 5 },
    });
  });

  it.each([
    {},
    { ...completa, cuentaDeCobroId: "x" },
    { ...completa, versionEsperada: -1 },
    { ...completa, sucursalId: "x" },
  ])("un pedido sin la forma pedida (%j) es inválido", (crudo) => {
    expect(entradaDeEdicionDeCuenta(crudo).ok).toBe(false);
  });
});

describe("entradaDeEstadoDeCuenta", () => {
  it("toma solo el id", () => {
    expect(entradaDeEstadoDeCuenta({ cuentaDeCobroId: ID, x: 1 })).toEqual({
      ok: true,
      valor: { cuentaDeCobroId: ID },
    });
    expect(entradaDeEstadoDeCuenta({ cuentaDeCobroId: "x" }).ok).toBe(false);
    expect(entradaDeEstadoDeCuenta(null).ok).toBe(false);
  });
});

describe("entradas de caja", () => {
  it("el alta toma solo el nombre: la sucursal la fija el servidor y no se lee del pedido", () => {
    expect(entradaDeAltaDeCaja({ nombre: "Caja del salón", sucursalId: SUCURSAL })).toEqual({
      ok: true,
      valor: { nombre: "Caja del salón" },
    });
    expect(entradaDeAltaDeCaja({}).ok).toBe(false);
    expect(entradaDeAltaDeCaja({ nombre: 3 }).ok).toBe(false);
  });

  it("la edición toma el id, la versión y el nombre", () => {
    expect(
      entradaDeEdicionDeCaja({ cajaId: ID, versionEsperada: "7", nombre: "Caja 1", x: 1 }),
    ).toEqual({
      ok: true,
      valor: { cajaId: ID, versionEsperada: 7, nombre: "Caja 1" },
    });
    for (const crudo of [
      {},
      { cajaId: ID, nombre: "x" },
      { cajaId: "x", versionEsperada: 1, nombre: "x" },
    ]) {
      expect(entradaDeEdicionDeCaja(crudo).ok).toBe(false);
    }
  });

  it("el estado toma solo el id", () => {
    expect(entradaDeEstadoDeCaja({ cajaId: ID, activa: false })).toEqual({
      ok: true,
      valor: { cajaId: ID },
    });
    expect(entradaDeEstadoDeCaja({ cajaId: 1 }).ok).toBe(false);
  });
});
