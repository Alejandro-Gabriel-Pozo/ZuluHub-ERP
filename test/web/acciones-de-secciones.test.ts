import { describe, expect, it, vi } from "vitest";

/**
 * El archivo `"use server"` de las secciones de la carta (`apps/web/app/s/app/acciones-de-secciones.ts`): fino a propósito. Exporta funciones asíncronas y delega en `servidor/secciones.ts`
 * con lo que ligó la página (la clave de creación, la sección y su versión, las secciones que se vieron) y el formulario tal cual: la empresa y la persona las fija el servidor, no la acción.
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
vi.mock("../../apps/web/servidor/secciones", () => ({
  darDeAltaLaSeccion: delegadas.delegar("alta"),
  guardarElNombreDeLaSeccion: delegadas.delegar("nombre"),
  moverLaSeccion: delegadas.delegar("mover"),
  cambiarElEstadoDeLaSeccionDeCarta: delegadas.delegar("estado"),
  quitarElProductoDeLaSeccion: delegadas.delegar("quitar"),
  agregarElProductoALaSeccion: delegadas.delegar("agregar"),
}));

import * as acciones from "../../apps/web/app/s/app/acciones-de-secciones";

const previo = { error: null };

describe("las acciones de servidor de las secciones expuestas a Next", () => {
  it("exporta solo las siete acciones, asíncronas", () => {
    expect(Object.keys(acciones)).toEqual([
      "crearSeccionAccion",
      "renombrarSeccionAccion",
      "moverSeccionAccion",
      "desactivarSeccionAccion",
      "reactivarSeccionAccion",
      "quitarProductoDeSeccionAccion",
      "agregarProductoASeccionAccion",
    ]);
    for (const accion of Object.values(acciones)) {
      expect(accion.constructor.name).toBe("AsyncFunction");
    }
  });

  it("el alta delega con la clave de creación que ligó la página y el formulario, sin el estado anterior", async () => {
    const datos = new FormData();
    datos.set("nombre", "Cafés");
    delegadas.llamadas.length = 0;
    expect(await acciones.crearSeccionAccion("clave-1", previo, datos)).toEqual({ error: null });
    expect(delegadas.llamadas).toEqual([["alta", "clave-1", datos]]);
  });

  it("renombrar delega con la sección, la versión que se vio y el formulario, sin el estado anterior", async () => {
    const datos = new FormData();
    datos.set("nombre", "Cafetería");
    delegadas.llamadas.length = 0;
    expect(await acciones.renombrarSeccionAccion("s-1", 4, previo, datos)).toEqual({ error: null });
    expect(delegadas.llamadas).toEqual([["nombre", "s-1", 4, datos]]);
  });

  it("«Quitar» y «Agregar producto» delegan con la sección, los productos que se vieron y el formulario, sin el estado anterior", async () => {
    const vistas = [{ productoId: "p-1", versionEsperada: 4 }];
    const datos = new FormData();
    datos.set("quitar", "p-1");
    delegadas.llamadas.length = 0;
    expect(await acciones.quitarProductoDeSeccionAccion("s-1", vistas, previo, datos)).toEqual({
      error: null,
    });
    expect(await acciones.agregarProductoASeccionAccion("s-1", vistas, previo, datos)).toEqual({
      error: null,
    });
    expect(delegadas.llamadas).toEqual([
      ["quitar", "s-1", vistas, datos],
      ["agregar", "s-1", vistas, datos],
    ]);
  });

  it("una flecha delega con las secciones que se vieron y el formulario, sin el estado anterior", async () => {
    const vistas = [{ seccionId: "s-1", versionEsperada: 4 }];
    const datos = new FormData();
    datos.set("subir", "s-1");
    delegadas.llamadas.length = 0;
    expect(await acciones.moverSeccionAccion(vistas, previo, datos)).toEqual({ error: null });
    expect(delegadas.llamadas).toEqual([["mover", vistas, datos]]);
  });

  it("desactivar y reactivar delegan con la sección y el estado que piden, sin el estado anterior", async () => {
    delegadas.llamadas.length = 0;
    await acciones.desactivarSeccionAccion("s-1", previo);
    await acciones.reactivarSeccionAccion("s-2", previo);
    expect(delegadas.llamadas).toEqual([
      ["estado", "s-1", false],
      ["estado", "s-2", true],
    ]);
  });
});
