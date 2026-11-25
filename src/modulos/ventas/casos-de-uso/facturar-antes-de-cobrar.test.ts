import { describe, expect, it } from "vitest";
import { ESTADOS_DE_TICKET } from "../dominio/estados";
import { estadosFacturables, ticketSeFactura } from "./facturar-antes-de-cobrar";

describe("qué estados de ticket se facturan (R-05)", () => {
  it("con la perilla apagada solo el COBRADO; encendida, también el EMITIDO", () => {
    expect(estadosFacturables(false)).toEqual(["COBRADO"]);
    expect(estadosFacturables(true)).toEqual(["EMITIDO", "COBRADO"]);
  });
  it("el ANULADO y la CORTESIA nunca se facturan, con la perilla que sea", () => {
    for (const perilla of [false, true]) {
      expect(ticketSeFactura("ANULADO", perilla)).toBe(false);
      expect(ticketSeFactura("CORTESIA", perilla)).toBe(false);
    }
  });
  it("el EMITIDO se factura solo con la perilla encendida y el COBRADO siempre", () => {
    expect(ticketSeFactura("EMITIDO", false)).toBe(false);
    expect(ticketSeFactura("EMITIDO", true)).toBe(true);
    expect(ticketSeFactura("COBRADO", false)).toBe(true);
    expect(ticketSeFactura("COBRADO", true)).toBe(true);
  });
  it("lista blanca: ningún estado fuera de EMITIDO y COBRADO entra (falla cerrado ante un estado nuevo)", () => {
    const permitidos = new Set(["EMITIDO", "COBRADO"]);
    for (const estado of ESTADOS_DE_TICKET) {
      expect(ticketSeFactura(estado, true), estado).toBe(permitidos.has(estado));
    }
  });
});
