import { describe, expect, it, vi } from "vitest";

/**
 * El archivo `"use server"` de los productos (`apps/web/app/s/app/acciones-de-productos.ts`): fino a propósito. Exporta una sola función asíncrona y delega en
 * `servidor/ficha-de-producto.ts` con el id y la versión ligados por la página y el formulario tal cual: la empresa y la persona las fija el servidor, no la acción.
 */
vi.mock("server-only", () => ({}));
const delegadas = vi.hoisted(() => ({ llamadas: [] as unknown[][] }));
vi.mock("../../apps/web/servidor/ficha-de-producto", () => ({
  guardarLaFicha: (...args: unknown[]) => {
    delegadas.llamadas.push(args);
    return Promise.resolve({ error: null });
  },
}));

import * as acciones from "../../apps/web/app/s/app/acciones-de-productos";

describe("la acción de servidor de los productos expuesta a Next", () => {
  it("exporta solo guardarFichaAccion, asíncrona", () => {
    expect(Object.keys(acciones)).toEqual(["guardarFichaAccion"]);
    expect(acciones.guardarFichaAccion.constructor.name).toBe("AsyncFunction");
  });

  it("delega con el id, la versión y el formulario, sin el estado anterior", async () => {
    const datos = new FormData();
    datos.set("nombre", "Milanesa");
    expect(await acciones.guardarFichaAccion("id-1", 4, { error: null }, datos)).toEqual({
      error: null,
    });
    expect(delegadas.llamadas).toEqual([["id-1", 4, datos]]);
  });
});
