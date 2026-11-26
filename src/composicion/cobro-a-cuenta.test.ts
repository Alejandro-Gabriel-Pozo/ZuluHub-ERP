import { describe, expect, it } from "vitest";
import type { ContextoOperativo } from "../contexto/contexto";
import { crearCobroACuenta, DECLARACIONES_DE_COBRO_A_CUENTA } from "./cobro-a-cuenta";

/**
 * Las lecturas del libro de «Cobrar un ticket a cuenta»: un id mal formado se rechaza ANTES de abrir ninguna transacción, y cada lectura declara su acción. Lo que lee de la base (el cargo más antiguo,
 * el saldo, otra empresa, un cliente que no existe) lo prueba `test/integracion/cobrar-a-cuenta-web.test.ts`.
 */
const SIN_BASE = {
  transacciones: {
    ejecutar: () => {
      throw new Error("no debía abrir una transacción");
    },
  },
  reglas: {},
} as never;
const CONTEXTO = {} as ContextoOperativo;
const UUID = "00000000-0000-4000-8000-000000000001";

describe("las lecturas del libro de «Cobrar un ticket a cuenta»", () => {
  const cobro = crearCobroACuenta(SIN_BASE);

  it("un id mal formado se rechaza sin tocar la base", async () => {
    for (const entrada of [
      { clienteId: "" },
      { clienteId: "no-es-un-id" },
      { clienteId: UUID, ticketId: "no-es-un-id" },
    ]) {
      expect(await cobro.cargoACobrarDelCliente(CONTEXTO, entrada)).toEqual({
        ok: false,
        error: "IDENTIFICADOR_INVALIDO",
      });
    }
    expect(await cobro.saldoDelClienteACuenta(CONTEXTO, { clienteId: "x" })).toEqual({
      ok: false,
      error: "IDENTIFICADOR_INVALIDO",
    });
  });

  it("cada lectura exige su acción: la cuenta corriente para el libro y ventas para el ticket", () => {
    expect(DECLARACIONES_DE_COBRO_A_CUENTA).toEqual({
      cargoACobrarDelCliente: { accion: "cuenta_corriente.ver" },
      saldoDelClienteACuenta: { accion: "cuenta_corriente.ver" },
      ticketACobrar: { accion: "ventas.ver" },
    });
  });
});
