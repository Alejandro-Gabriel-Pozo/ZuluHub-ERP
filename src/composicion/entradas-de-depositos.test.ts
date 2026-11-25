import { describe, expect, it } from "vitest";
import {
  entradaDeAltaDeDeposito,
  entradaDeCambioDeEstadoDeDeposito,
  entradaDeEdicionDeDeposito,
} from "./entradas-de-depositos";

const ID = "0b0b0b0b-1111-4222-8333-444444444444";

describe("entradaDeAltaDeDeposito", () => {
  it("toma solo el identificador, el nombre, el uso y «de venta»; sin «de venta» es que no", () => {
    expect(entradaDeAltaDeDeposito({ id: ID, nombre: "Cocina", uso: "CUARENTENA" })).toEqual({
      ok: true,
      valor: { id: ID, nombre: "Cocina", uso: "CUARENTENA", deVenta: false },
    });
    expect(
      entradaDeAltaDeDeposito({ id: ID, nombre: "Salón", uso: "NORMAL", deVenta: true }),
    ).toEqual({ ok: true, valor: { id: ID, nombre: "Salón", uso: "NORMAL", deVenta: true } });
  });

  it("lo que el esquema no declara no pasa (ni la empresa, ni la sucursal, ni el estado)", () => {
    const r = entradaDeAltaDeDeposito({
      id: ID,
      nombre: "Cocina",
      uso: "NORMAL",
      sucursalId: ID,
      empresaId: ID,
      activo: false,
    });
    expect(r).toEqual({
      ok: true,
      valor: { id: ID, nombre: "Cocina", uso: "NORMAL", deVenta: false },
    });
  });

  it.each([
    ["sin identificador", { nombre: "a", uso: "NORMAL" }],
    ["identificador que no es un UUID", { id: "x", nombre: "a", uso: "NORMAL" }],
    ["sin nombre", { id: ID, uso: "NORMAL" }],
    ["nombre que no es texto", { id: ID, nombre: 3, uso: "NORMAL" }],
    ["nombre de más de 1000 caracteres", { id: ID, nombre: "a".repeat(1001), uso: "NORMAL" }],
    ["sin uso", { id: ID, nombre: "a" }],
    ["un uso que no existe", { id: ID, nombre: "a", uso: "VENTA" }],
    ["el uso en minúsculas", { id: ID, nombre: "a", uso: "normal" }],
    ["«de venta» que no es un sí o no", { id: ID, nombre: "a", uso: "NORMAL", deVenta: "true" }],
    ["un pedido que no es un objeto", "hola"],
    ["nada", undefined],
  ])("%s es una entrada inválida", (_caso, crudo) => {
    expect(entradaDeAltaDeDeposito(crudo).ok).toBe(false);
  });
});

describe("la edición de un depósito", () => {
  it("lee el depósito, el nombre, «de venta» y la versión que se vio", () => {
    expect(
      entradaDeEdicionDeDeposito({
        depositoId: ID,
        nombre: "Cocina",
        deVenta: true,
        versionEsperada: 3,
      }),
    ).toEqual({
      ok: true,
      valor: { depositoId: ID, nombre: "Cocina", deVenta: true, versionEsperada: 3 },
    });
  });

  it("«de venta» ausente es no, y la versión puede llegar como texto de dígitos", () => {
    expect(
      entradaDeEdicionDeDeposito({ depositoId: ID, nombre: "Cocina", versionEsperada: "12" }),
    ).toEqual({
      ok: true,
      valor: { depositoId: ID, nombre: "Cocina", deVenta: false, versionEsperada: 12 },
    });
  });

  it("descarta lo que el esquema no declara (uso, sucursal, empresa, estado)", () => {
    const leido = entradaDeEdicionDeDeposito({
      depositoId: ID,
      nombre: "Cocina",
      versionEsperada: 1,
      uso: "RECHAZO",
      sucursalId: ID,
      empresaId: ID,
      activo: false,
    });
    expect(leido.ok && Object.keys(leido.valor).sort()).toEqual([
      "deVenta",
      "depositoId",
      "nombre",
      "versionEsperada",
    ]);
  });

  it.each([
    ["sin pedido", undefined],
    ["un identificador que no es uno", { depositoId: "x", nombre: "a", versionEsperada: 1 }],
    ["un nombre que no es texto", { depositoId: ID, nombre: 7, versionEsperada: 1 }],
    ["un nombre enorme", { depositoId: ID, nombre: "a".repeat(1001), versionEsperada: 1 }],
    ["sin versión", { depositoId: ID, nombre: "a" }],
    ["una versión negativa", { depositoId: ID, nombre: "a", versionEsperada: -1 }],
    ["una versión decimal", { depositoId: ID, nombre: "a", versionEsperada: "1.5" }],
    ["una versión fuera de rango", { depositoId: ID, nombre: "a", versionEsperada: 2 ** 31 }],
    [
      "«de venta» que no es un sí o no",
      { depositoId: ID, nombre: "a", versionEsperada: 1, deVenta: "si" },
    ],
  ])("%s se rechaza", (_caso, crudo) => {
    expect(entradaDeEdicionDeDeposito(crudo).ok).toBe(false);
  });
});

describe("desactivar y reactivar un depósito", () => {
  it("solo se lee el depósito: el sentido lo fija la acción, no el pedido", () => {
    const leido = entradaDeCambioDeEstadoDeDeposito({
      depositoId: ID,
      activo: true,
      empresaId: ID,
    });
    expect(leido).toEqual({ ok: true, valor: { depositoId: ID } });
  });

  it.each([undefined, {}, { depositoId: "x" }, { depositoId: 5 }])("%j se rechaza", (crudo) => {
    expect(entradaDeCambioDeEstadoDeDeposito(crudo).ok).toBe(false);
  });
});
