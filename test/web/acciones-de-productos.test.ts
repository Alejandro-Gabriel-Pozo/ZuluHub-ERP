import { describe, expect, it, vi } from "vitest";

/**
 * El archivo `"use server"` de los productos (`apps/web/app/s/app/acciones-de-productos.ts`): fino a propósito. Exporta dos funciones asíncronas y delega en
 * `servidor/ficha-de-producto.ts` (con el id y la versión ligados por la página) y en `servidor/alta-de-producto.ts` (con la clave de creación ligada por la página) y el formulario tal cual: la empresa y la persona las fija el servidor, no la acción.
 */
vi.mock("server-only", () => ({}));
const delegadas = vi.hoisted(() => ({ llamadas: [] as unknown[][], altas: [] as unknown[][] }));
vi.mock("../../apps/web/servidor/ficha-de-producto", () => ({
  guardarLaFicha: (...args: unknown[]) => {
    delegadas.llamadas.push(args);
    return Promise.resolve({ error: null });
  },
}));
vi.mock("../../apps/web/servidor/alta-de-producto", () => ({
  darDeAltaElProducto: (...args: unknown[]) => {
    delegadas.altas.push(args);
    return Promise.resolve({ error: null });
  },
}));

import * as acciones from "../../apps/web/app/s/app/acciones-de-productos";

describe("la acción de servidor de los productos expuesta a Next", () => {
  it("exporta solo guardarFichaAccion y crearProductoAccion, asíncronas", () => {
    expect(Object.keys(acciones)).toEqual(["guardarFichaAccion", "crearProductoAccion"]);
    expect(acciones.guardarFichaAccion.constructor.name).toBe("AsyncFunction");
    expect(acciones.crearProductoAccion.constructor.name).toBe("AsyncFunction");
  });

  it("delega con el id, la versión y el formulario, sin el estado anterior", async () => {
    const datos = new FormData();
    datos.set("nombre", "Milanesa");
    expect(await acciones.guardarFichaAccion("id-1", 4, { error: null }, datos)).toEqual({
      error: null,
    });
    expect(delegadas.llamadas).toEqual([["id-1", 4, datos]]);
  });

  it("el alta delega con la clave de creación que ligó la página y el formulario, sin el estado anterior", async () => {
    const datos = new FormData();
    datos.set("nombre", "Milanesa");
    expect(await acciones.crearProductoAccion("clave-1", { error: null }, datos)).toEqual({
      error: null,
    });
    expect(delegadas.altas).toEqual([["clave-1", datos]]);
  });
});
