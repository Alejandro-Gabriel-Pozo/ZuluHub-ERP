import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeCodigo, type Respuesta } from "../../src/capacidades/experiencia/respuesta";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * La página de los precios de un producto (A1, T3): lee el id de la dirección, pide los precios al servidor con el contexto de la empresa y pinta cada situación con su texto del
 * catálogo: el campo con el precio vigente, «Vigente desde», el historial (solo si hay anteriores), «Precio abierto», «Según medida» sin campo, «Guardar» activo o apagado según el
 * permiso, y los errores (el del guard con su motivo; el genérico para un producto que no está; el inesperado con la referencia). Un solo `h1`: el nombre del producto. Sin entrada en
 * la barra: se llega por la dirección.
 */
vi.mock("server-only", () => ({}));
const mundo = vi.hoisted(
  (): {
    permisos: unknown;
    llamadas: { contexto: unknown; id: string }[];
    respuesta: unknown;
  } => ({ permisos: null, llamadas: [], respuesta: null }),
);
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    consultasDeEmpresas: () => ({
      permisosDelActor: () => Promise.resolve(mundo.permisos),
    }),
  },
}));
vi.mock("../../apps/web/servidor/precios-de-producto", () => ({
  cargarLosPrecios: (contexto: unknown, id: string) => {
    mundo.llamadas.push({ contexto, id });
    return Promise.resolve(mundo.respuesta);
  },
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
const RUTA = "../../apps/web/app/s/app/(operacion)/catalogo/productos/[id]/precios/page";
const cargar = (): Promise<{
  default: (p: { params: Promise<{ id: string }> }) => Promise<unknown>;
}> => import(/* @vite-ignore */ RUTA);

const html = async (id = ID) => {
  const { default: Pagina } = await cargar();
  return renderToStaticMarkup((await Pagina({ params: Promise.resolve({ id }) })) as ReactNode);
};
const texto = async (id?: string) => (await html(id)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const PRECIOS = {
  id: ID,
  nombre: "Hamburguesa Funghi",
  tipo: "DE_LA_EMPRESA",
  vigente: { precioId: "p2", importe: "13000.000000", desde: "2026-11-02" },
  historial: [{ importe: "11500.000000", desde: "2026-10-15" }],
  claveDelCambio: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
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

describe("la página de los precios de un producto", () => {
  beforeEach(() => {
    mundo.llamadas = [];
    responde({ ok: true, dato: PRECIOS });
    puede(["productos.ver", "productos.cambiar_precio"]);
  });

  it("un solo h1, el nombre del producto; el precio, la vigencia, el historial y «Guardar», en el orden de la maqueta", async () => {
    const marcado = await html();
    expect([...marcado.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)].map((m) => m[1])).toEqual([
      "Hamburguesa Funghi",
    ]);
    const t = await texto();
    const orden = [
      "Precio (IVA incluido)",
      "Vigente desde 02/11/2026",
      "Historial",
      "$ 11.500,00",
      "15/10/2026",
      "Guardar",
    ].map((x) => t.indexOf(x));
    expect(orden.every((i) => i >= 0)).toBe(true);
    expect([...orden].sort((a, b) => a - b)).toEqual(orden);
  });

  it("pide los precios con el contexto del servidor y el id de la dirección, y nada más", async () => {
    await html();
    expect(mundo.llamadas).toEqual([{ contexto: { id: "contexto" }, id: ID }]);
  });

  it("el campo del precio lleva el vigente puesto y viaja por su nombre, como texto decimal canónico", async () => {
    const marcado = await html();
    expect(marcado).toMatch(/<input[^>]*name="precio"[^>]*value="13000.00"/);
    expect(marcado).toContain("13.000,00");
    expect(marcado.match(/<input[^>]*type="text"/g)).toHaveLength(1);
  });

  it("un precio con más decimales que el campo no se muestra recortado: el campo sale vacío", async () => {
    responde({
      ok: true,
      dato: {
        ...PRECIOS,
        vigente: { precioId: "p2", importe: "28333.333333", desde: "2026-11-02" },
      },
    });
    expect(await html()).toMatch(/<input[^>]*name="precio"[^>]*value=""/);
  });

  it("sin anteriores no hay historial", async () => {
    responde({ ok: true, dato: { ...PRECIOS, historial: [] } });
    expect(await texto()).not.toContain("Historial");
  });

  it("sin precio: «Precio abierto» y ningún «Vigente desde»", async () => {
    responde({ ok: true, dato: { ...PRECIOS, vigente: null, historial: [] } });
    const t = await texto();
    expect(t).toContain("Precio abierto");
    expect(t).not.toContain("Vigente desde");
  });

  it("con variante activa dice «Según medida» y no hay formulario ni campo ni botón", async () => {
    responde({
      ok: true,
      dato: { ...PRECIOS, tipo: "SEGUN_MEDIDA", vigente: null, historial: [] },
    });
    const marcado = await html();
    expect(marcado).not.toContain("<form");
    expect(marcado).not.toContain('name="precio"');
    expect(await texto()).toContain("Según medida");
  });

  it("«Guardar» sale activo con productos.cambiar_precio", async () => {
    expect(await html()).toMatch(/<button[^>]*type="submit"[^>]*>Guardar/);
    expect(await html()).not.toMatch(/<button[^>]*disabled[^>]*>Guardar/);
  });

  it("sin productos.cambiar_precio (un operador, o quien solo edita) «Guardar» sale apagado, sin texto nuevo", async () => {
    for (const acciones of [["productos.ver"], ["productos.ver", "productos.editar"]]) {
      puede(acciones);
      expect(await html()).toMatch(/<button[^>]*disabled[^>]*>Guardar/);
      expect(await texto()).not.toContain("Esta acción no está permitida");
    }
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

  it("un producto que no está (ajeno, inexistente, que no se vende) sale como el genérico, sin formulario", async () => {
    responde({ ok: false, error: errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA") });
    expect(await html("no-existe")).not.toContain("<form");
    expect(await texto("no-existe")).toContain("Esta acción no está permitida");
  });

  it("un fallo inesperado sale con su referencia y sin el código crudo", async () => {
    responde({ ok: false, error: { ...errorDeCodigo("ERROR_INTERNO"), referencia: "PD-ABC123" } });
    const t = await texto();
    expect(t).toContain("PD-ABC123");
    expect(t).not.toContain("ERROR_INTERNO");
  });
});
