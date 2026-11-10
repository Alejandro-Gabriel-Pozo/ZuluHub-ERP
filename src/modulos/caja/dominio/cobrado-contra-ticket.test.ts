import { describe, expect, it } from "vitest";
import { importeDesdeTexto } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import {
  ORIGEN_DE_COBRANZA_DE_TICKET,
  cobradoPorOrigen,
  compararContraTickets,
} from "./cobrado-contra-ticket";

const valor = (texto: string) => importeDesdeTexto(ARS, texto);
const A = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c41";
const B = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c42";
const C = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c43";
const cobro = (id: string, importe: string, tipo: string = ORIGEN_DE_COBRANZA_DE_TICKET) => ({
  origen: { tipo, id },
  importe: valor(importe),
});
const ticket = (cobranzaId: string, total: string, ticketId = `t-${cobranzaId.slice(-2)}`) => ({
  cobranzaId,
  ticketId,
  totalVigente: valor(total),
});

describe("el origen de una cobranza de ticket", () => {
  it("es el tipo que ventas usa para sus cobranzas (e3b §4.6)", () => {
    expect(ORIGEN_DE_COBRANZA_DE_TICKET).toBe("ventas.cobranza_de_ticket");
    expect(
      compararContraTickets([cobro(A, "10", "ventas.cobranza_de_ticket")], [ticket(A, "9")]).ok,
    ).toBe(true);
    expect(compararContraTickets([cobro(A, "10", "ventas.cobranza_de_ticket")], [])).toEqual({
      ok: false,
      error: "TICKETS_NO_DISPONIBLES",
    });
    expect(compararContraTickets([cobro(A, "10", "")], [])).toEqual({ ok: true, valor: [] });
  });
});

describe("cobrado por origen", () => {
  it("suma los cobros de cada origen (tipo + id), sin importar el medio, ordenado", () => {
    expect(
      cobradoPorOrigen([
        cobro(B, "10.10"),
        cobro(A, "5"),
        cobro(B, "0.20"),
        cobro(A, "1", "ventas.otra"),
      ]),
    ).toEqual([
      { origen: { tipo: ORIGEN_DE_COBRANZA_DE_TICKET, id: A }, cobrado: valor("5") },
      { origen: { tipo: ORIGEN_DE_COBRANZA_DE_TICKET, id: B }, cobrado: valor("10.30") },
      { origen: { tipo: "ventas.otra", id: A }, cobrado: valor("1") },
    ]);
    expect(cobradoPorOrigen([])).toEqual([]);
  });
  it("el tipo y el id juntos identifican el origen (no se mezclan los que comparten solo uno)", () => {
    expect(
      cobradoPorOrigen([
        cobro("x", "1", "a.b"),
        cobro("x", "2", "a.c"),
        cobro("y", "4", "a.b"),
      ]).map((c) => c.cobrado),
    ).toEqual([valor("1"), valor("4"), valor("2")]);
  });
});

describe("cobrado contra el total del ticket (decisión 155)", () => {
  it("un ticket corregido a la baja deja lo cobrado mayor: diferencia positiva con el ticket", () => {
    expect(compararContraTickets([cobro(A, "1000")], [ticket(A, "800")])).toEqual({
      ok: true,
      valor: [
        {
          origen: { tipo: ORIGEN_DE_COBRANZA_DE_TICKET, id: A },
          ticketId: "t-41",
          cobrado: valor("1000"),
          totalDelTicket: valor("800"),
          diferencia: valor("200"),
        },
      ],
    });
  });
  it("un ticket anulado (total 0 desde la composición) con lo cobrado también difiere", () => {
    const r = compararContraTickets([cobro(A, "50")], [ticket(A, "0")]);
    expect(r.ok && r.valor.map((d) => d.diferencia)).toEqual([valor("50")]);
  });
  it("lo que cuadra al centavo no es un hallazgo; dos cobros del mismo ticket se suman", () => {
    expect(
      compararContraTickets([cobro(A, "400.50"), cobro(A, "399.50")], [ticket(A, "800")]),
    ).toEqual({ ok: true, valor: [] });
    expect(compararContraTickets([cobro(A, "799.99")], [ticket(A, "800")])).toMatchObject({
      ok: true,
      valor: [{ diferencia: valor("-0.01") }],
    });
  });
  it("devuelve cada origen con diferencia, ordenados por origen", () => {
    const r = compararContraTickets(
      [cobro(C, "10"), cobro(A, "10"), cobro(B, "5")],
      [ticket(A, "9"), ticket(B, "5"), ticket(C, "8")],
    );
    expect(r.ok && r.valor.map((d) => d.origen.id)).toEqual([A, C]);
  });
  it("los orígenes que no son cobranzas de tickets no se comparan y no necesitan ticket", () => {
    expect(compararContraTickets([cobro(A, "10", "ventas.otra")], [])).toEqual({
      ok: true,
      valor: [],
    });
  });
  it("los tickets de cobranzas que no cobró esta jornada se ignoran", () => {
    expect(compararContraTickets([cobro(A, "10")], [ticket(A, "10"), ticket(B, "99")])).toEqual({
      ok: true,
      valor: [],
    });
  });
  it("sin el ticket de una cobranza cobrada, el dato no se puede leer", () => {
    expect(compararContraTickets([cobro(A, "10")], [ticket(B, "10")])).toEqual({
      ok: false,
      error: "TICKETS_NO_DISPONIBLES",
    });
  });
  it("una cobranza informada dos veces o con un total negativo no se puede leer", () => {
    expect(compararContraTickets([cobro(A, "10")], [ticket(A, "10"), ticket(A, "10")])).toEqual({
      ok: false,
      error: "TICKETS_NO_DISPONIBLES",
    });
    expect(compararContraTickets([cobro(A, "10")], [ticket(A, "-1")])).toEqual({
      ok: false,
      error: "TICKETS_NO_DISPONIBLES",
    });
    expect(compararContraTickets([], [ticket(B, "-1")])).toEqual({
      ok: false,
      error: "TICKETS_NO_DISPONIBLES",
    });
    expect(compararContraTickets([cobro(A, "0.01")], [ticket(A, "0")]).ok).toBe(true);
  });
});
