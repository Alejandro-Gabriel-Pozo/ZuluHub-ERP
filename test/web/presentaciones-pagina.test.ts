import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeCodigo, type Respuesta } from "../../src/capacidades/experiencia/respuesta";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * Las páginas de la solapa «Cómo se compra» (T0): la lista, agregar y editar. Cada una lee los ids de la dirección, pide lo suyo al servidor con el contexto de la empresa y pinta cada situación con su
 * texto del catálogo: las tarjetas con su cantidad y sus marcas, los botones de escribir SIEMPRE (apagados sin `productos.editar`), los formularios con sus campos y los errores (el del guard con su
 * texto, el genérico para lo que no está, el inesperado con la referencia). Un solo `h1`; sin barra: se llega desde la ficha.
 */
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: () => undefined,
  useRouter: () => ({ replace: () => undefined }),
}));
const mundo = vi.hoisted(
  (): {
    permisos: unknown;
    llamadas: { pagina: string; contexto: unknown; id: string; presentacionId?: string }[];
    lista: unknown;
    una: unknown;
  } => ({ permisos: null, llamadas: [], lista: null, una: null }),
);
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    consultasDeEmpresas: () => ({
      permisosDelActor: () => Promise.resolve(mundo.permisos),
    }),
  },
}));
vi.mock("../../apps/web/servidor/presentaciones", () => ({
  cargarLasPresentaciones: (contexto: unknown, id: string) => {
    mundo.llamadas.push({ pagina: "lista", contexto, id });
    return Promise.resolve(mundo.lista);
  },
  cargarLaPresentacion: (contexto: unknown, id: string, presentacionId: string) => {
    mundo.llamadas.push({ pagina: "una", contexto, id, presentacionId });
    return Promise.resolve(mundo.una);
  },
  agregarLaPresentacion: () => Promise.resolve({ error: null }),
  guardarElNombreDeLaPresentacion: () => Promise.resolve({ error: null }),
  cambiarElEstadoDeLaPresentacionDelProducto: () => Promise.resolve({ error: null }),
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

const P = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const A = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const B = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a";
const BASE = "../../apps/web/app/s/app/(operacion)/catalogo/productos/[id]/compra";
type Pagina = (p: { params: Promise<Record<string, string>> }) => Promise<unknown>;
const cargar = (ruta: string): Promise<{ default: Pagina }> =>
  import(/* @vite-ignore */ `${BASE}${ruta}`);

const html = async (ruta: string, params: Record<string, string> = { id: P }) => {
  const { default: Pagina } = await cargar(ruta);
  return renderToStaticMarkup((await Pagina({ params: Promise.resolve(params) })) as ReactNode);
};
const texto = async (ruta: string, params?: Record<string, string>) =>
  (await html(ruta, params)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const PRODUCTO = { id: P, nombre: "Queso cremoso", unidadBase: "kg", activo: true };
const CAJA = {
  id: A,
  nombre: "Caja de 5 kg",
  cantidad: "5.0000",
  dePesoVariable: false,
  activa: true,
  version: 2,
};
const HORMA = {
  id: B,
  nombre: "Horma",
  cantidad: "4.0000",
  dePesoVariable: true,
  activa: false,
  version: 3,
};
const responde = (r: Respuesta<unknown>) => {
  mundo.lista = r;
};
const respondeUna = (r: Respuesta<unknown>) => {
  mundo.una = r;
};
const puede = (acciones: string[]) => {
  mundo.permisos = {
    ok: true,
    valor: { acciones, modulos: { activos: ["catalogo"], enSoloLectura: [] } },
  };
};

beforeEach(() => {
  mundo.llamadas = [];
  puede(["productos.ver", "productos.editar"]);
  responde({ ok: true, dato: { producto: PRODUCTO, presentaciones: [CAJA, HORMA] } });
  respondeUna({ ok: true, dato: { producto: PRODUCTO, presentacion: CAJA } });
});

describe("la lista de presentaciones de un producto", () => {
  it("un solo h1, «Cómo se compra»; las tarjetas con su cantidad y sus marcas y «Agregar presentación» al final", async () => {
    const marcado = await html("/page");
    expect([...marcado.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)].map((m) => m[1])).toEqual([
      "Cómo se compra",
    ]);
    const t = await texto("/page");
    const orden = [
      "Caja de 5 kg",
      "5 kg",
      "Editar",
      "Horma",
      "≈ 4 kg",
      "De peso variable",
      "Desactivado",
      "Agregar presentación",
    ].map((x) => t.indexOf(x));
    expect(orden.every((i) => i >= 0)).toBe(true);
    expect([...orden].sort((a, b) => a - b)).toEqual(orden);
  });

  it("pide la lista con el contexto del servidor y el id de la dirección, y nada más", async () => {
    await html("/page");
    expect(mundo.llamadas).toEqual([{ pagina: "lista", contexto: { id: "contexto" }, id: P }]);
  });

  it("los botones llevan a las pantallas de escribir", async () => {
    const marcado = await html("/page");
    expect(marcado).toContain(`href="/catalogo/productos/${P}/compra/${A}"`);
    expect(marcado).toContain(`href="/catalogo/productos/${P}/compra/nueva"`);
  });

  it("sin productos.editar (un operador) se ven las presentaciones y los botones de escribir SIGUEN, apagados y sin enlace", async () => {
    puede(["productos.ver"]);
    const marcado = await html("/page");
    const t = await texto("/page");
    expect(t).toContain("Caja de 5 kg");
    for (const visible of ["Editar", "Agregar presentación"]) {
      expect(marcado).toMatch(new RegExp(`<button[^>]*disabled[^>]*>${visible}`));
    }
    expect(marcado.slice(marcado.indexOf("<main"), marcado.indexOf("</main>"))).not.toContain(
      "<a ",
    );
  });

  it("si no se pudieron leer los permisos, los botones de escribir van apagados (cierra, no abre)", async () => {
    mundo.permisos = { ok: false, error: "SIN_PERMISO" };
    const marcado = await html("/page");
    expect(marcado).toMatch(/<button[^>]*disabled[^>]*>Agregar presentación/);
  });

  it("un producto sin presentaciones dice «Sin presentaciones» y ofrece «Agregar presentación»", async () => {
    responde({ ok: true, dato: { producto: PRODUCTO, presentaciones: [] } });
    const t = await texto("/page");
    expect(t).toContain("Sin presentaciones");
    expect(t).toContain("Agregar presentación");
  });

  it("el motivo del guard sale con su texto y sin datos; un producto que no está, el genérico; un fallo inesperado, con su referencia", async () => {
    responde({ ok: false, error: errorDeCodigo("MODULO_EN_DESARROLLO") });
    const t = await texto("/page");
    expect(t).toContain("Esta función todavía está en desarrollo.");
    expect(t).not.toContain("Caja de 5 kg");
    responde({ ok: false, error: errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA") });
    expect(await texto("/page", { id: "no-existe" })).toContain("Esta acción no está permitida");
    responde({ ok: false, error: { ...errorDeCodigo("ERROR_INTERNO"), referencia: "PD-ABC123" } });
    const inesperado = await texto("/page");
    expect(inesperado).toContain("PD-ABC123");
    expect(inesperado).not.toContain("ERROR_INTERNO");
  });
});

describe("agregar una presentación", () => {
  it("un solo h1, «Agregar presentación»; el nombre, la cantidad con la unidad base, la casilla, «Cancelar» y «Agregar presentación»", async () => {
    const marcado = await html("/nueva/page");
    expect([...marcado.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)].map((m) => m[1])).toEqual([
      "Agregar presentación",
    ]);
    const t = await texto("/nueva/page");
    for (const visible of [
      "Presentación",
      "Cantidad en la unidad base (kg)",
      "De peso variable",
      "Cancelar",
    ]) {
      expect(t).toContain(visible);
    }
    expect(marcado).toContain('name="nombre"');
    expect(marcado).toContain('name="cantidad"');
    expect(marcado).toContain('name="pesoVariable"');
    expect(marcado).toContain(`href="/catalogo/productos/${P}/compra"`);
  });

  it("el botón de guardar sale apagado mientras no hay nombre ni cantidad, y también sin permiso", async () => {
    expect(await html("/nueva/page")).toMatch(/<button[^>]*disabled[^>]*>Agregar presentación/);
    puede(["productos.ver"]);
    expect(await html("/nueva/page")).toMatch(/<button[^>]*disabled[^>]*>Agregar presentación/);
  });

  it("un producto que no está es el genérico y no hay formulario", async () => {
    responde({ ok: false, error: errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA") });
    const marcado = await html("/nueva/page");
    expect(marcado).not.toContain('name="nombre"');
    expect(await texto("/nueva/page")).toContain("Esta acción no está permitida");
  });
});

describe("editar una presentación", () => {
  it("el título es el nombre; el campo trae el nombre actual, la cantidad se ve sin campo y «Desactivar» está aparte", async () => {
    const marcado = await html("/[presentacionId]/page", { id: P, presentacionId: A });
    expect([...marcado.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)].map((m) => m[1])).toEqual([
      "Caja de 5 kg",
    ]);
    expect(marcado).toContain('value="Caja de 5 kg"');
    expect(marcado).not.toContain('name="cantidad"');
    const t = await texto("/[presentacionId]/page", { id: P, presentacionId: A });
    for (const visible of [
      "Cantidad en la unidad base (kg)",
      "5",
      "Cancelar",
      "Guardar",
      "Desactivar",
    ]) {
      expect(t).toContain(visible);
    }
    expect(mundo.llamadas).toEqual([
      { pagina: "una", contexto: { id: "contexto" }, id: P, presentacionId: A },
      { pagina: "una", contexto: { id: "contexto" }, id: P, presentacionId: A },
    ]);
  });

  it("una presentación desactivada y de peso variable dice «Peso aproximado», «De peso variable» y ofrece «Reactivar»", async () => {
    respondeUna({ ok: true, dato: { producto: PRODUCTO, presentacion: HORMA } });
    const t = await texto("/[presentacionId]/page", { id: P, presentacionId: B });
    for (const visible of ["Peso aproximado (kg)", "≈ 4", "De peso variable", "Reactivar"]) {
      expect(t).toContain(visible);
    }
    expect(t).not.toContain("Desactivar");
  });

  it("sin productos.editar «Guardar» y «Desactivar» salen apagados", async () => {
    puede(["productos.ver"]);
    const marcado = await html("/[presentacionId]/page", { id: P, presentacionId: A });
    for (const visible of ["Guardar", "Desactivar"]) {
      expect(marcado).toMatch(new RegExp(`<button[^>]*disabled[^>]*>${visible}`));
    }
  });

  it("una presentación que no es del producto es el genérico y no hay formulario", async () => {
    respondeUna({ ok: false, error: errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA") });
    const marcado = await html("/[presentacionId]/page", { id: P, presentacionId: "x" });
    expect(marcado).not.toContain('name="nombre"');
  });
});
