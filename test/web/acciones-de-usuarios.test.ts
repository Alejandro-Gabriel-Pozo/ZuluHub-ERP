import { describe, expect, it, vi } from "vitest";

/**
 * El archivo `"use server"` de «Usuarios» (`apps/web/app/s/app/acciones-de-usuarios.ts`): fino a propósito. Exporta funciones asíncronas y delega en `servidor/usuarios.ts` con el id que ligó la página
 * (`.bind`): la empresa y quien pide las fija el servidor, y la acción no acepta ni rol ni email del navegador (el estado anterior que pasa `useActionState` se descarta).
 */
vi.mock("server-only", () => ({}));
const delegadas = vi.hoisted(() => ({
  llamadas: [] as unknown[][],
}));
vi.mock("../../apps/web/servidor/usuarios", () => ({
  desactivarElUsuario: (...args: unknown[]) => {
    delegadas.llamadas.push(["desactivar", ...args]);
    return Promise.resolve({ error: null });
  },
}));

import * as acciones from "../../apps/web/app/s/app/acciones-de-usuarios";

describe("las acciones de servidor de «Usuarios» expuestas a Next", () => {
  it("exporta solo la acción de desactivar, asíncrona", () => {
    expect(Object.keys(acciones)).toEqual(["desactivarUsuarioAccion"]);
    expect(acciones.desactivarUsuarioAccion.constructor.name).toBe("AsyncFunction");
  });

  it("desactivar delega SOLO con el id que ligó la página, sin el estado anterior", async () => {
    delegadas.llamadas.length = 0;
    const previo = { error: null };
    expect(await acciones.desactivarUsuarioAccion("persona-1", previo)).toEqual({ error: null });
    expect(delegadas.llamadas).toEqual([["desactivar", "persona-1"]]);
  });

  it("con .bind (como la arma la página) lo único que falta es el estado anterior", async () => {
    delegadas.llamadas.length = 0;
    const accion = acciones.desactivarUsuarioAccion.bind(null, "persona-2");
    await accion({ error: null });
    expect(delegadas.llamadas).toEqual([["desactivar", "persona-2"]]);
  });
});
