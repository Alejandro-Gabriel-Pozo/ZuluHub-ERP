import { describe, expect, it, vi } from "vitest";

/**
 * El archivo `"use server"` de «Conectá tu cuenta de fotos» (`apps/web/app/s/app/acciones-de-cuentas-de-fotos.ts`): fino a propósito. Exporta funciones asíncronas y delega en `servidor/cuentas-de-fotos.ts` con
 * lo que ligó la página (la clave del gesto; la cuenta y su versión) y el formulario tal cual: la empresa y la persona las fija el servidor, no la acción.
 */
vi.mock("server-only", () => ({}));
const delegadas = vi.hoisted(() => ({
  llamadas: [] as unknown[][],
  delegar:
    (que: string) =>
    (...args: unknown[]) => {
      delegadas.llamadas.push([que, ...args]);
      return Promise.resolve({ error: null });
    },
}));
vi.mock("../../apps/web/servidor/cuentas-de-fotos", () => ({
  declararLaCuenta: delegadas.delegar("declarar"),
  retirarLaCuenta: delegadas.delegar("retirar"),
}));

import * as acciones from "../../apps/web/app/s/app/acciones-de-cuentas-de-fotos";

const previo = { error: null };

describe("las acciones de servidor de «Conectá tu cuenta de fotos» expuestas a Next", () => {
  it("exporta solo las dos acciones, asíncronas", () => {
    expect(Object.keys(acciones)).toEqual(["declararLaCuentaAccion", "retirarLaCuentaAccion"]);
    for (const accion of Object.values(acciones))
      expect(accion.constructor.name).toBe("AsyncFunction");
  });

  it("declarar delega con la clave que ligó la página y el formulario, sin el estado anterior", async () => {
    const ligado = { claveDeIdempotencia: "k".repeat(36) };
    const datos = new FormData();
    datos.set("cuenta", "mi-hotel");
    delegadas.llamadas.length = 0;
    expect(await acciones.declararLaCuentaAccion(ligado, previo, datos)).toEqual({ error: null });
    expect(delegadas.llamadas).toEqual([["declarar", ligado, datos]]);
  });

  it("retirar delega con la cuenta y la versión que ligó la página y el motivo del formulario", async () => {
    const ligado = { id: "c-1", versionEsperada: 3 };
    const datos = new FormData();
    datos.set("motivo", "Cerramos la cuenta");
    delegadas.llamadas.length = 0;
    expect(await acciones.retirarLaCuentaAccion(ligado, previo, datos)).toEqual({ error: null });
    expect(delegadas.llamadas).toEqual([["retirar", ligado, datos]]);
  });
});
