import { describe, expect, it, vi } from "vitest";

/**
 * El archivo `"use server"` de la clasificación (`apps/web/app/s/app/acciones-de-clasificacion.ts`): fino a propósito. Exporta seis funciones asíncronas y cada una delega, con el pedido tal
 * cual, en `servidor/clasificacion.ts`: la empresa y la persona las fija el servidor, no la acción.
 */
vi.mock("server-only", () => ({}));
const { delegadas, delegar } = vi.hoisted(() => {
  const delegadas = { llamadas: [] as { que: string; entrada: unknown }[] };
  const delegar = (que: string) => (entrada: unknown) => {
    delegadas.llamadas.push({ que, entrada });
    return Promise.resolve({ ok: true, dato: { que } });
  };
  return { delegadas, delegar };
});
vi.mock("../../apps/web/servidor/clasificacion", () => ({
  crearElNodoDeClasificacion: delegar("crear"),
  renombrarElNodoDeClasificacion: delegar("renombrar"),
  moverElNodoDeClasificacion: delegar("mover"),
  desactivarElNodoDeClasificacion: delegar("desactivar"),
  reactivarElNodoDeClasificacion: delegar("reactivar"),
  clasificarElProducto: delegar("clasificar"),
}));

import * as acciones from "../../apps/web/app/s/app/acciones-de-clasificacion";

describe("las acciones de servidor de la clasificación expuestas a Next", () => {
  it("exportan solo estas seis, asíncronas", () => {
    expect(Object.keys(acciones)).toEqual([
      "crearNodoDeClasificacionAccion",
      "renombrarNodoDeClasificacionAccion",
      "moverNodoDeClasificacionAccion",
      "desactivarNodoDeClasificacionAccion",
      "reactivarNodoDeClasificacionAccion",
      "clasificarProductoAccion",
    ]);
    for (const f of Object.values(acciones)) expect(f.constructor.name).toBe("AsyncFunction");
  });

  it.each([
    ["crear", acciones.crearNodoDeClasificacionAccion],
    ["renombrar", acciones.renombrarNodoDeClasificacionAccion],
    ["mover", acciones.moverNodoDeClasificacionAccion],
    ["desactivar", acciones.desactivarNodoDeClasificacionAccion],
    ["reactivar", acciones.reactivarNodoDeClasificacionAccion],
    ["clasificar", acciones.clasificarProductoAccion],
  ] as const)("%s delega con el pedido tal cual y devuelve su respuesta", async (que, accion) => {
    delegadas.llamadas = [];
    const pedido = { cualquiera: 1 };
    expect(await accion(pedido)).toEqual({ ok: true, dato: { que } });
    expect(delegadas.llamadas).toEqual([{ que, entrada: pedido }]);
  });
});
