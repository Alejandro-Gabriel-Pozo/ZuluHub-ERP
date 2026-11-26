import { describe, expect, it, vi } from "vitest";

/**
 * La acción de servidor de «Imprimir ticket» (`apps/web/app/s/app/acciones-de-cobrar.ts`): fina a propósito. Delega en `servidor/cobrar.ts` con el pedido tal cual: la empresa, la persona y la sucursal del ticket las
 * resuelve el servidor, no la acción. Es una lectura: repetirla (doble toque, reintento) da lo mismo y no escribe nada.
 */
vi.mock("server-only", () => ({}));
const delegadas = vi.hoisted(() => ({ llamadas: [] as unknown[] }));
vi.mock("../../apps/web/servidor/cobrar", () => ({
  papelDelTicketDelMostrador: (pedido: unknown) => {
    delegadas.llamadas.push(pedido);
    return Promise.resolve({
      ok: true,
      dato: { ancho: 80, lineas: [{ texto: "Ticket N.º 12", estilo: "NEGRITA" }] },
    });
  },
  anularElTicketDelMostrador: () => Promise.resolve({ ok: false }),
  cobrarLaVentaDelMostrador: () => Promise.resolve({ ok: false }),
}));

import * as acciones from "../../apps/web/app/s/app/acciones-de-cobrar";

describe("la acción de servidor del papel del ticket expuesta a Next", () => {
  it("papelDelTicketAccion es asíncrona y está entre las acciones de cobrar", () => {
    expect(Object.keys(acciones).sort()).toEqual([
      "anularElTicketAccion",
      "cobrarLaMesaAccion",
      "cobrarLaVentaAccion",
      "papelDelTicketAccion",
    ]);
    expect(acciones.papelDelTicketAccion.constructor.name).toBe("AsyncFunction");
  });

  it("delega con el pedido tal cual (sin completar ni agregar nada) y devuelve la respuesta", async () => {
    delegadas.llamadas.length = 0;
    const pedido = { ticketId: "t-1", sucursalId: "no-se-toca-acá" };
    expect(await acciones.papelDelTicketAccion(pedido)).toEqual({
      ok: true,
      dato: { ancho: 80, lineas: [{ texto: "Ticket N.º 12", estilo: "NEGRITA" }] },
    });
    expect(delegadas.llamadas).toEqual([pedido]);
  });

  it("repetirla da lo mismo: dos llamadas, dos respuestas iguales", async () => {
    const pedido = { ticketId: "t-1" };
    const [a, b] = await Promise.all([
      acciones.papelDelTicketAccion(pedido),
      acciones.papelDelTicketAccion(pedido),
    ]);
    expect(a).toEqual(b);
  });
});
