import { describe, expect, it } from "vitest";
import {
  estadoEscrito,
  importeDeLaFila,
  lineaDeLaFicha,
  nombreAccesibleDeLaFila,
  type TicketDelDiaParaLaPantalla,
} from "../../apps/web/ui/plantillas/tickets-del-dia/modelo-de-tickets-del-dia";
import {
  jornadaParaMostrar,
  textosDeTicketsDelDia,
} from "../../apps/web/ui/plantillas/tickets-del-dia/textos-de-tickets-del-dia";

const monto = (m: string) => ({ moneda: "ARS", monto: m });
const ticket = (c: Partial<TicketDelDiaParaLaPantalla> = {}): TicketDelDiaParaLaPantalla => ({
  ticketId: "t-1",
  numero: 14,
  numeroDeCorreccion: 0,
  estado: "COBRADO",
  totalOriginal: monto("20500.00"),
  totalVigente: monto("20500.00"),
  emitidoEn: "2026-11-18T00:14:00.000Z",
  facturado: false,
  ...c,
});

describe("estadoEscrito: lista de permitidos", () => {
  it.each([
    [{ estado: "COBRADO", facturado: false }, "COBRADO"],
    [{ estado: "COBRADO", facturado: true }, "COBRADO_Y_FACTURADO"],
    [{ estado: "ANULADO", facturado: false }, "ANULADO"],
    [{ estado: "ANULADO", facturado: true }, "ANULADO"],
    [{ estado: "CORTESIA", facturado: false }, "CORTESIA"],
    [{ estado: "EMITIDO", facturado: false }, "POR_COBRAR"],
  ] as const)("%j se escribe %s", (t, esperado) => {
    expect(estadoEscrito(t)).toBe(esperado);
  });

  it("un estado desconocido lanza: nunca se dibuja como «Cobrado»", () => {
    for (const estado of ["", "cobrado", "PAGADO", "ABIERTA"]) {
      expect(() => estadoEscrito({ estado, facturado: false }), estado).toThrow(RangeError);
    }
  });
});

describe("la fila de la lista", () => {
  const textos = textosDeTicketsDelDia();
  it("el nombre accesible dice número, estado, hora de Argentina e importe", () => {
    // 00:14 UTC del 18/11 son las 21:14 del 17/11 en Argentina.
    expect(nombreAccesibleDeLaFila(ticket(), textos)).toBe(
      "Ticket N.º 14, Cobrado, 21:14, $ 20.500,00",
    );
    expect(nombreAccesibleDeLaFila(ticket({ facturado: true }), textos)).toBe(
      "Ticket N.º 14, Cobrado y facturado, 21:14, $ 20.500,00",
    );
    expect(nombreAccesibleDeLaFila(ticket({ estado: "EMITIDO" }), textos)).toContain("Por cobrar");
    expect(nombreAccesibleDeLaFila(ticket({ estado: "CORTESIA" }), textos)).toContain("Cortesía");
  });
  it("solo el anulado va tachado y con su total ORIGINAL", () => {
    const anulado = ticket({ estado: "ANULADO", totalVigente: monto("0.00") });
    expect(importeDeLaFila(anulado)).toEqual({ monto: "$ 20.500,00", tachado: true });
    expect(importeDeLaFila(ticket())).toEqual({ monto: "$ 20.500,00", tachado: false });
    expect(nombreAccesibleDeLaFila(anulado, textos)).toBe(
      "Ticket N.º 14, Anulado, 21:14, $ 20.500,00",
    );
  });
});

describe("la jornada y los renglones", () => {
  it("la jornada se escribe DD/MM/AAAA desde la fecha de negocio; una fecha mala lanza", () => {
    expect(jornadaParaMostrar("2026-11-17")).toBe("Jornada 17/11/2026");
    expect(() => jornadaParaMostrar("17/11/2026")).toThrow(RangeError);
  });
  it("un renglón: cantidad con la regla de la venta, importe y detalle (medida y opciones)", () => {
    const r = {
      lineaCuentaId: "l-1",
      descripcion: "Café",
      varianteNombre: "Doble",
      opciones: [{ grupo: "Extras", nombre: "Miel", recargo: "150.000000" }],
      cantidad: "2.0000",
      unidadDeVenta: "UNIDAD",
      importe: "3000.00",
    };
    expect(lineaDeLaFicha(r)).toEqual({
      clave: "l-1",
      titulo: "2 Café",
      importe: "$ 3.000,00",
      detalle: "Doble · Miel",
    });
    expect(lineaDeLaFicha({ ...r, varianteNombre: null, opciones: [] }).detalle).toBe("");
    expect(() => lineaDeLaFicha({ ...r, cantidad: "0.0000" })).toThrow(RangeError);
  });
});
