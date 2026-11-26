import { describe, expect, it, vi } from "vitest";

/**
 * El archivo `"use server"` de producción (`apps/web/app/s/app/acciones-de-produccion.ts`): fino a propósito. Exporta tres funciones asíncronas y delega en `servidor/produccion.ts` con el
 * id de la orden que ligó la página y el formulario tal cual: la empresa, la persona y la sucursal las fija el servidor, no la acción.
 */
vi.mock("server-only", () => ({}));
const delegadas = vi.hoisted(() => ({ llamadas: [] as unknown[][] }));
vi.mock("../../apps/web/servidor/produccion", () => ({
  abrirLaOrdenDelFormulario: (...args: unknown[]) => {
    delegadas.llamadas.push(["abrir", ...args]);
    return Promise.resolve({ error: null });
  },
  cancelarLaOrdenDeLaFicha: (...args: unknown[]) => {
    delegadas.llamadas.push(["cancelar", ...args]);
    return Promise.resolve({ error: null });
  },
  anularLaOrdenDeLaFicha: (...args: unknown[]) => {
    delegadas.llamadas.push(["anular", ...args]);
    return Promise.resolve({ error: null });
  },
}));

import * as acciones from "../../apps/web/app/s/app/acciones-de-produccion";

describe("las acciones de servidor de producción expuestas a Next", () => {
  it("exporta solo cancelarOrdenAccion, anularOrdenAccion y abrirOrdenAccion, asíncronas", () => {
    expect(Object.keys(acciones)).toEqual([
      "cancelarOrdenAccion",
      "anularOrdenAccion",
      "abrirOrdenAccion",
    ]);
    expect(acciones.abrirOrdenAccion.constructor.name).toBe("AsyncFunction");
    expect(acciones.cancelarOrdenAccion.constructor.name).toBe("AsyncFunction");
    expect(acciones.anularOrdenAccion.constructor.name).toBe("AsyncFunction");
  });

  it("cancelar delega con el id y el formulario, sin el estado anterior", async () => {
    const datos = new FormData();
    datos.set("motivo", "Se rompió el horno");
    expect(await acciones.cancelarOrdenAccion("orden-1", { error: null }, datos)).toEqual({
      error: null,
    });
    expect(delegadas.llamadas).toEqual([["cancelar", "orden-1", datos]]);
  });

  it("anular delega con el id y el formulario, sin el estado anterior", async () => {
    delegadas.llamadas.length = 0;
    const datos = new FormData();
    datos.set("motivo", "Error de carga");
    expect(await acciones.anularOrdenAccion("orden-2", { error: null }, datos)).toEqual({
      error: null,
    });
    expect(delegadas.llamadas).toEqual([["anular", "orden-2", datos]]);
  });

  it("abrir delega con la clave que ligó la página y el formulario, sin el estado anterior", async () => {
    delegadas.llamadas.length = 0;
    const datos = new FormData();
    datos.set("productoId", "p-1");
    datos.set("cantidad", "16");
    expect(await acciones.abrirOrdenAccion("clave-1", { error: null }, datos)).toEqual({
      error: null,
    });
    expect(delegadas.llamadas).toEqual([["abrir", "clave-1", datos]]);
  });
});
