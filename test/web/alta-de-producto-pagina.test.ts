import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeCodigo, type Respuesta } from "../../src/capacidades/experiencia/respuesta";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * La página del alta de un producto (A1, T6): pide al servidor lo que se ofrece con el contexto de la empresa, fija UNA clave de creación por apertura y la liga a la acción, y pinta
 * cada situación con su texto del catálogo: los campos en el orden de la maqueta, «Guardar» activo o apagado según el permiso, y los errores (el del guard con su motivo; el inesperado
 * con la referencia y sin el código crudo). Un solo `h1`: «Nuevo producto». Sin entrada en la barra: se llega por la dirección.
 */
vi.mock("server-only", () => ({}));
const mundo = vi.hoisted(
  (): {
    permisos: unknown;
    llamadas: unknown[];
    respuesta: unknown;
    claves: string[];
    ligadas: unknown[][];
  } => ({ permisos: null, llamadas: [], respuesta: null, claves: [], ligadas: [] }),
);
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    consultasDeEmpresas: () => ({
      permisosDelActor: () => Promise.resolve(mundo.permisos),
    }),
  },
}));
vi.mock("../../apps/web/servidor/alta-de-producto", () => ({
  cargarLasOpcionesDelAlta: (contexto: unknown) => {
    mundo.llamadas.push(contexto);
    return Promise.resolve(mundo.respuesta);
  },
  nuevaClaveDeAlta: () => {
    const clave = `clave-${String(mundo.claves.length + 1)}`;
    mundo.claves.push(clave);
    return clave;
  },
  darDeAltaElProducto: () => Promise.resolve({ error: null }),
}));
vi.mock("../../apps/web/app/s/app/acciones-de-productos", () => ({
  crearProductoAccion: {
    bind: (...ligadas: unknown[]) => {
      mundo.ligadas.push(ligadas);
      return () => Promise.resolve({ error: null });
    },
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

const SECCION = "5c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const RUTA = "../../apps/web/app/s/app/(operacion)/catalogo/productos/nuevo/page";
const cargar = (): Promise<{ default: () => Promise<unknown> }> => import(/* @vite-ignore */ RUTA);

const html = async () => {
  const { default: Pagina } = await cargar();
  return renderToStaticMarkup((await Pagina()) as ReactNode);
};
const texto = async () => (await html()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const OPCIONES = {
  clases: [
    { valor: "MATERIA_PRIMA", seVende: false },
    { valor: "INSUMO", seVende: false },
    { valor: "REVENTA", seVende: true },
    { valor: "ELABORADO", seVende: false },
    { valor: "VENDIBLE", seVende: true },
  ],
  unidades: ["UNIDAD", "GRAMO", "KILOGRAMO"],
  alicuotas: ["21", "10.5", "27", "5", "2.5", "0"],
  secciones: [{ id: SECCION, nombre: "Minutas" }],
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

describe("la página del alta de un producto", () => {
  beforeEach(() => {
    Object.assign(mundo, { llamadas: [], claves: [], ligadas: [] });
    responde({ ok: true, dato: OPCIONES });
    puede(["productos.ver", "productos.crear"]);
  });

  it("un solo h1, «Nuevo producto», y los campos en el orden de la maqueta", async () => {
    const marcado = await html();
    expect([...marcado.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)].map((m) => m[1])).toEqual([
      "Nuevo producto",
    ]);
    const rotulos = [
      ...marcado.matchAll(/<(?:label|button)\b[^>]*>(.*?)<\/(?:label|button)>/g),
    ].map((m) => (m[1] ?? "").replace(/<[^>]+>/g, "").trim());
    expect(rotulos.filter((r) => r !== "" && !/^(Inicio|Cuenta)/.test(r)).slice(-9)).toEqual([
      "¿Qué es?",
      "Nombre",
      "Nombre de cocina",
      "Código interno",
      "Código de barras",
      "Unidad",
      "Alícuota de IVA",
      "Sección de la carta",
      "Guardar",
    ]);
  });

  it("pide lo que se ofrece con el contexto del servidor, y nada más", async () => {
    await html();
    expect(mundo.llamadas).toEqual([{ id: "contexto" }]);
  });

  it("abre con producto vendible y unidad elegidos, y la alícuota y la sección sin elegir", async () => {
    const marcado = await html();
    expect(marcado).toMatch(/<option value="VENDIBLE" selected[^>]*>Producto vendible<\/option>/);
    expect(marcado).toMatch(/<option value="UNIDAD" selected/);
    expect(marcado).not.toMatch(/<option value="21" selected/);
    expect(marcado.match(/<option value="" selected="">Sin elegir<\/option>/g)).toHaveLength(2);
    expect(marcado.match(/<input[^>]*type="text"/g)).toHaveLength(4);
    expect(marcado.match(/<select/g)).toHaveLength(4);
    expect(marcado).not.toContain('type="checkbox"');
  });

  it("el nombre del campo de cada dato es el que declara el camino", async () => {
    const marcado = await html();
    for (const nombre of [
      "claseDeUso",
      "nombre",
      "nombreDeCocina",
      "codigo",
      "codigoDeBarras",
      "unidadBaseId",
      "alicuota",
      "seccionDeCartaId",
    ]) {
      expect(marcado).toContain(`name="${nombre}"`);
    }
    expect(marcado).not.toMatch(/name="(id|claveDeCreacion|empresaId|descripcion)/);
  });

  it("fija UNA clave de creación por apertura y la liga sola a la acción; abrir otra vez es otra clave", async () => {
    await html();
    expect(mundo.ligadas).toEqual([[null, "clave-1"]]);
    await html();
    expect(mundo.ligadas).toEqual([
      [null, "clave-1"],
      [null, "clave-2"],
    ]);
    expect(await html()).not.toContain("clave-");
  });

  it("«Guardar» sale activo con productos.crear", async () => {
    expect(await html()).toMatch(/<button[^>]*type="submit"[^>]*>Guardar/);
    expect(await html()).not.toMatch(/<button[^>]*disabled[^>]*>Guardar/);
  });

  it("sin productos.crear (un operador) «Guardar» sale apagado, sin texto nuevo", async () => {
    puede(["productos.ver"]);
    expect(await html()).toMatch(/<button[^>]*disabled[^>]*>Guardar/);
    expect(await texto()).not.toContain("Esta acción no está permitida");
  });

  it("si no se pudieron leer los permisos, «Guardar» sale apagado (cierra, no abre)", async () => {
    mundo.permisos = { ok: false, error: "SIN_PERMISO" };
    expect(await html()).toMatch(/<button[^>]*disabled[^>]*>Guardar/);
  });

  it("el motivo del guard (el módulo en desarrollo) sale con su texto y sin formulario", async () => {
    responde({ ok: false, error: errorDeCodigo("MODULO_EN_DESARROLLO") });
    const marcado = await html();
    expect(marcado).not.toContain("<form");
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
