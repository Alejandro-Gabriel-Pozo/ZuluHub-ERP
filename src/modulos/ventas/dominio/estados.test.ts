import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import {
  ESTADOS_DE_CUENTA,
  ESTADOS_DE_LINEA,
  ESTADOS_DE_TICKET,
  TRANSICIONES_DE_CUENTA,
  TRANSICIONES_DE_TICKET,
  transicionDeCuentaPermitida,
  transicionDeTicketPermitida,
  type EstadoDeCuenta,
  type EstadoDeTicket,
} from "./estados";

describe("estados y transiciones", () => {
  it("las listas son las de la especificación", () => {
    expect([...ESTADOS_DE_CUENTA]).toEqual(["ABIERTA", "CERRADA", "ANULADA"]);
    expect([...ESTADOS_DE_LINEA]).toEqual(["VIGENTE", "ANULADA"]);
    expect([...ESTADOS_DE_TICKET]).toEqual(["EMITIDO", "COBRADO", "CORTESIA", "ANULADO"]);
  });
  it("cuenta: solo ABIERTA → CERRADA o ANULADA", () => {
    const permitidas = ESTADOS_DE_CUENTA.flatMap((de) =>
      ESTADOS_DE_CUENTA.filter((a) => transicionDeCuentaPermitida(de, a)).map((a) => `${de}>${a}`),
    );
    expect(permitidas).toEqual(["ABIERTA>CERRADA", "ABIERTA>ANULADA"]);
  });
  it("ticket: exactamente cuatro transiciones y ANULADO es final", () => {
    const permitidas = ESTADOS_DE_TICKET.flatMap((de) =>
      ESTADOS_DE_TICKET.filter((a) => transicionDeTicketPermitida(de, a)).map((a) => `${de}>${a}`),
    );
    expect(permitidas).toEqual([
      "EMITIDO>COBRADO",
      "EMITIDO>ANULADO",
      "COBRADO>ANULADO",
      "CORTESIA>ANULADO",
    ]);
    expect(TRANSICIONES_DE_TICKET.ANULADO).toEqual([]);
    expect(TRANSICIONES_DE_CUENTA.CERRADA).toEqual([]);
    expect(TRANSICIONES_DE_CUENTA.ANULADA).toEqual([]);
  });
  it("P20: ninguna secuencia de transiciones permitidas reabre una cuenta ni lleva un ticket anulado a otro estado", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...ESTADOS_DE_TICKET), { maxLength: 12 }),
        fc.array(fc.constantFrom(...ESTADOS_DE_CUENTA), { maxLength: 12 }),
        (pasosT, pasosC) => {
          let t: EstadoDeTicket = "EMITIDO";
          let vistoAnulado = false;
          for (const siguiente of pasosT) {
            if (transicionDeTicketPermitida(t, siguiente)) t = siguiente;
            if (t === "ANULADO") vistoAnulado = true;
            if (vistoAnulado) expect(t).toBe("ANULADO");
          }
          let c: EstadoDeCuenta = "ABIERTA";
          let resuelta = false;
          for (const siguiente of pasosC) {
            if (transicionDeCuentaPermitida(c, siguiente)) c = siguiente;
            if (c !== "ABIERTA") resuelta = true;
            if (resuelta) expect(c).not.toBe("ABIERTA");
          }
        },
      ),
    );
  });
});
