import { describe, expect, it, vi } from "vitest";

/**
 * El archivo `"use server"` de recetas (`apps/web/app/s/app/acciones-de-recetas.ts`): fino a propósito. Exporta dos funciones asíncronas y delega en `servidor/recetas.ts` con lo que ligó la página
 * (producto, versión que se vio y unidades) y el formulario tal cual: la empresa y la persona las fija el servidor, no la acción.
 */
vi.mock("server-only", () => ({}));
const delegadas = vi.hoisted(() => ({ llamadas: [] as unknown[][] }));
vi.mock("../../apps/web/servidor/recetas", () => ({
  guardarLaRecetaDelFormulario: (...args: unknown[]) => {
    delegadas.llamadas.push(["guardar", ...args]);
    return Promise.resolve({ error: null });
  },
  confirmarLaReceta: (...args: unknown[]) => {
    delegadas.llamadas.push(["confirmar", ...args]);
    return Promise.resolve({ error: null, vista: null });
  },
}));

import * as acciones from "../../apps/web/app/s/app/acciones-de-recetas";

const LIGADO = { productoId: "p-1", versionEsperada: 3, unidades: { i1: "KILOGRAMO" } };

describe("las acciones de servidor de recetas expuestas a Next", () => {
  it("exporta solo guardarRecetaAccion y confirmarRecetaAccion, asíncronas", () => {
    expect(Object.keys(acciones)).toEqual(["guardarRecetaAccion", "confirmarRecetaAccion"]);
    expect(acciones.guardarRecetaAccion.constructor.name).toBe("AsyncFunction");
    expect(acciones.confirmarRecetaAccion.constructor.name).toBe("AsyncFunction");
  });

  it("guardar delega con lo ligado y el formulario, sin el estado anterior", async () => {
    const datos = new FormData();
    datos.set("rinde", "10");
    expect(await acciones.guardarRecetaAccion(LIGADO, { error: null }, datos)).toEqual({
      error: null,
    });
    expect(delegadas.llamadas).toEqual([["guardar", LIGADO, datos]]);
  });

  it("confirmar delega con lo ligado y el formulario", async () => {
    delegadas.llamadas.length = 0;
    const datos = new FormData();
    datos.set("rinde", "10");
    expect(await acciones.confirmarRecetaAccion(LIGADO, datos)).toEqual({
      error: null,
      vista: null,
    });
    expect(delegadas.llamadas).toEqual([["confirmar", LIGADO, datos]]);
  });
});
