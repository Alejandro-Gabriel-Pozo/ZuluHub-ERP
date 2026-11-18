import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeCodigo, type Respuesta } from "../../src/capacidades/experiencia/respuesta";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * Las páginas de las opciones de un producto (A13, tramo Opciones): la solapa (con la hoja de «Copiar de otro producto» si la dirección trae `?copiar=`), grupo nuevo y editar un grupo. Cada una
 * lee los ids de la dirección, pide lo suyo al servidor con el contexto de la empresa y pinta cada situación con su texto del catálogo: los grupos con sus reglas y recargos, los botones de
 * escribir SIEMPRE (apagados sin `opciones.editar`), los formularios con sus campos, «Guardar» y «Copiar» activos o apagados según el permiso, y los errores (el del guard con su motivo; el
 * genérico para lo que no está; el inesperado con la referencia). Un solo `h1`: el nombre del producto en la solapa; «Agregar grupo» o «Editar» en la pantalla de un grupo. Sin entrada en la
 * barra: se llega desde la ficha.
 */
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: () => undefined,
  useRouter: () => ({ replace: () => undefined }),
}));
const mundo = vi.hoisted(
  (): {
    permisos: unknown;
    llamadas: {
      pagina: string;
      contexto: unknown;
      id: string;
      grupoId?: string | null;
      origenPedido?: string | null;
    }[];
    respuesta: unknown;
    respuestaCopia: unknown;
  } => ({ permisos: null, llamadas: [], respuesta: null, respuestaCopia: null }),
);
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    consultasDeEmpresas: () => ({
      permisosDelActor: () => Promise.resolve(mundo.permisos),
    }),
  },
}));
vi.mock("../../apps/web/servidor/opciones", () => ({
  cargarLasOpciones: (contexto: unknown, id: string) => {
    mundo.llamadas.push({ pagina: "opciones", contexto, id });
    return Promise.resolve(mundo.respuesta);
  },
  cargarUnGrupo: (contexto: unknown, id: string, grupoId: string | null) => {
    mundo.llamadas.push({ pagina: "grupo", contexto, id, grupoId });
    return Promise.resolve(mundo.respuesta);
  },
  cargarLaCopia: (contexto: unknown, id: string, origenPedido: string | null) => {
    mundo.llamadas.push({ pagina: "copia", contexto, id, origenPedido });
    return Promise.resolve(mundo.respuestaCopia);
  },
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
const BASE = "../../apps/web/app/s/app/(operacion)/catalogo/productos/[id]/opciones";
type Buscar = Record<string, string | string[] | undefined>;
type Pagina = (p: {
  params: Promise<Record<string, string>>;
  searchParams: Promise<Buscar>;
}) => Promise<unknown>;
const cargar = (ruta: string): Promise<{ default: Pagina }> =>
  import(/* @vite-ignore */ `${BASE}${ruta}`);

const html = async (
  ruta: string,
  params: Record<string, string> = { id: ID },
  buscar: Buscar = {},
) => {
  const { default: Pagina } = await cargar(ruta);
  return renderToStaticMarkup(
    (await Pagina({
      params: Promise.resolve(params),
      searchParams: Promise.resolve(buscar),
    })) as ReactNode,
  );
};
const texto = async (ruta: string, params?: Record<string, string>, buscar?: Buscar) =>
  (await html(ruta, params, buscar)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const SALSAS = {
  id: GRUPO,
  nombre: "Salsas",
  clase: "ADICIONAL",
  esObligatorio: false,
  admiteVarias: true,
  seMuestraEnCarta: true,
  opciones: [
    { id: "o1", nombre: "Mayonesa", recargo: "500.000000" },
    { id: "o2", nombre: "Ketchup", recargo: "0.000000" },
  ],
};
const OPCIONES = {
  id: ID,
  nombre: "Milanesa",
  versionDeOpciones: 4,
  grupos: [SALSAS],
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

beforeEach(() => {
  mundo.llamadas = [];
  puede(["productos.ver", "opciones.editar"]);
});

describe("la página de las opciones de un producto", () => {
  beforeEach(() => {
    responde({ ok: true, dato: OPCIONES });
  });

  it("un solo h1, el nombre del producto; «Copiar de otro producto», «Grupos de opciones», la tarjeta con sus reglas y opciones y «Agregar grupo», en el orden de la maqueta", async () => {
    const marcado = await html("/page");
    expect([...marcado.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)].map((m) => m[1])).toEqual(["Milanesa"]);
    const t = await texto("/page");
    const orden = [
      "Copiar de otro producto",
      "Grupos de opciones",
      "Salsas",
      "Adicional",
      "(opcional)",
      "Mayonesa + $ 500,00 · Ketchup",
      "Editar",
      "Agregar grupo",
    ].map((x) => t.indexOf(x));
    expect(orden.every((i) => i >= 0)).toBe(true);
    expect([...orden].sort((a, b) => a - b)).toEqual(orden);
  });

  it("pide las opciones con el contexto del servidor y el id de la dirección, y nada más", async () => {
    await html("/page");
    expect(mundo.llamadas).toEqual([{ pagina: "opciones", contexto: { id: "contexto" }, id: ID }]);
  });

  it("los botones llevan a las pantallas de escribir (la copia, por `?copiar=`)", async () => {
    const marcado = await html("/page");
    expect(marcado).toContain(`href="/catalogo/productos/${ID}/opciones/${GRUPO}"`);
    expect(marcado).toContain(`href="/catalogo/productos/${ID}/opciones/nuevo"`);
    expect(marcado).toContain(`href="/catalogo/productos/${ID}/opciones?copiar=1"`);
  });

  it("sin opciones.editar (un operador) se ven los grupos y los botones de escribir SIGUEN, apagados y sin enlace (maqueta: dis())", async () => {
    puede(["productos.ver"]);
    const marcado = await html("/page");
    const t = await texto("/page");
    expect(t).toContain("Salsas");
    for (const visible of ["Editar", "Agregar grupo", "Copiar de otro producto"]) {
      expect(marcado).toMatch(new RegExp(`<button[^>]*disabled[^>]*>${visible}`));
    }
    expect(marcado.slice(marcado.indexOf("<main"), marcado.indexOf("</main>"))).not.toContain(
      "<a ",
    );
  });

  it("si no se pudieron leer los permisos, los botones de escribir van apagados (cierra, no abre)", async () => {
    mundo.permisos = { ok: false, error: "SIN_PERMISO" };
    const marcado = await html("/page");
    expect(marcado).toMatch(/<button[^>]*disabled[^>]*>Agregar grupo/);
    expect(marcado.slice(marcado.indexOf("<main"), marcado.indexOf("</main>"))).not.toContain(
      "<a ",
    );
  });

  it("un producto sin grupos muestra el título de la sección y «Agregar grupo»", async () => {
    responde({ ok: true, dato: { ...OPCIONES, grupos: [] } });
    const t = await texto("/page");
    expect(t).toContain("Grupos de opciones");
    expect(t).toContain("Agregar grupo");
  });

  it("el motivo del guard (el módulo en desarrollo) sale con su texto y sin los grupos", async () => {
    responde({ ok: false, error: errorDeCodigo("MODULO_EN_DESARROLLO") });
    const marcado = await html("/page");
    expect(marcado).not.toContain("MODULO_EN_DESARROLLO");
    expect(await texto("/page")).toContain("Esta función todavía está en desarrollo.");
    expect(await texto("/page")).not.toContain("Salsas");
  });

  it("un producto que no está sale como el genérico, y un fallo inesperado con su referencia y sin el código crudo", async () => {
    responde({ ok: false, error: errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA") });
    expect(await texto("/page", { id: "no-existe" })).toContain("Esta acción no está permitida");
    responde({ ok: false, error: { ...errorDeCodigo("ERROR_INTERNO"), referencia: "PD-ABC123" } });
    const t = await texto("/page");
    expect(t).toContain("PD-ABC123");
    expect(t).not.toContain("ERROR_INTERNO");
  });
});

describe("la solapa con la hoja de «Copiar de otro producto» (`?copiar=`)", () => {
  const COPIA = {
    id: ID,
    nombre: "Milanesa",
    versionDeOpciones: 4,
    candidatos: [
      { id: "a", nombre: "Hamburguesa" },
      { id: "b", nombre: "Pizza" },
    ],
    origen: "a",
    vistaPrevia: [
      {
        nombre: "Guarnición",
        clase: "INCLUIDA",
        opciones: [
          { nombre: "Papas fritas", recargo: null },
          { nombre: "Ensalada", recargo: null },
        ],
      },
      {
        nombre: "Salsas",
        clase: "ADICIONAL",
        opciones: [{ nombre: "Mayonesa", recargo: "500.00" }],
      },
    ],
    claveDeLaCopia: "c",
  };
  beforeEach(() => {
    responde({ ok: true, dato: OPCIONES });
    mundo.respuestaCopia = { ok: true, dato: COPIA };
  });

  it("sin `copiar` no hay hoja ni se pide la copia", async () => {
    const marcado = await html("/page");
    expect(marcado).not.toContain("<dialog");
    expect(mundo.llamadas.map((l) => l.pagina)).toEqual(["opciones"]);
  });

  it("con `copiar` la solapa se dibuja Y la hoja abierta: «Producto» con los candidatos, la vista previa, «Cancelar» y «Copiar»", async () => {
    const marcado = await html("/page", { id: ID }, { copiar: "1" });
    expect([...marcado.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)].map((m) => m[1])).toEqual(["Milanesa"]);
    expect(marcado).toContain("Grupos de opciones");
    expect(marcado).toMatch(/<dialog[^>]*>/);
    expect(marcado).toMatch(/<select[^>]*name="productoOrigenId"/);
    expect(marcado).toContain(">Hamburguesa</option>");
    expect(marcado).toContain(">Pizza</option>");
    const t = await texto("/page", { id: ID }, { copiar: "1" });
    expect(t).toContain("Guarnición: Papas fritas · Ensalada");
    expect(t).toContain("Salsas: Mayonesa + $ 500,00");
    expect(marcado).toMatch(/<button[^>]*>Cancelar/);
    expect(marcado).toMatch(/<button[^>]*type="submit"[^>]*>Copiar/);
  });

  it("el origen de la dirección se pasa al servidor como pedido (solo si es un texto; `1` es «abrir») y nada más", async () => {
    await html("/page", { id: ID }, { copiar: "1" });
    await html("/page", { id: ID }, { copiar: "b" });
    await html("/page", { id: ID }, { copiar: ["a", "b"] });
    await html("/page", { id: ID }, { copiar: "' or 1=1 --" });
    expect(mundo.llamadas.filter((l) => l.pagina === "copia")).toEqual([
      { pagina: "copia", contexto: { id: "contexto" }, id: ID, origenPedido: null },
      { pagina: "copia", contexto: { id: "contexto" }, id: ID, origenPedido: "b" },
      { pagina: "copia", contexto: { id: "contexto" }, id: ID, origenPedido: null },
      { pagina: "copia", contexto: { id: "contexto" }, id: ID, origenPedido: "' or 1=1 --" },
    ]);
  });

  it("sin permiso «Copiar» sale apagado en la hoja; sin nada para traer, también; sin candidatos la hoja se abre con «Copiar» apagado", async () => {
    puede(["productos.ver"]);
    expect(await html("/page", { id: ID }, { copiar: "1" })).toMatch(
      /<button[^>]*disabled[^>]*>Copiar</,
    );
    puede(["productos.ver", "opciones.editar"]);
    mundo.respuestaCopia = { ok: true, dato: { ...COPIA, vistaPrevia: [] } };
    expect(await html("/page", { id: ID }, { copiar: "1" })).toMatch(
      /<button[^>]*disabled[^>]*>Copiar</,
    );
    mundo.respuestaCopia = {
      ok: true,
      dato: { ...COPIA, candidatos: [], origen: null, vistaPrevia: [] },
    };
    const sin = await html("/page", { id: ID }, { copiar: "1" });
    expect(sin).toMatch(/<dialog[^>]*>/);
    expect(sin).toMatch(/<button[^>]*disabled[^>]*>Copiar</);
  });

  it("si la copia no se puede leer sale el error (el genérico) en lugar de la hoja", async () => {
    mundo.respuestaCopia = { ok: false, error: errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA") };
    const marcado = await html("/page", { id: ID }, { copiar: "1" });
    expect(marcado).not.toContain("<dialog");
    expect(await texto("/page", { id: ID }, { copiar: "1" })).toContain(
      "Esta acción no está permitida",
    );
  });
});

describe("la página de un grupo nuevo", () => {
  beforeEach(() => {
    responde({
      ok: true,
      dato: { id: ID, nombre: "Milanesa", versionDeOpciones: 4, grupo: null, claveDelCambio: "c" },
    });
  });

  it("un solo h1, «Agregar grupo»; el nombre, los dos botones «Incluida» y «Adicional», las tres casillas, las filas (sin «Quitar»), «Agregar opción» y «Guardar»", async () => {
    const marcado = await html("/nuevo/page");
    expect(mundo.llamadas).toEqual([
      { pagina: "grupo", contexto: { id: "contexto" }, id: ID, grupoId: null },
    ]);
    expect([...marcado.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)].map((m) => m[1])).toEqual([
      "Agregar grupo",
    ]);
    const t = await texto("/nuevo/page");
    const orden = [
      "Nombre",
      "Incluida",
      "Adicional",
      "Obligatorio",
      "Se puede elegir más de una",
      "No figura en la carta",
      "Recargo",
      "Agregar opción",
      "Guardar",
    ].map((x) => t.indexOf(x));
    expect(orden.every((i) => i >= 0)).toBe(true);
    expect([...orden].sort((a, b) => a - b)).toEqual(orden);
    expect(t).not.toContain("Quitar");
  });

  it("los campos viajan por su nombre: el grupo, la clase (un botón de opción por valor, «Incluida» elegida), las casillas y las dos filas (el recargo como texto decimal canónico)", async () => {
    const marcado = await html("/nuevo/page");
    for (const nombre of ["nombre", "esObligatorio", "admiteVarias", "fueraDeLaCarta"]) {
      expect(marcado).toContain(`name="${nombre}"`);
    }
    expect(marcado).toMatch(/<input[^>]*type="radio"[^>]*name="clase"[^>]*value="INCLUIDA"/);
    expect(marcado).toMatch(/<input[^>]*type="radio"[^>]*name="clase"[^>]*value="ADICIONAL"/);
    const radios = marcado.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];
    expect(radios.filter((r) => r.includes('checked=""'))).toHaveLength(1);
    expect(radios.find((r) => r.includes('value="INCLUIDA"'))).toContain('checked=""');
    expect(radios.some((r) => r.includes("disabled"))).toBe(false);
    expect(marcado).not.toContain('name="esAdicional"');
    for (const fila of ["n0", "n1"]) {
      expect(marcado).toMatch(new RegExp(`<input[^>]*name="opcion_${fila}_nombre"`));
      expect(marcado).toMatch(
        new RegExp(`<input[^>]*name="opcion_${fila}_recargo"[^>]*value="0.00"`),
      );
    }
    expect(marcado).not.toContain('name="opcion_n2_nombre"');
  });

  it("«Guardar» sale activo con opciones.editar y apagado sin él, sin texto nuevo", async () => {
    expect(await html("/nuevo/page")).toMatch(/<button[^>]*type="submit"[^>]*>Guardar/);
    puede(["productos.ver"]);
    expect(await html("/nuevo/page")).toMatch(/<button[^>]*disabled[^>]*>Guardar/);
    expect(await texto("/nuevo/page")).not.toContain("Esta acción no está permitida");
  });

  it("un producto que no está sale como el genérico, sin formulario", async () => {
    responde({ ok: false, error: errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA") });
    expect(await html("/nuevo/page")).not.toContain("<form");
  });
});

describe("la página de un grupo que ya existe", () => {
  beforeEach(() => {
    responde({
      ok: true,
      dato: {
        id: ID,
        nombre: "Milanesa",
        versionDeOpciones: 4,
        grupo: SALSAS,
        claveDelCambio: "c",
      },
    });
  });

  it("pide el grupo con los dos ids de la dirección; «Editar» de título, «Incluida / Adicional» apagado con su valor (que viaja igual) y una fila por opción con su recargo", async () => {
    const params = { id: ID, grupoId: GRUPO };
    const marcado = await html("/[grupoId]/page", params);
    expect(mundo.llamadas).toEqual([
      { pagina: "grupo", contexto: { id: "contexto" }, id: ID, grupoId: GRUPO },
    ]);
    expect([...marcado.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)].map((m) => m[1])).toEqual(["Editar"]);
    const t = await texto("/[grupoId]/page", params);
    expect(t).toContain("Incluida");
    expect(t).toContain("Adicional");
    const radios = marcado.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];
    expect(radios).toHaveLength(2);
    expect(radios.every((r) => r.includes('disabled=""'))).toBe(true);
    expect(radios.find((r) => r.includes('value="ADICIONAL"'))).toContain('checked=""');
    expect(radios.find((r) => r.includes('value="INCLUIDA"'))).not.toContain('checked=""');
    expect(radios.some((r) => r.includes('name="clase"'))).toBe(false);
    expect(marcado).toMatch(/<input[^>]*type="hidden"[^>]*name="clase"[^>]*value="ADICIONAL"/);
    expect(marcado).not.toContain('name="esAdicional"');
    expect(marcado).toMatch(/<input[^>]*name="nombre"[^>]*value="Salsas"/);
    expect(marcado).toMatch(/<input[^>]*name="opcion_e0_nombre"[^>]*value="Mayonesa"/);
    expect(marcado).toMatch(/<input[^>]*name="opcion_e0_recargo"[^>]*value="500.00"/);
    expect(marcado).toMatch(/<input[^>]*name="opcion_e1_nombre"[^>]*value="Ketchup"/);
    expect(marcado).toMatch(/<input[^>]*name="opcion_e1_recargo"[^>]*value="0.00"/);
  });

  it("un grupo que no está sale como el genérico", async () => {
    responde({ ok: false, error: errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA") });
    const params = { id: ID, grupoId: "no-existe" };
    expect(await html("/[grupoId]/page", params)).not.toContain("<form");
    expect(await texto("/[grupoId]/page", params)).toContain("Esta acción no está permitida");
  });
});
