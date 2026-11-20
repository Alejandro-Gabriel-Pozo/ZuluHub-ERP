import { describe, expect, it, vi } from "vitest";

/**
 * El archivo `"use server"` de las opciones (`apps/web/app/s/app/acciones-de-opciones.ts`): fino a propósito. Exporta dos funciones asíncronas y delega en `servidor/opciones.ts` con
 * lo que la página ligó (producto, versión de las opciones, grupo, clave del cambio, ids de las opciones vistas) y el formulario tal cual: la empresa y la persona las fija el servidor.
 */
vi.mock("server-only", () => ({}));
const delegadas = vi.hoisted(() => ({ guardar: [] as unknown[][], copiar: [] as unknown[][] }));
vi.mock("../../apps/web/servidor/opciones", () => ({
  guardarElGrupo: (...args: unknown[]) => {
    delegadas.guardar.push(args);
    return Promise.resolve({ error: null });
  },
  copiarLasOpciones: (...args: unknown[]) => {
    delegadas.copiar.push(args);
    return Promise.resolve({ error: null });
  },
}));

import * as acciones from "../../apps/web/app/s/app/acciones-de-opciones";

describe("las acciones de servidor de las opciones expuestas a Next", () => {
  it("exporta solo guardarGrupoAccion y copiarOpcionesAccion, asíncronas", () => {
    expect(Object.keys(acciones)).toEqual(["guardarGrupoAccion", "copiarOpcionesAccion"]);
    expect(acciones.guardarGrupoAccion.constructor.name).toBe("AsyncFunction");
    expect(acciones.copiarOpcionesAccion.constructor.name).toBe("AsyncFunction");
  });

  it("guardar delega con lo ligado por la página y el formulario, sin el estado anterior", async () => {
    const datos = new FormData();
    datos.set("nombre", "Agregados");
    expect(
      await acciones.guardarGrupoAccion(
        "p-1",
        4,
        "g-1",
        "clave-1",
        ["o-1", "o-2"],
        { error: null },
        datos,
      ),
    ).toEqual({ error: null });
    expect(delegadas.guardar).toEqual([
      [
        {
          productoId: "p-1",
          versionDeOpciones: 4,
          grupoId: "g-1",
          claveDelCambio: "clave-1",
          idsDeOpciones: ["o-1", "o-2"],
        },
        datos,
      ],
    ]);
  });

  it("un grupo nuevo se liga con grupo nulo", async () => {
    delegadas.guardar.length = 0;
    await acciones.guardarGrupoAccion(
      "p-1",
      0,
      null,
      "clave-1",
      [],
      { error: null },
      new FormData(),
    );
    expect(delegadas.guardar[0]?.[0]).toMatchObject({ grupoId: null, idsDeOpciones: [] });
  });

  it("copiar delega con el producto, la versión, la clave de la copia y el formulario, sin el estado anterior", async () => {
    const datos = new FormData();
    datos.set("productoOrigenId", "o-1");
    expect(
      await acciones.copiarOpcionesAccion("p-1", 4, "clave-copia", { error: null }, datos),
    ).toEqual({ error: null });
    expect(delegadas.copiar).toEqual([["p-1", 4, "clave-copia", datos]]);
  });
});
