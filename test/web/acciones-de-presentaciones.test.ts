import { describe, expect, it, vi } from "vitest";

/**
 * El archivo `"use server"` de las presentaciones (`apps/web/app/s/app/acciones-de-presentaciones.ts`): fino a propósito. Exporta tres funciones asíncronas y delega en
 * `servidor/presentaciones.ts` con lo que la página ligó (producto, presentación, versión, sentido) y el formulario tal cual: la empresa y la persona las fija el servidor.
 */
vi.mock("server-only", () => ({}));
const delegadas = vi.hoisted(() => ({
  agregar: [] as unknown[][],
  nombre: [] as unknown[][],
  estado: [] as unknown[][],
}));
vi.mock("../../apps/web/servidor/presentaciones", () => ({
  agregarLaPresentacion: (...args: unknown[]) => {
    delegadas.agregar.push(args);
    return Promise.resolve({ error: null });
  },
  guardarElNombreDeLaPresentacion: (...args: unknown[]) => {
    delegadas.nombre.push(args);
    return Promise.resolve({ error: null });
  },
  cambiarElEstadoDeLaPresentacionDelProducto: (...args: unknown[]) => {
    delegadas.estado.push(args);
    return Promise.resolve({ error: null });
  },
}));

import * as acciones from "../../apps/web/app/s/app/acciones-de-presentaciones";

describe("las acciones de servidor de las presentaciones expuestas a Next", () => {
  it("exporta solo las tres acciones, asíncronas", () => {
    expect(Object.keys(acciones)).toEqual([
      "crearPresentacionAccion",
      "renombrarPresentacionAccion",
      "cambiarElEstadoDeLaPresentacionAccion",
    ]);
    for (const accion of Object.values(acciones)) {
      expect(accion.constructor.name).toBe("AsyncFunction");
    }
  });

  it("agregar delega con el producto ligado y el formulario, sin el estado anterior", async () => {
    const datos = new FormData();
    datos.set("nombre", "Caja");
    expect(await acciones.crearPresentacionAccion("p-1", { error: null }, datos)).toEqual({
      error: null,
    });
    expect(delegadas.agregar).toEqual([["p-1", datos]]);
  });

  it("renombrar delega con el producto, la presentación y la versión ligados", async () => {
    const datos = new FormData();
    datos.set("nombre", "Caja grande");
    await acciones.renombrarPresentacionAccion("p-1", "a-1", 4, { error: null }, datos);
    expect(delegadas.nombre).toEqual([["p-1", "a-1", 4, datos]]);
  });

  it("desactivar y reactivar delegan con el sentido que fijó la página", async () => {
    await acciones.cambiarElEstadoDeLaPresentacionAccion("p-1", "a-1", 4, false, { error: null });
    await acciones.cambiarElEstadoDeLaPresentacionAccion("p-1", "a-1", 5, true, { error: null });
    expect(delegadas.estado).toEqual([
      ["p-1", "a-1", 4, false],
      ["p-1", "a-1", 5, true],
    ]);
  });
});
