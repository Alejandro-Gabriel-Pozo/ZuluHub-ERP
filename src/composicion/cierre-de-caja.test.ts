import { describe, expect, it } from "vitest";
import { aporteDeCaja, ticketsPorCobranzaDeLaComposicion } from "./cierre-de-caja";

/**
 * El cierre del día de caja en la composición (E3, tramo 8; E4): el aporte que se registra en `cierre` es el de caja, y el puerto de tickets lo
 * implementa ventas. Sin las lecturas de ventas en la transacción es un defecto de armado y lanza (caja lo toma como un dato que no se pudo
 * leer, `APORTE_NO_DISPONIBLE`, y nunca como «sin diferencias»); con ellas, entrega el ticket y su total vigente. Previene que un día con cobros
 * de ventas se cierre con un total de ticket inventado. Con la base: `test/integracion/ventas-cobro-cierre.test.ts`.
 */
describe("el cierre del día de caja en la composición", () => {
  it("registra el aporte del módulo caja", () => {
    expect(aporteDeCaja.modulo).toBe("caja");
    expect(typeof aporteDeCaja.impedimentos).toBe("function");
    expect(typeof aporteDeCaja.controles).toBe("function");
    expect(typeof aporteDeCaja.congelarEnTx).toBe("function");
  });

  type Tx = Parameters<typeof ticketsPorCobranzaDeLaComposicion.ticketsPorCobranza>[0];

  it("sin las lecturas de ventas en la transacción, falla cerrado: lanza, no devuelve «nada»", async () => {
    const tx = {} as Tx;
    await expect(ticketsPorCobranzaDeLaComposicion.ticketsPorCobranza(tx, [])).rejects.toThrow(
      "las lecturas de ventas",
    );
  });

  it("con ellas, entrega cada ticket con su total vigente como importe exacto", async () => {
    const tx = {
      lecturasDeVentas: {
        ticketsPorCobranzaDelContexto: (ids: readonly string[]) =>
          Promise.resolve(
            ids.map((id) => ({ cobranzaId: id, ticketId: `t-${id}`, totalVigente: "8000.50" })),
          ),
      },
    } as unknown as Tx;
    expect(await ticketsPorCobranzaDeLaComposicion.ticketsPorCobranza(tx, ["a", "b"])).toEqual([
      { cobranzaId: "a", ticketId: "t-a", totalVigente: { moneda: "ARS", unidades: 800050n } },
      { cobranzaId: "b", ticketId: "t-b", totalVigente: { moneda: "ARS", unidades: 800050n } },
    ]);
  });
});
