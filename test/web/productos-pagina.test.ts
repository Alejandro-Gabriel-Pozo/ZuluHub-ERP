import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeCodigo, type Respuesta } from "../../src/capacidades/experiencia/respuesta";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * La página de la lista de productos (A1, T1): lee los filtros y la página de la dirección, pide la lista al servidor con el contexto de la empresa y SOLO con lo que la
 * dirección declara (una clase o un estado desconocido vuelve a «Todos»), y pinta cada situación con su texto del catálogo: la lista, la lista vacía («Sin resultados») y los errores
 * (el del guard con su motivo; el inesperado con la referencia y sin el código crudo). Un solo `h1`, el del armazón. Sin entrada en la barra: se llega por la dirección.
 */
vi.mock("server-only", () => ({}));
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    consultasDeEmpresas: () => ({
      permisosDelActor: () =>
        Promise.resolve({
          ok: true,
          valor: {
            acciones: ["productos.ver"],
            modulos: { activos: ["catalogo"], enSoloLectura: [] },
          },
        }),
    }),
  },
}));
const servidor = vi.hoisted(
  (): { llamadas: { contexto: unknown; entrada: unknown }[]; respuesta: unknown } => ({
    llamadas: [],
    respuesta: null,
  }),
);
vi.mock("../../apps/web/servidor/productos", () => ({
  cargarLosProductos: (contexto: unknown, entrada: unknown) => {
    servidor.llamadas.push({ contexto, entrada });
    return Promise.resolve(servidor.respuesta);
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

const RUTA = "../../apps/web/app/s/app/(operacion)/catalogo/productos/page";
const cargar = (): Promise<{
  default: (p: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  }) => Promise<unknown>;
}> => import(/* @vite-ignore */ RUTA);

const html = async (params: Record<string, string | string[] | undefined> = {}) => {
  const { default: Pagina } = await cargar();
  return renderToStaticMarkup(
    (await Pagina({ searchParams: Promise.resolve(params) })) as ReactNode,
  );
};
const texto = async (params?: Record<string, string | string[] | undefined>) =>
  (await html(params)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const responde = (r: Respuesta<unknown>) => {
  servidor.respuesta = r;
};
const PAGINA = {
  productos: [
    {
      id: "a1",
      nombre: "Milanesa napolitana",
      claseDeUso: "VENDIBLE",
      estado: "ACTIVO",
      seccion: "Platos principales",
      precio: { tipo: "EMPRESA", importe: "9000.00" },
    },
    {
      id: "a2",
      nombre: "Harina 000",
      claseDeUso: "MATERIA_PRIMA",
      estado: "DESACTIVADO",
      seccion: null,
      precio: null,
    },
  ],
  siguiente: "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b:harina 000",
};

describe("la página de la lista de productos", () => {
  beforeEach(() => {
    servidor.llamadas = [];
    responde({ ok: true, dato: PAGINA });
  });

  it("un solo h1 «Productos», los filtros y una fila por producto con su marca, su clase y su precio", async () => {
    const marcado = await html();
    expect([...marcado.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)].map((m) => m[1])).toEqual([
      "Productos",
    ]);
    const t = await texto();
    expect(t).toContain("Buscar");
    expect(t).toContain("¿Qué es?");
    expect(t).toContain("Milanesa napolitana");
    expect(t).toContain("$ 9.000,00");
    expect(t).toContain("Harina 000");
    expect(t).toContain("Desactivado");
    expect(t).toContain("Página siguiente");
  });

  it("cada fila dice «clase · sección»; sin sección, solo la clase y sin separador colgante", async () => {
    const t = await texto();
    expect(t).toContain("Producto vendible · Platos principales");
    expect(t).toContain("Materia prima");
    expect(t).not.toContain("Materia prima ·");
    expect(t).not.toContain("Sin resultados");
  });

  it("pide la lista con el contexto del servidor y lo que dice la dirección", async () => {
    await html({ texto: " mila ", clase: "VENDIBLE", estado: "FALTA_COMPLETAR", despues: "x:y" });
    expect(servidor.llamadas).toEqual([
      {
        contexto: { id: "contexto" },
        entrada: { texto: "mila", clase: "VENDIBLE", estado: "FALTA_COMPLETAR", despues: "x:y" },
      },
    ]);
  });

  it("sin nada en la dirección pide todo; una clase o un estado desconocido vuelve a «Todos»", async () => {
    await html();
    await html({ clase: "SERVICIO", estado: "BORRADO" });
    expect(servidor.llamadas.map((l) => l.entrada)).toEqual([
      { texto: "", clase: "", estado: "", despues: "" },
      { texto: "", clase: "", estado: "", despues: "" },
    ]);
  });

  it("los filtros de la dirección quedan puestos en el formulario", async () => {
    const marcado = await html({ texto: "mila", clase: "VENDIBLE", estado: "ACTIVO" });
    expect(marcado).toContain('value="mila"');
    expect(marcado).toMatch(/<option value="VENDIBLE" selected/);
    expect(marcado).toMatch(/<option value="ACTIVO" selected/);
  });

  it("«Página siguiente» conserva los filtros y lleva la clave de la consulta", async () => {
    const marcado = await html({ clase: "INSUMO" });
    const href = /<a[^>]*href="([^"]+)"[^>]*>Página siguiente/.exec(marcado)?.[1] ?? "";
    const url = new URL(href.replace(/&amp;/g, "&"), "https://app.ejemplo.test");
    expect(url.pathname).toBe("/catalogo/productos");
    expect(url.searchParams.get("clase")).toBe("INSUMO");
    expect(url.searchParams.get("despues")).toBe(PAGINA.siguiente);
  });

  it("la última página no ofrece «Página siguiente»", async () => {
    responde({ ok: true, dato: { ...PAGINA, siguiente: null } });
    expect(await texto()).not.toContain("Página siguiente");
  });

  it("una lista vacía dice «Sin resultados», sin tarjetas y con los filtros", async () => {
    responde({ ok: true, dato: { productos: [], siguiente: null } });
    const t = await texto();
    expect(t).toContain("Buscar");
    expect(t).toContain("Sin resultados");
    expect(await html()).not.toMatch(/_tarjeta_/);
    expect(t).not.toContain("Página siguiente");
  });

  it("una búsqueda sin coincidencias dice «Sin resultados» y deja el texto buscado en el formulario", async () => {
    responde({ ok: true, dato: { productos: [], siguiente: null } });
    const marcado = await html({ texto: "zzz" });
    expect(marcado).toContain('value="zzz"');
    expect(await texto({ texto: "zzz" })).toContain("Sin resultados");
  });

  it("con un error no se dice «Sin resultados»", async () => {
    responde({ ok: false, error: errorDeCodigo("MODULO_EN_DESARROLLO") });
    expect(await texto()).not.toContain("Sin resultados");
  });

  it("el motivo del guard (el módulo en desarrollo) sale con su texto y sin lista", async () => {
    responde({ ok: false, error: errorDeCodigo("MODULO_EN_DESARROLLO") });
    const marcado = await html();
    expect(marcado).not.toMatch(/_tarjeta_/);
    expect(marcado).not.toContain("MODULO_EN_DESARROLLO");
    expect(await texto()).toContain("Esta función todavía está en desarrollo.");
  });

  it("un fallo inesperado sale con su referencia y sin el código crudo", async () => {
    responde({ ok: false, error: { ...errorDeCodigo("ERROR_INTERNO"), referencia: "PD-ABC123" } });
    const t = await texto();
    expect(t).toContain("PD-ABC123");
    expect(t).not.toContain("ERROR_INTERNO");
  });
});
