import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeCodigo, type Respuesta } from "../../src/capacidades/experiencia/respuesta";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * Las páginas de Recetas (lista, ficha y ficha de cocina): leen lo único que viene de la dirección (el filtro, la página y el id), piden al servidor con el contexto de la empresa y pintan
 * cada situación con su texto del catálogo: la lista con sus filtros y sus filas, la ficha con o sin costos según lo que trajo la consulta, la cocina sin costos, y los errores (el del guard
 * con su motivo; el genérico para un producto que no está; el inesperado con la referencia y sin el código crudo). Un solo `h1`. Solo lectura: ni formularios ni campos.
 */
vi.mock("server-only", () => ({}));
const mundo = vi.hoisted(
  (): {
    pedidos: { quien: string; contexto: unknown; dato: unknown }[];
    lista: unknown;
    receta: unknown;
    cocina: unknown;
  } => ({ pedidos: [], lista: null, receta: null, cocina: null }),
);
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    consultasDeEmpresas: () => ({
      permisosDelActor: () =>
        Promise.resolve({
          ok: true,
          valor: { acciones: [], modulos: { activos: [], enSoloLectura: [] } },
        }),
    }),
  },
}));
vi.mock("../../apps/web/servidor/recetas", () => ({
  cargarLasRecetas: (contexto: unknown, entrada: unknown) => {
    mundo.pedidos.push({ quien: "lista", contexto, dato: entrada });
    return Promise.resolve(mundo.lista);
  },
  cargarLaReceta: (contexto: unknown, id: string) => {
    mundo.pedidos.push({ quien: "receta", contexto, dato: id });
    return Promise.resolve(mundo.receta);
  },
  cargarLaFichaDeCocina: (contexto: unknown, id: string) => {
    mundo.pedidos.push({ quien: "cocina", contexto, dato: id });
    return Promise.resolve(mundo.cocina);
  },
}));
vi.mock("../../apps/web/servidor/sesion", () => ({
  dependenciasDeSesion: {},
  empresaDelPedido: () =>
    Promise.resolve({
      puerta: { marca: { nombre: "Marca de prueba" } },
      entrada: {
        ok: true,
        dato: {
          tipo: "ENTRA",
          empresa: { nombre: "Empresa de prueba" },
          contexto: { id: "contexto" },
        },
      },
    }),
}));

const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const BASE = "../../apps/web/app/s/app/(operacion)/catalogo/recetas";
const RUTA_DE_LA_LISTA = `${BASE}/page`;
const RUTA_DE_LA_FICHA = `${BASE}/[productoId]/page`;
const RUTA_DE_LA_COCINA = `${BASE}/[productoId]/cocina/page`;

type Params = Record<string, string | string[] | undefined>;
const cargarLista = (): Promise<{
  default: (p: { searchParams: Promise<Params> }) => Promise<unknown>;
}> => import(/* @vite-ignore */ RUTA_DE_LA_LISTA);
const cargarFicha = (): Promise<{
  default: (p: { params: Promise<{ productoId: string }> }) => Promise<unknown>;
}> => import(/* @vite-ignore */ RUTA_DE_LA_FICHA);
const cargarCocina = (): Promise<{
  default: (p: { params: Promise<{ productoId: string }> }) => Promise<unknown>;
}> => import(/* @vite-ignore */ RUTA_DE_LA_COCINA);

const htmlDeLaLista = async (params: Params = {}) => {
  const { default: Pagina } = await cargarLista();
  return renderToStaticMarkup(
    (await Pagina({ searchParams: Promise.resolve(params) })) as ReactNode,
  );
};
const htmlDeLaFicha = async (productoId = ID) => {
  const { default: Pagina } = await cargarFicha();
  return renderToStaticMarkup(
    (await Pagina({ params: Promise.resolve({ productoId }) })) as ReactNode,
  );
};
const htmlDeLaCocina = async (productoId = ID) => {
  const { default: Pagina } = await cargarCocina();
  return renderToStaticMarkup(
    (await Pagina({ params: Promise.resolve({ productoId }) })) as ReactNode,
  );
};
const aTexto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const titulos = (html: string) => [...html.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)].map((m) => m[1]);

const LISTA = {
  recetas: [
    {
      productoId: ID,
      nombre: "Pizza",
      claseDeUso: "VENDIBLE",
      activo: true,
      version: 3,
      costoPorUnidad: "300.500000",
      moneda: "ARS",
    },
    {
      productoId: "22222222-2222-4222-8222-222222222222",
      nombre: "Flan",
      claseDeUso: "VENDIBLE",
      activo: true,
      version: null,
    },
  ],
  siguiente: null,
};
const RECETA = {
  producto: { id: ID, nombre: "Pizza", claseDeUso: "VENDIBLE", activo: true },
  ultimaVersion: 3,
  ficha: {
    productoId: ID,
    version: 3,
    esLaVigente: true,
    rinde: "10.0000",
    pasos: "Amasar y hornear.",
    componentes: [
      {
        numero: 1,
        productoId: "p1",
        nombre: "Harina",
        tipo: "ARTICULO",
        clase: "MATERIA_PRIMA",
        bruto: "2.5000",
        unidadId: "KILOGRAMO",
        merma: "0.0000",
        neto: "2.5000",
        noEntraAlCosto: false,
        costo: "1500.000000",
      },
    ],
    costos: {
      moneda: "ARS",
      total: "3005.000000",
      porUnidad: "300.500000",
      incompleto: false,
      sinCosto: [],
    },
  },
};
const COCINA = {
  productoId: ID,
  version: 3,
  rinde: "10.0000",
  pasos: "Amasar y hornear.",
  componentes: [
    {
      productoId: "p1",
      nombre: "Harina",
      tipo: "ARTICULO",
      cantidad: "2.5000",
      unidadId: "KILOGRAMO",
    },
  ],
};
const responde = (que: "lista" | "receta" | "cocina", r: Respuesta<unknown>) => {
  mundo[que] = r;
};

beforeEach(() => {
  mundo.pedidos = [];
  responde("lista", { ok: true, dato: LISTA });
  responde("receta", { ok: true, dato: RECETA });
  responde("cocina", { ok: true, dato: COCINA });
});

describe("la página de la lista de recetas", () => {
  it("un solo h1, «Recetas», con los filtros y una fila por producto que lleva a su ficha", async () => {
    const html = await htmlDeLaLista();
    expect(titulos(html)).toEqual(["Recetas"]);
    const t = aTexto(html);
    expect(t).toContain("Todas");
    expect(t).toContain("Sin receta");
    expect(t).toContain("Pizza");
    expect(t).toContain("$ 300,50");
    expect(t).toContain("Flan");
    expect(html).toContain(`href="/catalogo/recetas/${ID}"`);
    expect(html).toContain('href="/catalogo/recetas?receta=sin"');
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<button");
    expect(t).not.toContain("Nueva receta");
  });

  it("pide la lista con el contexto del servidor, el filtro y la página de la dirección, y nada más", async () => {
    await htmlDeLaLista({ receta: "sin", despues: "clave" });
    expect(mundo.pedidos).toEqual([
      {
        quien: "lista",
        contexto: { id: "contexto" },
        dato: { texto: "", conReceta: "sin", activo: "", despues: "clave" },
      },
    ]);
  });

  it("un filtro que no es una opción conocida vuelve a «Todas»: pide sin filtro", async () => {
    await htmlDeLaLista({ receta: "con" });
    expect(mundo.pedidos[0]?.dato).toMatchObject({ conReceta: "" });
  });

  it("el filtro pedido queda marcado como el actual", async () => {
    const html = await htmlDeLaLista({ receta: "sin" });
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*>Sin receta</);
  });

  it("sin costos en la consulta (un operador) la lista sale sin costos y sin huecos", async () => {
    responde("lista", {
      ok: true,
      dato: { recetas: [{ productoId: ID, nombre: "Pizza", version: 3 }], siguiente: null },
    });
    const t = aTexto(await htmlDeLaLista());
    expect(t).toContain("Pizza");
    expect(t).not.toMatch(/\$|Sin costo/);
  });

  it("sin recetas, «Sin resultados»", async () => {
    responde("lista", { ok: true, dato: { recetas: [], siguiente: null } });
    expect(aTexto(await htmlDeLaLista())).toContain("Sin resultados");
  });

  it("con otra página ofrece «Página siguiente»", async () => {
    responde("lista", { ok: true, dato: { ...LISTA, siguiente: "k" } });
    expect(await htmlDeLaLista()).toContain('href="/catalogo/recetas?despues=k"');
  });

  it("el motivo del guard (módulo apagado o sin permiso) sale con su texto y sin lista", async () => {
    responde("lista", { ok: false, error: errorDeCodigo("MODULO_NO_ACTIVO") });
    const html = await htmlDeLaLista();
    expect(html).not.toContain("MODULO_NO_ACTIVO");
    expect(aTexto(html)).toContain("Esta función no está activada para la empresa.");
    expect(html).not.toContain("receta=sin");
  });

  it("un fallo inesperado sale con su referencia y sin el código crudo", async () => {
    responde("lista", {
      ok: false,
      error: { ...errorDeCodigo("ERROR_INTERNO"), referencia: "PD-ABC123" },
    });
    const t = aTexto(await htmlDeLaLista());
    expect(t).toContain("PD-ABC123");
    expect(t).not.toContain("ERROR_INTERNO");
  });
});

describe("la página de la ficha de una receta", () => {
  it("un solo h1 con el nombre del producto, la versión, el rinde, el costo y los ingredientes", async () => {
    const html = await htmlDeLaFicha();
    expect(titulos(html)).toEqual(["Pizza"]);
    const t = aTexto(html);
    expect(t).toContain("Versión 3 · vigente");
    expect(t).toContain("Rinde 10");
    expect(t).toContain("Costo de la comida $ 300,50");
    expect(t).toContain("Ingredientes");
    expect(t).toContain("Harina $ 1.500,00");
    expect(t).toContain("Materia prima · Bruto 2,5 Kilogramo");
    expect(t).toContain("Pasos");
    expect(t).toContain("Amasar y hornear.");
    expect(html).toContain(`href="/catalogo/recetas/${ID}/cocina"`);
    expect(t).toContain("Ficha de cocina");
    expect(html).not.toContain("<form");
    expect(t).not.toMatch(/Editar|Nueva receta/);
  });

  it("pide la receta con el contexto del servidor y el id de la dirección, y nada más", async () => {
    await htmlDeLaFicha();
    expect(mundo.pedidos).toEqual([{ quien: "receta", contexto: { id: "contexto" }, dato: ID }]);
  });

  it("sin costos en la consulta (un operador) no hay «Costo de la comida» ni costo por ingrediente", async () => {
    responde("receta", {
      ok: true,
      dato: {
        ...RECETA,
        ficha: {
          ...RECETA.ficha,
          costos: undefined,
          componentes: RECETA.ficha.componentes.map((l) => ({ ...l, costo: undefined })),
        },
      },
    });
    const t = aTexto(await htmlDeLaFicha());
    expect(t).toContain("Harina");
    expect(t).not.toMatch(/Costo de la comida|\$|Sin costo/);
  });

  it("un costo que falta dice «Sin costo», nunca cero", async () => {
    responde("receta", {
      ok: true,
      dato: {
        ...RECETA,
        ficha: {
          ...RECETA.ficha,
          costos: { ...RECETA.ficha.costos, incompleto: true },
          componentes: [{ ...RECETA.ficha.componentes[0], costo: null }],
        },
      },
    });
    const t = aTexto(await htmlDeLaFicha());
    expect(t).toContain("Costo de la comida Sin costo");
    expect(t).toContain("Harina Sin costo");
    expect(t).not.toContain("$ 0");
  });

  it("un producto de la empresa sin receta dice «Este producto no tiene receta»", async () => {
    responde("receta", { ok: true, dato: { ...RECETA, ficha: null } });
    const html = await htmlDeLaFicha();
    expect(titulos(html)).toEqual(["Pizza"]);
    const t = aTexto(html);
    expect(t).toContain("Este producto no tiene receta");
    expect(t).not.toMatch(/Ingredientes|Ficha de cocina/);
  });

  it("un producto que no está (ajeno, inexistente, mal escrito) sale como el genérico, sin decir cuál", async () => {
    responde("receta", { ok: true, dato: null });
    const t = aTexto(await htmlDeLaFicha("no-existe"));
    expect(t).toContain("Esta acción no está permitida");
    expect(t).not.toMatch(/Ingredientes|Rinde/);
  });

  it("el motivo del guard sale con su texto y sin la ficha", async () => {
    responde("receta", { ok: false, error: errorDeCodigo("SIN_PERMISO") });
    const html = await htmlDeLaFicha();
    expect(html).not.toContain("SIN_PERMISO");
    expect(html).not.toContain("Ingredientes");
  });

  it("un fallo inesperado sale con su referencia y sin el código crudo", async () => {
    responde("receta", {
      ok: false,
      error: { ...errorDeCodigo("ERROR_INTERNO"), referencia: "PD-ABC123" },
    });
    const t = aTexto(await htmlDeLaFicha());
    expect(t).toContain("PD-ABC123");
    expect(t).not.toContain("ERROR_INTERNO");
  });
});

describe("la página de la ficha de cocina", () => {
  it("un solo h1 «Ficha de cocina», con el producto, el rinde, el bruto de cada ingrediente y los pasos; sin costos", async () => {
    const html = await htmlDeLaCocina();
    expect(titulos(html)).toEqual(["Ficha de cocina"]);
    const t = aTexto(html);
    expect(t).toContain("Pizza");
    expect(t).toContain("Rinde 10 · Versión 3");
    expect(t).toContain("Harina 2,5 Kilogramo");
    expect(t).toContain("Amasar y hornear.");
    expect(t).not.toMatch(/\$|Costo|Precio/);
  });

  it("pide la ficha de cocina y la receta (por el nombre) con el id de la dirección, nada más", async () => {
    await htmlDeLaCocina();
    expect(mundo.pedidos).toEqual([
      { quien: "cocina", contexto: { id: "contexto" }, dato: ID },
      { quien: "receta", contexto: { id: "contexto" }, dato: ID },
    ]);
  });

  it("un producto sin receta o que no está sale como el genérico", async () => {
    responde("cocina", { ok: true, dato: null });
    expect(aTexto(await htmlDeLaCocina())).toContain("Esta acción no está permitida");
    responde("cocina", { ok: true, dato: COCINA });
    responde("receta", { ok: true, dato: null });
    expect(aTexto(await htmlDeLaCocina())).toContain("Esta acción no está permitida");
  });

  it("el motivo del guard (de la ficha o de la receta) sale con su texto", async () => {
    responde("cocina", { ok: false, error: errorDeCodigo("MODULO_NO_ACTIVO") });
    expect(aTexto(await htmlDeLaCocina())).toContain(
      "Esta función no está activada para la empresa.",
    );
    responde("cocina", { ok: true, dato: COCINA });
    responde("receta", { ok: false, error: errorDeCodigo("MODULO_NO_ACTIVO") });
    expect(aTexto(await htmlDeLaCocina())).toContain(
      "Esta función no está activada para la empresa.",
    );
  });
});
