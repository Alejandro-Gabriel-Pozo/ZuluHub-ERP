import { describe, expect, it, vi } from "vitest";

/**
 * El archivo `"use server"` del contacto de la sucursal (`apps/web/app/s/app/acciones-de-contacto-de-sucursal.ts`): fino a propósito.
 * Exporta una sola función asíncrona y delega en `servidor/contacto-de-sucursal.ts` con el pedido tal cual:
 * la sucursal la fija el servidor, no la acción.
 */
vi.mock("server-only", () => ({}));
const delegadas = vi.hoisted(() => ({ llamadas: [] as unknown[] }));
vi.mock("../../apps/web/servidor/contacto-de-sucursal", () => ({
  guardarElContactoDeLaSucursal: (entrada: unknown) => {
    delegadas.llamadas.push(entrada);
    return Promise.resolve({ ok: true, dato: { version: 4 } });
  },
}));

import * as acciones from "../../apps/web/app/s/app/acciones-de-contacto-de-sucursal";

describe("la acción de servidor del contacto de la sucursal expuesta a Next", () => {
  it("exporta solo guardarContactoDeSucursalAccion, asíncrona", () => {
    expect(Object.keys(acciones)).toEqual(["guardarContactoDeSucursalAccion"]);
    expect(acciones.guardarContactoDeSucursalAccion.constructor.name).toBe("AsyncFunction");
  });

  it("delega con el pedido tal cual y devuelve la respuesta", async () => {
    const entrada = { versionEsperada: 3, web: "x.com", sucursalId: "no-se-toca-acá" };
    expect(await acciones.guardarContactoDeSucursalAccion(entrada)).toEqual({
      ok: true,
      dato: { version: 4 },
    });
    expect(delegadas.llamadas).toEqual([entrada]);
  });
});
