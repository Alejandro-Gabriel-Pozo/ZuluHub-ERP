import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeCodigo, type Respuesta } from "../../src/capacidades/experiencia/respuesta";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * La página de la ficha de datos de un producto (A1, T2a): lee el id de la dirección, pide la ficha al servidor con el contexto de la empresa y pinta cada situación con su texto
 * del catálogo: los campos según la clase, «Guardar» activo o apagado según el permiso, y los errores (el del guard con su motivo; el genérico para un producto que no está ahí; el
 * inesperado con la referencia y sin el código crudo). Un solo `h1`: el nombre del producto. Sin entrada en la barra: se llega por la dirección.
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
vi.mock("../../apps/web/servidor/ficha-de-producto", () => ({
  cargarLaFicha: (contexto: unknown, id: string) => {
    mundo.llamadas.push({ contexto, id });
    return Promise.resolve(mundo.respuesta);
  },
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
const SECCION = "5c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const RUTA = "../../apps/web/app/s/app/(operacion)/catalogo/productos/[id]/page";
const cargar = (): Promise<{
  default: (p: { params: Promise<{ id: string }> }) => Promise<unknown>;
}> => import(/* @vite-ignore */ RUTA);

const html = async (id = ID) => {
  const { default: Pagina } = await cargar();
  return renderToStaticMarkup((await Pagina({ params: Promise.resolve({ id }) })) as ReactNode);
};
const texto = async (id?: string) => (await html(id)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const FICHA = {
  id: ID,
  version: 4,
  nombre: "Milanesa",
  claseDeUso: "VENDIBLE",
  unidadBaseId: "UNIDAD",
  seVende: true,
  nombreDeCocina: "MILA",
  codigo: "MIL-1",
  codigoDeBarras: "12345678",
  alicuota: "10.5",
  seccionDeCartaId: SECCION,
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

describe("la página de la ficha de datos de un producto", () => {
  beforeEach(() => {
    mundo.llamadas = [];
    responde({ ok: true, dato: FICHA });
    puede(["productos.ver", "productos.editar"]);
  });

  it("un solo h1, el nombre del producto, y los campos en el orden de la maqueta", async () => {
    const marcado = await html();
    expect([...marcado.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)].map((m) => m[1])).toEqual(["Milanesa"]);
    const rotulos = [
      ...marcado.matchAll(/<(?:label|dt|button)\b[^>]*>(.*?)<\/(?:label|dt|button)>/g),
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

  it("pide la ficha con el contexto del servidor y el id de la dirección, y nada más", async () => {
    await html();
    expect(mundo.llamadas).toEqual([{ contexto: { id: "contexto" }, id: ID }]);
  });

  it("los datos guardados quedan puestos: texto, códigos, alícuota y sección elegidas", async () => {
    const marcado = await html();
    expect(marcado).toContain('value="Milanesa"');
    expect(marcado).toContain('value="MILA"');
    expect(marcado).toContain('value="MIL-1"');
    expect(marcado).toContain('value="12345678"');
    expect(marcado).toMatch(/<option value="10.5" selected[^>]*>10,5 %<\/option>/);
    expect(marcado).toContain(`<option value="${SECCION}" selected`);
    expect(await texto()).toContain("Producto vendible");
  });

  it("la clase y la unidad solo se ven: no son campos del formulario", async () => {
    const marcado = await html();
    expect(marcado).not.toMatch(/name="clase/);
    expect(marcado).not.toMatch(/name="unidad/);
    expect(marcado).not.toMatch(/name="descripcion/);
    expect(marcado.match(/<input[^>]*type="text"/g)).toHaveLength(4);
    expect(marcado.match(/<select/g)).toHaveLength(2);
  });

  it("el nombre del campo de cada dato es el que declara el camino (alicuota, seccionDeCartaId…)", async () => {
    const marcado = await html();
    for (const nombre of [
      "nombre",
      "nombreDeCocina",
      "codigo",
      "codigoDeBarras",
      "alicuota",
      "seccionDeCartaId",
    ]) {
      expect(marcado).toContain(`name="${nombre}"`);
    }
  });

  it("«Guardar» sale activo con productos.editar", async () => {
    expect(await html()).toMatch(/<button[^>]*type="submit"[^>]*>Guardar/);
    expect(await html()).not.toMatch(/<button[^>]*disabled[^>]*>Guardar/);
  });

  it("sin productos.editar (un operador) «Guardar» sale apagado, sin texto nuevo", async () => {
    puede(["productos.ver"]);
    const marcado = await html();
    expect(marcado).toMatch(/<button[^>]*disabled[^>]*>Guardar/);
    expect(await texto()).not.toContain("Esta acción no está permitida");
  });

  it("si no se pudieron leer los permisos, «Guardar» sale apagado (cierra, no abre)", async () => {
    mundo.permisos = { ok: false, error: "SIN_PERMISO" };
    expect(await html()).toMatch(/<button[^>]*disabled[^>]*>Guardar/);
  });

  it("una clase que no se vende no ofrece nombre de cocina, alícuota ni sección", async () => {
    responde({
      ok: true,
      dato: {
        ...FICHA,
        claseDeUso: "MATERIA_PRIMA",
        seVende: false,
        nombreDeCocina: null,
        alicuota: null,
        seccionDeCartaId: null,
      },
    });
    const marcado = await html();
    const t = await texto();
    expect(t).toContain("Materia prima");
    expect(t).not.toContain("Nombre de cocina");
    expect(t).not.toContain("Alícuota de IVA");
    expect(t).not.toContain("Sección de la carta");
    expect(marcado).not.toMatch(/<select/);
    expect(t).toContain("Código de barras");
  });

  it("una alícuota guardada que el producto no ofrece se ve y su desplegable sale apagado", async () => {
    responde({ ok: true, dato: { ...FICHA, alicuota: "EXENTO" } });
    const marcado = await html();
    expect(marcado).toMatch(
      /<select[^>]*disabled[^>]*name="alicuota"|<select[^>]*name="alicuota"[^>]*disabled/,
    );
    expect(marcado).toContain("EXENTO");
  });

  it("el motivo del guard (el módulo en desarrollo) sale con su texto y sin formulario", async () => {
    responde({ ok: false, error: errorDeCodigo("MODULO_EN_DESARROLLO") });
    const marcado = await html();
    expect(marcado).not.toContain("<form");
    expect(marcado).not.toContain("MODULO_EN_DESARROLLO");
    expect(await texto()).toContain("Esta función todavía está en desarrollo.");
  });

  it("un producto que no está (ajeno, inexistente) sale como el genérico, sin formulario", async () => {
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
