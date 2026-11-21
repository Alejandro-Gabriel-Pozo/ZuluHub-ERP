import { describe, expect, it, vi } from "vitest";

/**
 * El archivo `"use server"` de la venta rápida (`apps/web/app/s/app/acciones-de-venta-rapida.ts`): fino a propósito. Exporta una sola función asíncrona y delega en
 * `servidor/venta-rapida.ts` con el pedido tal cual: la empresa, la persona y la sucursal las fija el servidor, no la acción. Cotizar es una lectura: repetirla da lo mismo.
 */
vi.mock("server-only", () => ({}));
const delegadas = vi.hoisted(() => ({ llamadas: [] as unknown[] }));
vi.mock("../../apps/web/servidor/venta-rapida", () => ({
  cotizarElCarritoDeLaSucursal: (pedido: unknown) => {
    delegadas.llamadas.push(pedido);
    return Promise.resolve({
      ok: true,
      dato: { total: { moneda: "ARS", monto: "800.00" }, lineas: [] },
    });
  },
}));

import * as acciones from "../../apps/web/app/s/app/acciones-de-venta-rapida";

describe("la acción de servidor de la venta rápida expuesta a Next", () => {
  it("exporta solo cotizarElCarritoAccion, asíncrona", () => {
    expect(Object.keys(acciones)).toEqual(["cotizarElCarritoAccion"]);
    expect(acciones.cotizarElCarritoAccion.constructor.name).toBe("AsyncFunction");
  });

  it("delega con el pedido tal cual (sin completar ni agregar nada) y devuelve la respuesta", async () => {
    const pedido = {
      lineas: [{ productoId: "p", opcionIds: [], cantidad: "1" }],
      sucursalId: "no-se-toca-acá",
    };
    const respuesta = await acciones.cotizarElCarritoAccion(pedido);
    expect(respuesta).toEqual({
      ok: true,
      dato: { total: { moneda: "ARS", monto: "800.00" }, lineas: [] },
    });
    expect(delegadas.llamadas).toEqual([pedido]);
  });

  it("repetirla (doble toque, reintento) da lo mismo y no escribe nada: dos llamadas, dos respuestas iguales", async () => {
    delegadas.llamadas.length = 0;
    const pedido = { lineas: [] };
    const [a, b] = await Promise.all([
      acciones.cotizarElCarritoAccion(pedido),
      acciones.cotizarElCarritoAccion(pedido),
    ]);
    expect(a).toEqual(b);
    expect(delegadas.llamadas).toHaveLength(2);
  });
});
