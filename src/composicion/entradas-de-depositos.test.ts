import { describe, expect, it } from "vitest";
import {
  entradaDeAltaDeDeposito,
  entradaDeCambioDeEstadoDeDeposito,
  entradaDeEdicionDeDeposito,
} from "./entradas-de-depositos";

const ID = "0b0b0b0b-1111-4222-8333-444444444444";

/**
 * La frontera de «Depósitos» (stock): solo se lee lo que el esquema declara, con la forma pedida. Previene: que el navegador mande la empresa, la sucursal, el uso o el estado por fuera de la acción,
 * o una versión que no es un número de la base.
 */
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

describe("el alta (sin cambios)", () => {
  it("«de venta» ausente es no", () => {
    expect(entradaDeAltaDeDeposito({ id: ID, nombre: "Cocina", uso: "NORMAL" })).toEqual({
      ok: true,
      valor: { id: ID, nombre: "Cocina", uso: "NORMAL", deVenta: false },
    });
  });
});
