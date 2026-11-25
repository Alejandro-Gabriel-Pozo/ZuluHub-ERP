import { describe, expect, it, vi } from "vitest";

/**
 * El archivo `"use server"` de los depósitos de stock (`apps/web/app/s/app/acciones-de-depositos.ts`): fino a propósito. Exporta solo las acciones, asíncronas, y delega en
 * `servidor/depositos-de-stock.ts` con lo que la página ligó (identificador del alta, depósito, versión, sentido) y el formulario tal cual: la empresa, la persona y la sucursal las fija el servidor.
 */
vi.mock("server-only", () => ({}));
const delegadas = vi.hoisted(() => ({
  agregar: [] as unknown[][],
  editar: [] as unknown[][],
  estado: [] as unknown[][],
}));
vi.mock("../../apps/web/servidor/depositos-de-stock", () => ({
  agregarElDepositoDeLaSucursal: (...args: unknown[]) => {
    delegadas.agregar.push(args);
    return Promise.resolve({ error: null });
  },
  guardarElDeposito: (...args: unknown[]) => {
    delegadas.editar.push(args);
    return Promise.resolve({ error: null });
  },
  cambiarElEstadoDelDepositoDeLaSucursal: (...args: unknown[]) => {
    delegadas.estado.push(args);
    return Promise.resolve({ error: null });
  },
}));

import * as acciones from "../../apps/web/app/s/app/acciones-de-depositos";

describe("las acciones de servidor de los depósitos de stock expuestas a Next", () => {
  it("exporta solo las tres acciones, asíncronas", () => {
    expect(Object.keys(acciones)).toEqual([
      "agregarDepositoAccion",
      "editarDepositoAccion",
      "cambiarElEstadoDelDepositoAccion",
    ]);
    for (const accion of Object.values(acciones)) {
      expect(accion.constructor.name).toBe("AsyncFunction");
    }
  });

  it("agregar delega con el identificador ligado y el formulario, sin el estado anterior", async () => {
    const datos = new FormData();
    datos.set("nombre", "Cocina");
    expect(await acciones.agregarDepositoAccion("id-1", { error: null }, datos)).toEqual({
      error: null,
    });
    expect(delegadas.agregar).toEqual([["id-1", datos]]);
  });

  it("editar delega con el depósito y la versión que se vio, ligados, y el formulario", async () => {
    const datos = new FormData();
    datos.set("nombre", "Cocina grande");
    await acciones.editarDepositoAccion("d-1", 4, { error: null }, datos);
    expect(delegadas.editar).toEqual([["d-1", 4, datos]]);
  });

  it("desactivar y reactivar delegan con el sentido que fijó la página, sin campos", async () => {
    await acciones.cambiarElEstadoDelDepositoAccion("d-1", false, { error: null });
    await acciones.cambiarElEstadoDelDepositoAccion("d-1", true, { error: null });
    expect(delegadas.estado).toEqual([
      ["d-1", false],
      ["d-1", true],
    ]);
  });
});
