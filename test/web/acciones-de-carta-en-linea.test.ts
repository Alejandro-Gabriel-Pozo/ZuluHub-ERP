import { describe, expect, it, vi } from "vitest";

/**
 * El archivo `"use server"` de «Carta en línea» (`apps/web/app/s/app/acciones-de-carta-en-linea.ts`): fino a propósito. Exporta funciones asíncronas y delega en `servidor/carta-en-linea.ts` con lo que
 * ligó la página (la carta o su clave de creación, la sucursal mostrada, la versión vista, el estado pedido) y el formulario tal cual: la empresa y la persona las fija el servidor, no la acción.
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
vi.mock("../../apps/web/servidor/carta-en-linea", () => ({
  guardarLosTextosDeLaCarta: delegadas.delegar("guardar"),
  cambiarElEstadoDeLaCarta: delegadas.delegar("estado"),
}));

import * as acciones from "../../apps/web/app/s/app/acciones-de-carta-en-linea";

const previo = { error: null };

describe("las acciones de servidor de «Carta en línea» expuestas a Next", () => {
  it("exporta solo las dos acciones, asíncronas", () => {
    expect(Object.keys(acciones)).toEqual(["guardarLosTextosAccion", "estadoDeLaCartaAccion"]);
    for (const accion of Object.values(acciones))
      expect(accion.constructor.name).toBe("AsyncFunction");
  });

  it("guardar delega con lo que ligó la página y el formulario, sin el estado anterior", async () => {
    const ligado = { cartaId: "c-1", sucursalId: "s-1", versionEsperada: null };
    const datos = new FormData();
    datos.set("nombre", "Parador");
    delegadas.llamadas.length = 0;
    expect(await acciones.guardarLosTextosAccion(ligado, previo, datos)).toEqual({ error: null });
    expect(delegadas.llamadas).toEqual([["guardar", ligado, datos]]);
  });

  it("poner o sacar delega con el estado que pidió la página (no viaja en el formulario), sin el estado anterior", async () => {
    const ligado = {
      cartaId: "c-1",
      sucursalId: "s-1",
      versionEsperada: 3,
      estado: "EN_LINEA" as const,
    };
    delegadas.llamadas.length = 0;
    expect(await acciones.estadoDeLaCartaAccion(ligado, previo)).toEqual({ error: null });
    expect(delegadas.llamadas).toEqual([["estado", ligado]]);
  });
});
