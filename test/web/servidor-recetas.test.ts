import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "../../src/primitivas/resultado/resultado";

/**
 * `apps/web/servidor/recetas.ts`: la empresa y la persona las fija el SERVIDOR (el contexto que llega ya armado) y del navegador solo viene lo que dice la dirección (el filtro, la página y
 * el id). La composición es la real (`src/composicion/recetas-web.ts`); las consultas son falsas (con la base real se prueban en `test/integracion/recetas-web.test.ts`). Es solo lectura: no
 * hay casos de uso que escriban. Previene: pedir una receta con la empresa o la sucursal que diga el navegador, y que un id que no es un UUID llegue a la consulta.
 */
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`NEXT_REDIRECT ${destino}`);
  },
}));
vi.mock("next/cache", () => ({
  revalidatePath: (ruta: string) => {
    mundo.revalidadas.push(ruta);
  },
}));
const CONTEXTO = { empresaId: "empresa-de-la-sesion" };
const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const mundo = vi.hoisted(
  (): {
    listados: unknown[][];
    recetas: unknown[][];
    cocinas: unknown[][];
    guardados: unknown[][];
    vistas: unknown[][];
    revalidadas: string[];
    guardado: unknown;
  } => ({
    listados: [],
    recetas: [],
    cocinas: [],
    guardados: [],
    vistas: [],
    revalidadas: [],
    guardado: null,
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
      vistaPreviaDeReceta: (...a: unknown[]) => {
        mundo.vistas.push(a);
        return Promise.resolve(ok({ componentes: [{ productoId: OTRO, neto: "2.2500" }] }));
      },
      fichaDeCocina: (...a: unknown[]) => {
        mundo.cocinas.push(a);
        return Promise.resolve(ok(null));
      },
    }),
    consultasDeIdentidad: () => ({}),
    casosDeUsoDeStock: () => ({
      guardarComposicion: (...a: unknown[]) => {
        mundo.guardados.push(a);
        return Promise.resolve(mundo.guardado);
      },
    }),
  },
}));
vi.mock("../../apps/web/servidor/con-la-empresa", () => ({
  conLaEmpresa: (hacer: (contexto: unknown) => unknown) => hacer(CONTEXTO),
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
  confirmarLaReceta,
  guardarLaRecetaDelFormulario,
} from "../../apps/web/servidor/recetas";

const OTRO = "1c0a7b2f-3d4e-4f60-9b8c-0d1e2f3a4b5c";
const formulario = (campos: Record<string, string>): FormData => {
  const datos = new FormData();
  for (const [nombre, valor] of Object.entries(campos)) datos.set(nombre, valor);
  return datos;
};
const LIGADO = { productoId: ID, versionEsperada: 2, unidades: { [OTRO]: "KILOGRAMO" } };
const CAMPOS = {
  rinde: "10",
  pasos: "Hornear.",
  receta_l1_ingrediente: OTRO,
  receta_l1_bruto: "2.5",
  receta_l1_merma: "10",
};
const ENTRADA = {
  productoId: ID,
  versionEsperada: 2,
  rinde: "10",
  pasos: "Hornear.",
  componentes: [{ productoId: OTRO, cantidad: "2.5", unidadId: "KILOGRAMO", perdida: "10" }],
};

beforeEach(() => {
  Object.assign(mundo, {
    listados: [],
    recetas: [],
    cocinas: [],
    guardados: [],
    vistas: [],
    revalidadas: [],
    guardado: ok({ version: 3, yaExistia: false }),
  });
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

describe("guardar la receta", () => {
  it("la empresa, la versión que se vio y las unidades las fija el servidor; del formulario solo el rinde, los pasos y las líneas", async () => {
    await expect(guardarLaRecetaDelFormulario(LIGADO, formulario(CAMPOS))).rejects.toThrow(
      `NEXT_REDIRECT /catalogo/recetas/${ID}`,
    );
    expect(mundo.guardados).toEqual([[CONTEXTO, ENTRADA]]);
    expect(mundo.revalidadas).toEqual(["/catalogo/recetas", `/catalogo/recetas/${ID}`]);
  });

  it("lo que el navegador mande de más no cuenta: ni el producto (al editar), ni otra versión, ni otra unidad, ni la empresa", async () => {
    await expect(
      guardarLaRecetaDelFormulario(
        LIGADO,
        formulario({
          ...CAMPOS,
          producto: OTRO,
          productoId: OTRO,
          versionEsperada: "99",
          empresaId: "otra",
          unidades: "GRAMO",
          receta_l1_unidad: "GRAMO",
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(mundo.guardados).toEqual([[CONTEXTO, ENTRADA]]);
  });

  it("al crear, el producto viene del formulario y la versión que se vio es 0", async () => {
    await expect(
      guardarLaRecetaDelFormulario(
        { productoId: null, versionEsperada: 0, unidades: { [OTRO]: "KILOGRAMO" } },
        formulario({ ...CAMPOS, producto: ID }),
      ),
    ).rejects.toThrow(`NEXT_REDIRECT /catalogo/recetas/${ID}`);
    expect(mundo.guardados[0]?.[1]).toMatchObject({ productoId: ID, versionEsperada: 0 });
  });

  it("un ingrediente sin unidad fijada por el servidor, o sin producto al crear, es el genérico y no guarda", async () => {
    expect(
      await guardarLaRecetaDelFormulario({ ...LIGADO, unidades: {} }, formulario(CAMPOS)),
    ).toMatchObject({ error: { codigo: "RECETA_ACCION_NO_PERMITIDA" } });
    expect(
      await guardarLaRecetaDelFormulario(
        { productoId: null, versionEsperada: 0, unidades: LIGADO.unidades },
        formulario(CAMPOS),
      ),
    ).toMatchObject({ error: { codigo: "RECETA_ACCION_NO_PERMITIDA" } });
    expect(mundo.guardados).toEqual([]);
  });

  it("si el servidor rechaza, devuelve el error ya traducido, no redirige y pide la lista de nuevo", async () => {
    mundo.guardado = err("COMPOSICION_DESACTUALIZADA");
    const r = await guardarLaRecetaDelFormulario(LIGADO, formulario(CAMPOS));
    expect(r).toMatchObject({ error: { codigo: "RECETA_ACCION_NO_PERMITIDA" } });
    expect(mundo.revalidadas).toEqual(["/catalogo/recetas"]);
  });
});

describe("la confirmación antes de guardar", () => {
  it("calcula con lo mismo que se guardaría y no guarda nada", async () => {
    const r = await confirmarLaReceta(LIGADO, formulario(CAMPOS));
    expect(r).toEqual({ error: null, vista: { netos: { [OTRO]: "2.2500" } } });
    expect(mundo.vistas).toEqual([
      [CONTEXTO, { productoId: ID, rinde: "10", componentes: ENTRADA.componentes }],
    ]);
    expect(mundo.guardados).toEqual([]);
  });

  it("un pedido sin la forma pedida devuelve el error genérico y no consulta", async () => {
    const r = await confirmarLaReceta({ ...LIGADO, unidades: {} }, formulario(CAMPOS));
    expect(r).toMatchObject({ error: { codigo: "RECETA_ACCION_NO_PERMITIDA" } });
    expect(mundo.vistas).toEqual([]);
  });
});
