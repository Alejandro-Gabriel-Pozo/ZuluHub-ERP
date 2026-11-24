import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeCodigo, type Respuesta } from "../../src/capacidades/experiencia/respuesta";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * La página de «Qué consume» (A13, tramo Consumo): lee los dos ids de la dirección, pide el consumo al servidor y pinta una tarjeta por opción con sus líneas (insumo, cantidad con la unidad y,
 * si hay medida, «Escala con la medida»), «Agregar insumo» y «Guardar» activo o apagado según el permiso; el guard y lo que no está salen con su texto, sin formulario.
 */
vi.mock("server-only", () => ({}));
const mundo = vi.hoisted((): { permisos: unknown; llamadas: unknown[]; respuesta: unknown } => ({
  permisos: null,
  llamadas: [],
  respuesta: null,
}));
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: { consultasDeEmpresas: () => ({ permisosDelActor: () => Promise.resolve(mundo.permisos) }) },
}));
vi.mock("../../apps/web/servidor/consumo", () => ({
  cargarElConsumo: (contexto: unknown, id: string, grupoId: string) => {
    mundo.llamadas.push({ contexto, id, grupoId });
    return Promise.resolve(mundo.respuesta);
  },
  guardarElConsumo: () => Promise.resolve({ error: null }),
}));
vi.mock("../../apps/web/servidor/opciones", () => ({
  guardarElGrupo: () => Promise.resolve({ error: null }),
  copiarLasOpciones: () => Promise.resolve({ error: null }),
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
const GRUPO = "3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b";
const RUTA =
  "../../apps/web/app/s/app/(operacion)/catalogo/productos/[id]/opciones/[grupoId]/consumo/page";
type Pagina = (p: { params: Promise<{ id: string; grupoId: string }> }) => Promise<unknown>;
const html = async () => {
  const { default: P } = (await import(/* @vite-ignore */ RUTA)) as { default: Pagina };
  return renderToStaticMarkup(
    (await P({ params: Promise.resolve({ id: ID, grupoId: GRUPO }) })) as ReactNode,
  );
};
const texto = async () => (await html()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const DATO = {
  id: ID,
  nombre: "Milanesa",
  versionDeOpciones: 4,
  grupo: { id: GRUPO, nombre: "Carne" },
  tieneMedida: true,
  opciones: [
    {
      id: "o1",
      nombre: "Pollo",
      lineas: [{ insumoId: "i1", cantidad: "150.0000", escalaConTamano: true }],
    },
    { id: "o2", nombre: "Carne", lineas: [] },
  ],
  insumos: [{ id: "i1", nombre: "Pollo crudo", unidad: "g" }],
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
  puede(["productos.ver", "opciones.editar"]);
});

describe("la página de «Qué consume»", () => {
  it("un solo h1 (el producto); «Qué consume · grupo», cada opción con su línea (insumo, cantidad con la unidad, escala) y «Agregar insumo», «Guardar»; pide con el contexto y los dos ids", async () => {
    const marcado = await html();
    expect([...marcado.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)].map((m) => m[1])).toEqual(["Milanesa"]);
    expect(mundo.llamadas).toEqual([{ contexto: { id: "contexto" }, id: ID, grupoId: GRUPO }]);
    const t = await texto();
    const orden = [
      "Qué consume · Carne",
      "Pollo",
      "Insumo",
      "Cantidad (g)",
      "Escala con la medida",
      "Quitar",
      "Agregar insumo",
      "Guardar",
    ].map((x) => t.indexOf(x));
    expect(orden.every((i) => i >= 0)).toBe(true);
    expect([...orden].sort((a, b) => a - b)).toEqual(orden);
    expect(marcado).toMatch(/<select[^>]*name="consumo_0_l0_insumo"/);
    expect(marcado).toMatch(/<input[^>]*name="consumo_0_l0_cantidad"[^>]*value="150"/);
    expect(marcado).toMatch(/<input[^>]*name="consumo_0_l0_escala"[^>]*checked/);
    expect(marcado).not.toContain("consumo_1_l");
  });

  it("sin medida no se ofrece la escala; sin insumos que ofrecer «Agregar insumo» sale apagado", async () => {
    responde({
      ok: true,
      dato: {
        ...DATO,
        tieneMedida: false,
        insumos: [],
        opciones: [{ id: "o1", nombre: "Pollo", lineas: [] }],
      },
    });
    const marcado = await html();
    expect(marcado).not.toContain("_escala");
    expect(marcado).toMatch(/<button[^>]*disabled[^>]*>Agregar insumo/);
  });

  it("«Guardar» sale activo con opciones.editar y apagado sin él o sin poder leer los permisos", async () => {
    expect(await html()).toMatch(/<button[^>]*type="submit"[^>]*>Guardar/);
    puede(["productos.ver"]);
    expect(await html()).toMatch(/<button[^>]*disabled[^>]*>Guardar/);
    mundo.permisos = { ok: false, error: "SIN_PERMISO" };
    expect(await html()).toMatch(/<button[^>]*disabled[^>]*>Guardar/);
  });

  it("el guard, lo que no está y un fallo inesperado salen con su texto, sin formulario ni código crudo", async () => {
    responde({ ok: false, error: errorDeCodigo("MODULO_EN_DESARROLLO") });
    expect(await texto()).toContain("Esta función todavía está en desarrollo.");
    expect(await html()).not.toContain("<form");
    responde({ ok: false, error: errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA") });
    expect(await texto()).toContain("Esta acción no está permitida");
    responde({ ok: false, error: { ...errorDeCodigo("ERROR_INTERNO"), referencia: "PD-ABC123" } });
    const t = await texto();
    expect(t).toContain("PD-ABC123");
    expect(t).not.toContain("ERROR_INTERNO");
  });
});
