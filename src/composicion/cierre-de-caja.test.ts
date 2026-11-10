import { describe, expect, it } from "vitest";
import { aporteDeCaja, ticketsPorCobranzaDeLaComposicion } from "./cierre-de-caja";

/**
 * El cierre del día de caja en la composición (E3, tramo 8): el aporte que se registra en `cierre` es el de caja, y mientras no exista ventas
 * el puerto de tickets no informa NADA: caja lo toma como un dato que no se pudo leer (`APORTE_NO_DISPONIBLE`, probado con la base en
 * `test/integracion/caja-cierre-del-dia-aporte.test.ts`) y nunca como «sin diferencias». Previene que un día con cobros de ventas se cierre con
 * un total de ticket inventado.
 */
describe("el cierre del día de caja en la composición", () => {
  it("registra el aporte del módulo caja", () => {
    expect(aporteDeCaja.modulo).toBe("caja");
    expect(typeof aporteDeCaja.impedimentos).toBe("function");
    expect(typeof aporteDeCaja.controles).toBe("function");
    expect(typeof aporteDeCaja.congelarEnTx).toBe("function");
  });

  it("sin ventas, el puerto de tickets no informa ninguna cobranza (falla cerrado), ni siquiera una pedida", async () => {
    const tx = {} as Parameters<typeof ticketsPorCobranzaDeLaComposicion.ticketsPorCobranza>[0];
    expect(await ticketsPorCobranzaDeLaComposicion.ticketsPorCobranza(tx, [])).toEqual([]);
    expect(
      await ticketsPorCobranzaDeLaComposicion.ticketsPorCobranza(tx, [
        "11111111-1111-4111-8111-111111111111",
      ]),
    ).toEqual([]);
  });
});
