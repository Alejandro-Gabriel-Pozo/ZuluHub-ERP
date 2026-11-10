import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

/**
 * El archivo `"use server"` de facturar un ticket (`apps/web/app/s/app/acciones-de-facturar-tickets.ts`): lo que expone a Next. Es fino a
 * propósito, como el del facturador: la directiva va PRIMERO, solo exporta funciones asíncronas y delega en su par de
 * `servidor/facturar-tickets.ts` con el pedido tal cual, sin decidir nada (lo que hace está probado con la base real en
 * `test/integracion/ventas-facturar-web.test.ts`).
 */
vi.mock("server-only", () => ({}));
const delegadas = vi.hoisted(() => ({ llamadas: [] as { nombre: string; entrada: unknown }[] }));
vi.mock("../../apps/web/servidor/facturar-tickets", () => ({
  emitirElTicket: (entrada?: unknown) => {
    delegadas.llamadas.push({ nombre: "emitirElTicket", entrada });
    return Promise.resolve({ ok: true, dato: "emitirElTicket" });
  },
}));

import * as acciones from "../../apps/web/app/s/app/acciones-de-facturar-tickets";

const ARCHIVO = "apps/web/app/s/app/acciones-de-facturar-tickets.ts";

describe("la acción de servidor de facturar un ticket expuesta a Next", () => {
  it("la directiva «use server» es lo primero del archivo", () => {
    expect(readFileSync(ARCHIVO, "utf8").startsWith('"use server";')).toBe(true);
  });

  it("exporta exactamente una acción, asíncrona", () => {
    expect(Object.keys(acciones)).toEqual(["emitirTicketAccion"]);
    expect(acciones.emitirTicketAccion.constructor.name).toBe("AsyncFunction");
  });

  it("delega en `emitirElTicket` con el pedido tal cual", async () => {
    const entrada = { ticketId: "t", empresaId: "no-se-toca-acá" };
    expect(await acciones.emitirTicketAccion(entrada)).toEqual({
      ok: true,
      dato: "emitirElTicket",
    });
    expect(delegadas.llamadas).toEqual([{ nombre: "emitirElTicket", entrada }]);
  });
});
