import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok } from "../../src/primitivas/resultado/resultado";

/**
 * `apps/web/servidor/recetas.ts`: la empresa y la persona las fija el SERVIDOR (el contexto que llega ya armado) y del navegador solo viene lo que dice la dirección (el filtro, la página y
 * el id). La composición es la real (`src/composicion/recetas-web.ts`); las consultas son falsas (con la base real se prueban en `test/integracion/recetas-web.test.ts`). Es solo lectura: no
 * hay casos de uso que escriban. Previene: pedir una receta con la empresa o la sucursal que diga el navegador, y que un id que no es un UUID llegue a la consulta.
 */
vi.mock("server-only", () => ({}));
const CONTEXTO = { empresaId: "empresa-de-la-sesion" };
const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const mundo = vi.hoisted(
  (): { listados: unknown[][]; recetas: unknown[][]; cocinas: unknown[][] } => ({
    listados: [],
    recetas: [],
    cocinas: [],
  }),
);
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    consultasDeStock: () => ({
      listarRecetas: (...a: unknown[]) => {
        mundo.listados.push(a);
        return Promise.resolve(ok({ recetas: [], siguiente: null }));
      },
      recetaDeProducto: (...a: unknown[]) => {
        mundo.recetas.push(a);
        return Promise.resolve(ok(null));
      },
      fichaDeCocina: (...a: unknown[]) => {
        mundo.cocinas.push(a);
        return Promise.resolve(ok(null));
      },
    }),
    consultasDeIdentidad: () => ({}),
  },
}));
vi.mock("../../apps/web/servidor/sesion", () => ({
  dependenciasDeSesion: {
    respuesta: { registrar: () => undefined, azar: () => new Uint8Array(4) },
  },
}));

import {
  cargarLaFichaDeCocina,
  cargarLaReceta,
  cargarLasRecetas,
} from "../../apps/web/servidor/recetas";

beforeEach(() => {
  Object.assign(mundo, { listados: [], recetas: [], cocinas: [] });
});

describe("la lista de recetas", () => {
  it("pide con el contexto del servidor y el filtro de la dirección, sin sucursal", async () => {
    const r = await cargarLasRecetas(CONTEXTO as never, {
      texto: "",
      conReceta: "sin",
      activo: "",
      despues: "",
    });
    expect(r).toEqual({ ok: true, dato: { recetas: [], siguiente: null } });
    expect(mundo.listados).toEqual([[CONTEXTO, { conReceta: false }]]);
  });

  it("un filtro que ninguna receta puede cumplir es una página vacía y no consulta", async () => {
    const r = await cargarLasRecetas(CONTEXTO as never, {
      texto: "",
      conReceta: "cualquiera",
      activo: "",
      despues: "",
    });
    expect(r).toEqual({ ok: true, dato: { recetas: [], siguiente: null } });
    expect(mundo.listados).toEqual([]);
  });
});

describe("una receta y su ficha de cocina", () => {
  it("piden el producto de la dirección con el contexto del servidor", async () => {
    expect(await cargarLaReceta(CONTEXTO as never, ID)).toEqual({ ok: true, dato: null });
    expect(await cargarLaFichaDeCocina(CONTEXTO as never, ID)).toEqual({ ok: true, dato: null });
    expect(mundo.recetas).toEqual([[CONTEXTO, { productoId: ID }]]);
    expect(mundo.cocinas).toEqual([[CONTEXTO, { productoId: ID }]]);
  });

  it("un id que no es un UUID es «no existe» y no llega a la consulta", async () => {
    expect(await cargarLaReceta(CONTEXTO as never, "../../etc/passwd")).toEqual({
      ok: true,
      dato: null,
    });
    expect(await cargarLaFichaDeCocina(CONTEXTO as never, "no-es-un-uuid")).toEqual({
      ok: true,
      dato: null,
    });
    expect(mundo.recetas).toEqual([]);
    expect(mundo.cocinas).toEqual([]);
  });
});
