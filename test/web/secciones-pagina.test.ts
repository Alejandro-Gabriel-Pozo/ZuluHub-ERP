import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeCodigo, type Respuesta } from "../../src/capacidades/experiencia/respuesta";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * Las páginas de «Secciones de la carta» (A8, partes 1 y 2): la lista, la sección con sus productos, el alta, el nombre y «Agregar producto». Cada una pide al servidor lo suyo con el contexto de la empresa, liga a la
 * acción lo que la persona vio (la clave de creación, la sección y su versión, las secciones activas) y pinta cada situación con su texto del catálogo: «Guardar», las flechas y los botones
 * activos o apagados según el permiso, y los errores (el del guard con su motivo; el genérico para una sección que no está ahí; el inesperado con la referencia y sin el código crudo).
 * Un solo `h1` por página.
 */
vi.mock("server-only", () => ({}));
const mundo = vi.hoisted(
  (): {
    permisos: unknown;
    llamadas: { que: string; args: unknown[] }[];
    respuesta: Record<string, unknown>;
    claves: string[];
    ligadas: { accion: string; args: unknown[] }[];
  } => ({ permisos: null, llamadas: [], respuesta: {}, claves: [], ligadas: [] }),
);
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    consultasDeEmpresas: () => ({
      permisosDelActor: () => Promise.resolve(mundo.permisos),
    }),
  },
}));
const lectura =
  (que: string) =>
  (...args: unknown[]) => {
    mundo.llamadas.push({ que, args });
    return Promise.resolve(mundo.respuesta[que]);
  };
vi.mock("../../apps/web/servidor/secciones", () => ({
  cargarLasSecciones: lectura("lista"),
  cargarUnaSeccion: lectura("una"),
  cargarLaSeccion: lectura("sola"),
  cargarLosCandidatos: lectura("candidatos"),
  nuevaClaveDeSeccion: () => {
    const clave = `clave-${String(mundo.claves.length + 1)}`;
    mundo.claves.push(clave);
    return clave;
  },
}));
const accion = (nombre: string) => ({
  bind: (...ligadas: unknown[]) => {
    mundo.ligadas.push({ accion: nombre, args: ligadas });
    return () => Promise.resolve({ error: null });
  },
});
vi.mock("../../apps/web/app/s/app/acciones-de-secciones", () => ({
  crearSeccionAccion: accion("crear"),
  renombrarSeccionAccion: accion("renombrar"),
  moverSeccionAccion: accion("mover"),
  desactivarSeccionAccion: accion("desactivar"),
  reactivarSeccionAccion: accion("reactivar"),
  quitarProductoDeSeccionAccion: accion("quitar"),
  agregarProductoASeccionAccion: accion("agregar"),
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

const A = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const B = "5c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const C = "7d2e1f00-1111-4222-8333-944455556666";
const BASE = "../../apps/web/app/s/app/(operacion)/catalogo/secciones";
type Pagina = (p: Record<string, unknown>) => Promise<unknown>;
const cargar = (ruta: string): Promise<{ default: Pagina }> =>
  import(/* @vite-ignore */ `${BASE}${ruta}`);

const html = async (ruta: string, props: Record<string, unknown> = {}) => {
  const { default: Pagina } = await cargar(ruta);
  return renderToStaticMarkup((await Pagina(props)) as ReactNode);
};
const texto = async (ruta: string, props?: Record<string, unknown>) =>
  (await html(ruta, props)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
/** Lo de la pantalla, sin el armazón (la barra de abajo también es una lista). */
const principal = (marcado: string): string =>
  /<main\b[^>]*>(.*)<\/main>/s.exec(marcado)?.[1] ?? "";
const h1 = (marcado: string) => [...marcado.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)].map((m) => m[1]);

const responde = (que: string, r: Respuesta<unknown>) => {
  mundo.respuesta[que] = r;
};
const puede = (acciones: string[]) => {
  mundo.permisos = {
    ok: true,
    valor: { acciones, modulos: { activos: ["catalogo"], enSoloLectura: [] } },
  };
};
const CAFES = { id: A, nombre: "Cafés", activa: true, version: 3 };
const POSTRES = { id: B, nombre: "Postres", activa: false, version: 1 };
const BEBIDAS = { id: C, nombre: "Bebidas", activa: true, version: 5 };
const UNA = (seccion = CAFES) => ({
  seccion,
  productos: [
    { id: "p1", nombre: "Cortado", version: 4 },
    { id: "p2", nombre: "Espresso", version: 9 },
  ],
  siguiente: null,
});
const CANDIDATOS = (seccion = CAFES) => ({
  seccion,
  candidatos: [
    { id: "p3", nombre: "Budín", version: 2, faltaCompletar: true, seccion: null },
    { id: "p4", nombre: "Flan", version: 6, faltaCompletar: false, seccion: "Postres" },
    { id: "p5", nombre: "Milanesa", version: 1, faltaCompletar: false, seccion: null },
  ],
  siguiente: null,
});
const PROPS_DE_UNA = (id = A, direccion: Record<string, string> = {}) => ({
  params: Promise.resolve({ id }),
  searchParams: Promise.resolve(direccion),
});

beforeEach(() => {
  Object.assign(mundo, { llamadas: [], claves: [], ligadas: [], respuesta: {} });
  responde("lista", { ok: true, dato: { secciones: [CAFES, POSTRES, BEBIDAS] } });
  responde("una", { ok: true, dato: UNA() });
  responde("sola", { ok: true, dato: CAFES });
  responde("candidatos", { ok: true, dato: CANDIDATOS() });
  puede(["productos.ver", "productos.editar"]);
});

describe("la página de la lista de secciones", () => {
  it("un solo h1, «Secciones», y una fila por sección: las activas primero y las desactivadas al final con «Desactivado»", async () => {
    const marcado = await html("/page");
    expect(h1(marcado)).toEqual(["Secciones"]);
    const nombres = [
      ...marcado.matchAll(/<a [^>]*href="\/catalogo\/secciones\/[^"]+"[^>]*>(.*?)<\/a>/g),
    ].map((m) =>
      (m[1] ?? "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    );
    expect(nombres.slice(0, 3)).toEqual(["Cafés", "Bebidas", "Postres Desactivado"]);
    expect(marcado).toContain(`href="/catalogo/secciones/${A}"`);
  });

  it("pide las secciones con el contexto del servidor, y nada más", async () => {
    await html("/page");
    expect(mundo.llamadas).toEqual([{ que: "lista", args: [{ id: "contexto" }] }]);
  });

  it("las flechas de las activas llevan el nombre accesible con la sección; la primera no sube y la última no baja; la desactivada no tiene", async () => {
    const marcado = await html("/page");
    const flechas = [...marcado.matchAll(/<button\b([^>]*)>/g)].map((m) => m[1] ?? "");
    const nombre = (a: string) => /aria-label="([^"]*)"/.exec(a)?.[1];
    expect(flechas.map(nombre)).toEqual([
      "Subir Cafés",
      "Bajar Cafés",
      "Subir Bebidas",
      "Bajar Bebidas",
    ]);
    expect(flechas.map((a) => /\bdisabled\b/.test(a))).toEqual([true, false, false, true]);
    expect(flechas.map((a) => /name="(subir|bajar)"/.exec(a)?.[1])).toEqual([
      "subir",
      "bajar",
      "subir",
      "bajar",
    ]);
    expect(marcado).not.toContain("Subir Postres");
  });

  it("liga a la acción de las flechas las secciones activas como se ven, con la versión de cada una", async () => {
    await html("/page");
    expect(mundo.ligadas).toEqual([
      {
        accion: "mover",
        args: [
          null,
          [
            { seccionId: A, versionEsperada: 3 },
            { seccionId: C, versionEsperada: 5 },
          ],
        ],
      },
    ]);
  });

  it("«Nueva sección» sale con productos.editar y lleva al alta", async () => {
    const marcado = await html("/page");
    expect(marcado).toMatch(/<a [^>]*href="\/catalogo\/secciones\/nueva"[^>]*>Nueva sección<\/a>/);
  });

  it("sin productos.editar (un operador) no hay «Nueva sección» y las flechas salen apagadas, pero la lista se ve", async () => {
    puede(["productos.ver"]);
    const marcado = await html("/page");
    expect(marcado).not.toContain("Nueva sección");
    const flechas = [...marcado.matchAll(/<button\b([^>]*)>/g)].map((m) => m[1] ?? "");
    expect(flechas).toHaveLength(4);
    expect(flechas.every((a) => /\bdisabled\b/.test(a))).toBe(true);
    expect(await texto("/page")).toContain("Cafés");
  });

  it("si no se pudieron leer los permisos, no hay «Nueva sección» (cierra, no abre)", async () => {
    mundo.permisos = { ok: false, error: "SIN_PERMISO" };
    expect(await html("/page")).not.toContain("Nueva sección");
  });

  it("una empresa sin secciones muestra la lista vacía y «Nueva sección», sin texto nuevo", async () => {
    responde("lista", { ok: true, dato: { secciones: [] } });
    const marcado = await html("/page");
    expect(marcado).toContain("Nueva sección");
    expect(principal(marcado)).not.toContain("<li");
  });

  it("el motivo del guard (el módulo en desarrollo) sale con su texto y sin lista", async () => {
    responde("lista", { ok: false, error: errorDeCodigo("MODULO_EN_DESARROLLO") });
    const marcado = await html("/page");
    expect(marcado).not.toContain("<form");
    expect(marcado).not.toContain("MODULO_EN_DESARROLLO");
    expect(await texto("/page")).toContain("Esta función todavía está en desarrollo.");
    expect(marcado).not.toContain("Nueva sección");
  });

  it("un fallo inesperado sale con su referencia y sin el código crudo", async () => {
    responde("lista", {
      ok: false,
      error: { ...errorDeCodigo("ERROR_INTERNO"), referencia: "PD-ABC123" },
    });
    const t = await texto("/page");
    expect(t).toContain("PD-ABC123");
    expect(t).not.toContain("ERROR_INTERNO");
  });
});

describe("la página de una sección", () => {
  const RUTA = "/[id]/page";

  it("un solo h1 con el nombre de la sección; «Nombre», «Desactivar» y sus productos en orden", async () => {
    const marcado = await html(RUTA, PROPS_DE_UNA());
    expect(h1(marcado)).toEqual(["Cafés"]);
    expect(marcado).toMatch(
      new RegExp(`<a [^>]*href="/catalogo/secciones/${A}/nombre"[^>]*>Nombre</a>`),
    );
    expect(marcado).toMatch(/<button[^>]*type="submit"[^>]*>Desactivar/);
    expect(
      [...principal(marcado).matchAll(/<li\b[^>]*>(.*?)<\/li>/g)].map((m) =>
        (m[1] ?? "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
      ),
    ).toEqual(["Cortado Quitar", "Espresso Quitar"]);
  });

  it("«Agregar producto» lleva a elegir; «Quitar» sale en cada producto y viaja con el id del producto en su valor, no con la versión", async () => {
    const marcado = await html(RUTA, PROPS_DE_UNA());
    expect(marcado).toMatch(
      new RegExp(`<a [^>]*href="/catalogo/secciones/${A}/agregar"[^>]*>Agregar producto</a>`),
    );
    const quitar = [...marcado.matchAll(/<button\b([^>]*)>Quitar<\/button>/g)].map(
      (m) => m[1] ?? "",
    );
    expect(quitar).toHaveLength(2);
    expect(quitar.map((a) => /name="quitar"/.test(a))).toEqual([true, true]);
    expect(quitar.map((a) => /value="([^"]*)"/.exec(a)?.[1])).toEqual(["p1", "p2"]);
    expect(quitar.every((a) => /type="submit"/.test(a) && !/\bdisabled\b/.test(a))).toBe(true);
    expect(marcado).not.toContain("versionEsperada");
    expect(marcado).not.toMatch(/value="(4|9)"/);
  });

  it("liga a «Quitar» la sección y los productos como se ven, con su versión", async () => {
    await html(RUTA, PROPS_DE_UNA());
    expect(mundo.ligadas).toContainEqual({
      accion: "quitar",
      args: [
        null,
        A,
        [
          { productoId: "p1", versionEsperada: 4 },
          { productoId: "p2", versionEsperada: 9 },
        ],
      ],
    });
  });

  it("sin productos.editar (un operador) «Agregar producto» y «Quitar» salen apagados, pero los productos se ven", async () => {
    puede(["productos.ver"]);
    const marcado = await html(RUTA, PROPS_DE_UNA());
    expect(marcado).not.toContain("/agregar");
    expect(marcado).toMatch(/<button[^>]*disabled[^>]*>Agregar producto/);
    const quitar = [...marcado.matchAll(/<button\b([^>]*)>Quitar<\/button>/g)].map(
      (m) => m[1] ?? "",
    );
    expect(quitar).toHaveLength(2);
    expect(quitar.every((a) => /\bdisabled\b/.test(a))).toBe(true);
    expect(await texto(RUTA, PROPS_DE_UNA())).toContain("Cortado");
  });

  it("si no se pudieron leer los permisos, «Agregar producto» y «Quitar» salen apagados (cierra, no abre)", async () => {
    mundo.permisos = { ok: false, error: "SIN_PERMISO" };
    const marcado = await html(RUTA, PROPS_DE_UNA());
    expect(marcado).not.toContain("/agregar");
    expect(marcado).toMatch(/<button[^>]*disabled[^>]*>Agregar producto/);
  });

  it("el botón ‹ vuelve a la lista con su nombre accesible", async () => {
    const marcado = await html(RUTA, PROPS_DE_UNA());
    expect(marcado).toMatch(
      /<a [^>]*href="\/catalogo\/secciones"[^>]*aria-label="Volver a la lista"/,
    );
  });

  it("pide la sección con el contexto del servidor, el id de la dirección y la página de la dirección", async () => {
    await html(RUTA, PROPS_DE_UNA(A, { despues: `${B}:cortado` }));
    expect(mundo.llamadas).toEqual([{ que: "una", args: [{ id: "contexto" }, A, `${B}:cortado`] }]);
    mundo.llamadas = [];
    await html(RUTA, PROPS_DE_UNA(A));
    expect(mundo.llamadas[0]?.args).toEqual([{ id: "contexto" }, A, ""]);
  });

  it("una sección activa liga «Desactivar» a la sección; una desactivada, «Reactivar», con su marca", async () => {
    const deEstado = () => mundo.ligadas.filter((l) => l.accion !== "quitar");
    await html(RUTA, PROPS_DE_UNA());
    expect(deEstado()).toEqual([{ accion: "desactivar", args: [null, A] }]);
    mundo.ligadas = [];
    responde("una", { ok: true, dato: UNA(POSTRES) });
    const marcado = await html(RUTA, PROPS_DE_UNA(B));
    expect(deEstado()).toEqual([{ accion: "reactivar", args: [null, B] }]);
    expect(marcado).toMatch(/<button[^>]*type="submit"[^>]*>Reactivar/);
    expect(await texto(RUTA, PROPS_DE_UNA(B))).toContain("Desactivado");
  });

  it("una sección sin productos no dice nada, pero ofrece «Agregar producto»", async () => {
    responde("una", { ok: true, dato: { seccion: CAFES, productos: [], siguiente: null } });
    const marcado = await html(RUTA, PROPS_DE_UNA());
    expect(principal(marcado)).not.toContain("<li");
    expect(marcado).toContain("Agregar producto");
    expect(await texto(RUTA, PROPS_DE_UNA())).not.toContain("Sin resultados");
  });

  it("«Página siguiente» lleva a la dirección de la sección con la clave de la consulta", async () => {
    responde("una", { ok: true, dato: { ...UNA(), siguiente: `${B}:espresso` } });
    const marcado = await html(RUTA, PROPS_DE_UNA());
    expect(marcado).toContain(
      `href="/catalogo/secciones/${A}?despues=${encodeURIComponent(`${B}:espresso`)}"`,
    );
    expect(marcado).toContain("Página siguiente");
  });

  it("sin productos.editar «Nombre» y «Desactivar» salen apagados", async () => {
    puede(["productos.ver"]);
    const marcado = await html(RUTA, PROPS_DE_UNA());
    expect(marcado).not.toContain("/nombre");
    expect(marcado).toMatch(/<button[^>]*disabled[^>]*>Nombre/);
    expect(marcado).toMatch(/<button[^>]*disabled[^>]*>Desactivar/);
  });

  it("una sección que no es de la empresa sale como el genérico, sin formulario ni productos", async () => {
    responde("una", { ok: false, error: errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA") });
    const marcado = await html(RUTA, PROPS_DE_UNA(C));
    expect(marcado).not.toContain("<form");
    expect(await texto(RUTA, PROPS_DE_UNA(C))).toContain("Esta acción no está permitida");
  });

  it("un fallo inesperado sale con su referencia y sin el código crudo", async () => {
    responde("una", {
      ok: false,
      error: { ...errorDeCodigo("ERROR_INTERNO"), referencia: "PD-ABC123" },
    });
    const t = await texto(RUTA, PROPS_DE_UNA());
    expect(t).toContain("PD-ABC123");
    expect(t).not.toContain("ERROR_INTERNO");
  });
});

describe("la página de la sección nueva", () => {
  const RUTA = "/nueva/page";

  it("un solo h1, «Nueva sección», y un campo «Nombre» vacío con «Cancelar» y «Guardar»", async () => {
    const marcado = await html(RUTA);
    expect(h1(marcado)).toEqual(["Nueva sección"]);
    expect(marcado).toMatch(/<label[^>]*>Nombre<\/label>/);
    expect(marcado).toMatch(/<input[^>]*name="nombre"[^>]*value=""/);
    expect(marcado.match(/<input/g)).toHaveLength(1);
    expect(marcado).toMatch(/<a [^>]*href="\/catalogo\/secciones"[^>]*>Cancelar<\/a>/);
    expect(marcado).toMatch(/<button[^>]*>Guardar/);
  });

  it("fija UNA clave de creación por apertura y la liga sola a la acción; abrir otra vez es otra clave", async () => {
    await html(RUTA);
    expect(mundo.ligadas).toEqual([{ accion: "crear", args: [null, "clave-1"] }]);
    await html(RUTA);
    expect(mundo.ligadas.map((l) => l.args)).toEqual([
      [null, "clave-1"],
      [null, "clave-2"],
    ]);
    expect(await html(RUTA)).not.toContain("clave-");
  });

  it("«Guardar» sale apagado con el nombre vacío; sin productos.editar o sin poder leer los permisos, también", async () => {
    expect(await html(RUTA)).toMatch(/<button[^>]*disabled[^>]*>Guardar/);
    puede(["productos.ver"]);
    expect(await html(RUTA)).toMatch(/<button[^>]*disabled[^>]*>Guardar/);
    mundo.permisos = { ok: false, error: "SIN_PERMISO" };
    expect(await html(RUTA)).toMatch(/<button[^>]*disabled[^>]*>Guardar/);
  });
});

describe("la página del nombre de una sección", () => {
  const RUTA = "/[id]/nombre/page";
  const props = (id = A) => ({ params: Promise.resolve({ id }) });

  it("un solo h1 con el nombre de la sección, y el campo «Nombre» con el nombre actual", async () => {
    const marcado = await html(RUTA, props());
    expect(h1(marcado)).toEqual(["Cafés"]);
    expect(marcado).toMatch(/<input[^>]*name="nombre"[^>]*value="Cafés"/);
    expect(marcado).toMatch(/<button[^>]*type="submit"[^>]*>Guardar/);
  });

  it("pide la sección con el contexto del servidor y el id de la dirección, y liga la versión que vio a la acción", async () => {
    await html(RUTA, props());
    expect(mundo.llamadas).toEqual([{ que: "sola", args: [{ id: "contexto" }, A] }]);
    expect(mundo.ligadas).toEqual([{ accion: "renombrar", args: [null, A, 3] }]);
  });

  it("sin productos.editar «Guardar» sale apagado", async () => {
    puede(["productos.ver"]);
    expect(await html(RUTA, props())).toMatch(/<button[^>]*disabled[^>]*>Guardar/);
  });

  it("una sección que no es de la empresa sale como el genérico, sin formulario", async () => {
    responde("sola", { ok: false, error: errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA") });
    const marcado = await html(RUTA, props(C));
    expect(marcado).not.toContain("<form");
    expect(await texto(RUTA, props(C))).toContain("Esta acción no está permitida");
  });
});

describe("la página de «Agregar producto»", () => {
  const RUTA = "/[id]/agregar/page";

  it("un solo h1, «Agregar producto»; el buscador «Buscar» con su botón, una fila por candidato con su sección al lado y «Cancelar» a la sección", async () => {
    const marcado = await html(RUTA, PROPS_DE_UNA());
    expect(h1(marcado)).toEqual(["Agregar producto"]);
    expect(marcado).toMatch(
      /<form[^>]*action="\/catalogo\/secciones\/[^"]+\/agregar"[^>]*method="get"/,
    );
    expect(marcado).toMatch(/<label[^>]*>Buscar<\/label>/);
    expect(marcado).toMatch(/<input[^>]*type="search"[^>]*name="texto"/);
    expect(marcado).toMatch(/<button[^>]*type="submit"[^>]*>Buscar<\/button>/);
    const filas = [
      ...principal(marcado).matchAll(/<button\b[^>]*name="agregar"[^>]*>(.*?)<\/button>/g),
    ].map((m) =>
      (m[1] ?? "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    );
    expect(filas).toEqual(["Budín Falta completar", "Flan Postres", "Milanesa Sin elegir"]);
    expect(marcado).toMatch(
      new RegExp(`<a [^>]*href="/catalogo/secciones/${A}"[^>]*>Cancelar</a>`),
    );
  });

  it("cada candidato viaja con su id en el valor; el que falta completar sale apagado y los demás no", async () => {
    const marcado = await html(RUTA, PROPS_DE_UNA());
    const botones = [...marcado.matchAll(/<button\b([^>]*name="agregar"[^>]*)>/g)].map(
      (m) => m[1] ?? "",
    );
    expect(botones.map((a) => /value="([^"]*)"/.exec(a)?.[1])).toEqual(["p3", "p4", "p5"]);
    expect(botones.map((a) => /\bdisabled\b/.test(a))).toEqual([true, false, false]);
    expect(marcado).not.toMatch(/value="(2|6|1)"/);
  });

  it("pide los candidatos con el contexto del servidor, el id, el texto y la página de la dirección; el texto vuelve al campo", async () => {
    const marcado = await html(RUTA, PROPS_DE_UNA(A, { texto: " fla ", despues: `${B}:flan` }));
    expect(mundo.llamadas).toEqual([
      { que: "candidatos", args: [{ id: "contexto" }, A, "fla", `${B}:flan`] },
    ]);
    expect(marcado).toMatch(/<input[^>]*name="texto"[^>]*value="fla"/);
    mundo.llamadas = [];
    await html(RUTA, PROPS_DE_UNA(A));
    expect(mundo.llamadas[0]?.args).toEqual([{ id: "contexto" }, A, "", ""]);
  });

  it("liga a la acción la sección y los candidatos como se ven, con su versión", async () => {
    await html(RUTA, PROPS_DE_UNA());
    expect(mundo.ligadas).toEqual([
      {
        accion: "agregar",
        args: [
          null,
          A,
          [
            { productoId: "p3", versionEsperada: 2 },
            { productoId: "p4", versionEsperada: 6 },
            { productoId: "p5", versionEsperada: 1 },
          ],
        ],
      },
    ]);
  });

  it("sin productos.editar todos los candidatos salen apagados, pero se ven; sin poder leer los permisos, también", async () => {
    for (const cierre of [
      () => puede(["productos.ver"]),
      () => (mundo.permisos = { ok: false, error: "SIN_PERMISO" }),
    ]) {
      cierre();
      const marcado = await html(RUTA, PROPS_DE_UNA());
      const botones = [...marcado.matchAll(/<button\b([^>]*name="agregar"[^>]*)>/g)].map(
        (m) => m[1] ?? "",
      );
      expect(botones).toHaveLength(3);
      expect(botones.every((a) => /\bdisabled\b/.test(a))).toBe(true);
    }
  });

  it("«Página siguiente» conserva el texto buscado", async () => {
    responde("candidatos", { ok: true, dato: { ...CANDIDATOS(), siguiente: `${B}:flan` } });
    const marcado = await html(RUTA, PROPS_DE_UNA(A, { texto: "fla" }));
    expect(marcado).toContain(
      `href="/catalogo/secciones/${A}/agregar?texto=fla&amp;despues=${encodeURIComponent(`${B}:flan`)}"`,
    );
    expect(marcado).toContain("Página siguiente");
  });

  it("una lista sin candidatos no dice nada, pero el buscador y «Cancelar» siguen", async () => {
    responde("candidatos", { ok: true, dato: { seccion: CAFES, candidatos: [], siguiente: null } });
    const marcado = await html(RUTA, PROPS_DE_UNA());
    expect(marcado).not.toContain('name="agregar"');
    expect(await texto(RUTA, PROPS_DE_UNA())).not.toContain("Sin resultados");
    expect(marcado).toContain("Cancelar");
  });

  it("una sección que no es de la empresa sale como el genérico, sin formulario ni candidatos", async () => {
    responde("candidatos", { ok: false, error: errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA") });
    const marcado = await html(RUTA, PROPS_DE_UNA(C));
    expect(marcado).not.toContain("<form");
    expect(await texto(RUTA, PROPS_DE_UNA(C))).toContain("Esta acción no está permitida");
  });

  it("el motivo del guard (el módulo en desarrollo) sale con su texto y sin lista", async () => {
    responde("candidatos", { ok: false, error: errorDeCodigo("MODULO_EN_DESARROLLO") });
    const marcado = await html(RUTA, PROPS_DE_UNA());
    expect(marcado).not.toContain("<form");
    expect(await texto(RUTA, PROPS_DE_UNA())).toContain("Esta función todavía está en desarrollo.");
  });

  it("un fallo inesperado sale con su referencia y sin el código crudo", async () => {
    responde("candidatos", {
      ok: false,
      error: { ...errorDeCodigo("ERROR_INTERNO"), referencia: "PD-ABC123" },
    });
    const t = await texto(RUTA, PROPS_DE_UNA());
    expect(t).toContain("PD-ABC123");
    expect(t).not.toContain("ERROR_INTERNO");
  });
});
