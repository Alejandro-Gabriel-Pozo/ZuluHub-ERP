import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeCodigo, type Respuesta } from "../../src/capacidades/experiencia/respuesta";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * La página de los precios por medida (A13, tramo Medidas): lee el id de la dirección, pide las medidas al servidor y pinta un campo por medida con su nombre, el vigente puesto y «Guardar»
 * activo o apagado según el permiso; y la página de precios de un producto con variante lleva a ella con «Según medida».
 */
vi.mock("server-only", () => ({}));
const mundo = vi.hoisted(
  (): { permisos: unknown; llamadas: unknown[]; respuesta: unknown; precios: unknown } => ({
    permisos: null,
    llamadas: [],
    respuesta: null,
    precios: null,
  }),
);
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: { consultasDeEmpresas: () => ({ permisosDelActor: () => Promise.resolve(mundo.permisos) }) },
}));
vi.mock("../../apps/web/servidor/precios-por-medida", () => ({
  cargarLosPreciosPorMedida: (contexto: unknown, id: string) => {
    mundo.llamadas.push({ contexto, id });
    return Promise.resolve(mundo.respuesta);
  },
  cambiarLosPreciosDeLasMedidas: () => Promise.resolve({ error: null }),
}));
vi.mock("../../apps/web/servidor/precios-de-producto", () => ({
  cargarLosPrecios: () => Promise.resolve(mundo.precios),
  cambiarElPrecio: () => Promise.resolve({ error: null }),
}));
vi.mock("../../apps/web/servidor/ficha-de-producto", () => ({
  guardarLaFicha: () => Promise.resolve({ error: null }),
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
const BASE = "../../apps/web/app/s/app/(operacion)/catalogo/productos/[id]/precios";
type Pagina = (p: { params: Promise<{ id: string }> }) => Promise<unknown>;
const html = async (ruta: string) => {
  const { default: P } = (await import(/* @vite-ignore */ `${BASE}${ruta}`)) as { default: Pagina };
  return renderToStaticMarkup((await P({ params: Promise.resolve({ id: ID }) })) as ReactNode);
};
const DATO = {
  id: ID,
  nombre: "Latte",
  claveDelCambio: "c",
  medidas: [
    { opcionId: "a", nombre: "Chico", vigente: { precioId: "p", importe: "3200.000000" } },
    { opcionId: "b", nombre: "Grande", vigente: null },
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

beforeEach(() => {
  mundo.llamadas = [];
  responde({ ok: true, dato: DATO });
  puede(["productos.ver", "productos.cambiar_precio"]);
});

describe("la página de los precios por medida", () => {
  it("un solo h1 (el producto), un campo por medida con su nombre y el vigente puesto, y «Guardar»; pide con el contexto y el id", async () => {
    const marcado = await html("/medidas/page");
    expect([...marcado.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)].map((m) => m[1])).toEqual(["Latte"]);
    expect(mundo.llamadas).toEqual([{ contexto: { id: "contexto" }, id: ID }]);
    expect(marcado).toMatch(/<input[^>]*name="precio_0"[^>]*value="3200.00"/);
    expect(marcado).toMatch(/<input[^>]*name="precio_1"[^>]*value=""/);
    expect(marcado).toContain("Chico");
    expect(marcado).toContain("Grande");
    expect(marcado).toMatch(/<button[^>]*type="submit"[^>]*>Guardar/);
  });

  it("sin productos.cambiar_precio «Guardar» sale apagado; sin poder leer los permisos, también", async () => {
    puede(["productos.ver"]);
    expect(await html("/medidas/page")).toMatch(/<button[^>]*disabled[^>]*>Guardar/);
    mundo.permisos = { ok: false, error: "SIN_PERMISO" };
    expect(await html("/medidas/page")).toMatch(/<button[^>]*disabled[^>]*>Guardar/);
  });

  it("el guard y un producto que no está salen con su texto, sin formulario", async () => {
    responde({ ok: false, error: errorDeCodigo("MODULO_EN_DESARROLLO") });
    const marcado = await html("/medidas/page");
    expect(marcado).not.toContain("<form");
    expect(marcado).toContain("Esta función todavía está en desarrollo.");
    responde({ ok: false, error: errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA") });
    expect(await html("/medidas/page")).toContain("Esta acción no está permitida");
  });
});

describe("los precios de un producto con variante", () => {
  it("«Según medida» es un enlace a los precios por medida, sin formulario", async () => {
    mundo.precios = {
      ok: true,
      dato: {
        id: ID,
        nombre: "Latte",
        tipo: "SEGUN_MEDIDA",
        vigente: null,
        historial: [],
        claveDelCambio: "c",
      },
    };
    const marcado = await html("/page");
    expect(marcado).toMatch(
      new RegExp(`<a [^>]*href="/catalogo/productos/${ID}/precios/medidas"[^>]*>Según medida</a>`),
    );
    expect(marcado).not.toContain("<form");
  });
});
