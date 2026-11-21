import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeCodigo, type Respuesta } from "../../src/capacidades/experiencia/respuesta";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * La página de la clasificación comercial (A14, `/catalogo/clasificacion`): pide el árbol al servidor con el contexto de la empresa y lo pinta con los textos del catálogo. Solo la ve quien
 * edita productos (`productos.editar`: gerente y administrador): el operador, o quien no pudo leerse los permisos, ve «Esta acción no está permitida» y el árbol ni se pide (todo nace cerrado).
 * Un solo `h1`: el título aprobado. Sin departamentos, solo «Crear».
 */
vi.mock("server-only", () => ({}));
const mundo = vi.hoisted((): { permisos: unknown; llamadas: unknown[]; respuesta: unknown } => ({
  permisos: null,
  llamadas: [],
  respuesta: null,
}));
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    consultasDeEmpresas: () => ({ permisosDelActor: () => Promise.resolve(mundo.permisos) }),
  },
}));
vi.mock("../../apps/web/servidor/clasificacion", () => ({
  cargarElArbolDeClasificacion: (contexto: unknown) => {
    mundo.llamadas.push(contexto);
    return Promise.resolve(mundo.respuesta);
  },
  crearElNodoDeClasificacion: () => Promise.resolve({ ok: true, dato: {} }),
  renombrarElNodoDeClasificacion: () => Promise.resolve({ ok: true, dato: {} }),
  moverElNodoDeClasificacion: () => Promise.resolve({ ok: true, dato: {} }),
  desactivarElNodoDeClasificacion: () => Promise.resolve({ ok: true, dato: {} }),
  reactivarElNodoDeClasificacion: () => Promise.resolve({ ok: true, dato: {} }),
  clasificarElProducto: () => Promise.resolve({ ok: true, dato: {} }),
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

const RUTA = "../../apps/web/app/s/app/(operacion)/catalogo/clasificacion/page";
const cargar = (): Promise<{ default: () => Promise<unknown> }> => import(/* @vite-ignore */ RUTA);
const html = async () => {
  const { default: Pagina } = await cargar();
  return renderToStaticMarkup((await Pagina()) as ReactNode);
};
const texto = async () => (await html()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const nodo = (
  id: string,
  nombre: string,
  padreId: string | null,
  nivel: number,
  activo = true,
) => ({
  id,
  padreId,
  nombre,
  activo,
  version: 1,
  nivel,
  admiteHijos: true,
  destinos: [],
});
const ARBOL = {
  nodos: [
    nodo("d1", "Restaurante", null, 1),
    nodo("c1", "Comidas", "d1", 2),
    nodo("c2", "Postres", "d1", 2, false),
  ],
};
const responde = (r: Respuesta<unknown>) => {
  mundo.respuesta = r;
};
const puede = (acciones: string[]) => {
  mundo.permisos = {
    ok: true,
    valor: { acciones, modulos: { activos: ["catalogo"], enSoloLectura: [] } },
  };
};

describe("la página de la clasificación comercial", () => {
  beforeEach(() => {
    mundo.llamadas = [];
    responde({ ok: true, dato: ARBOL });
    puede(["productos.ver", "productos.editar"]);
  });

  it("un solo h1, el título aprobado, «Crear» y el árbol con sus nodos", async () => {
    const marcado = await html();
    expect([...marcado.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)].map((m) => m[1])).toEqual([
      "Clasificación comercial",
    ]);
    mundo.llamadas = [];
    const t = await texto();
    expect(t).toContain("Crear");
    expect(t).toContain("Restaurante");
    expect(t).toContain("Comidas");
    expect(t).toContain("Postres Desactivado");
    expect(mundo.llamadas).toEqual([{ id: "contexto" }]);
  });

  it("sin departamentos cargados, solo «Crear»: sin lista ni texto de estado vacío", async () => {
    responde({ ok: true, dato: { nodos: [] } });
    const marcado = await html();
    expect(marcado).not.toMatch(/_arbol_/);
    expect(marcado).toContain("Crear");
  });

  it("un operador (solo productos.ver) ve el genérico y el árbol ni se pide", async () => {
    puede(["productos.ver"]);
    const t = await texto();
    expect(t).toContain("Esta acción no está permitida");
    expect(t).not.toContain("Restaurante");
    expect(mundo.llamadas).toEqual([]);
  });

  it("si no se pudieron leer los permisos, el genérico y el árbol ni se pide (cierra, no abre)", async () => {
    mundo.permisos = null;
    expect(await texto()).toContain("Esta acción no está permitida");
    expect(mundo.llamadas).toEqual([]);
  });

  it("con el módulo en desarrollo (la acción no figura) también el genérico", async () => {
    mundo.permisos = {
      ok: true,
      valor: { acciones: [], modulos: { activos: [], enSoloLectura: [] } },
    };
    expect(await texto()).toContain("Esta acción no está permitida");
    expect(mundo.llamadas).toEqual([]);
  });

  it("el error de la lectura sale con su motivo, sin árbol", async () => {
    responde({ ok: false, error: errorDeCodigo("MODULO_EN_DESARROLLO") });
    const t = await texto();
    expect(t).not.toContain("Restaurante");
    expect(t).not.toContain("Crear");
    expect(t.length).toBeGreaterThan(30);
  });
});
