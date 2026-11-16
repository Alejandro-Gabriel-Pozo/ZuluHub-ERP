import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeCodigo, type Respuesta } from "../../src/capacidades/experiencia/respuesta";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * Las páginas de las opciones de un producto (A13, tramo Opciones): lista, grupo nuevo, editar un grupo y copiar. Cada una lee los ids de la dirección, pide lo suyo al servidor con el
 * contexto de la empresa y pinta cada situación con su texto del catálogo: los grupos con sus reglas y recargos, los enlaces de escribir solo con `opciones.editar`, los formularios con sus
 * campos, «Guardar» y «Copiar» activos o apagados según el permiso, y los errores (el del guard con su motivo; el genérico para lo que no está; el inesperado con la referencia).
 * Un solo `h1`: el nombre del producto. Sin entrada en la barra: se llega desde la ficha.
 */
vi.mock("server-only", () => ({}));
const mundo = vi.hoisted(
  (): {
    permisos: unknown;
    llamadas: { pagina: string; contexto: unknown; id: string; grupoId?: string | null }[];
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
vi.mock("../../apps/web/servidor/opciones", () => ({
  cargarLasOpciones: (contexto: unknown, id: string) => {
    mundo.llamadas.push({ pagina: "opciones", contexto, id });
    return Promise.resolve(mundo.respuesta);
  },
  cargarUnGrupo: (contexto: unknown, id: string, grupoId: string | null) => {
    mundo.llamadas.push({ pagina: "grupo", contexto, id, grupoId });
    return Promise.resolve(mundo.respuesta);
  },
  cargarLaVariante: (contexto: unknown, id: string) => {
    mundo.llamadas.push({ pagina: "variante", contexto, id });
    return Promise.resolve(mundo.respuesta);
  },
  cargarLaCopia: (contexto: unknown, id: string) => {
    mundo.llamadas.push({ pagina: "copia", contexto, id });
    return Promise.resolve(mundo.respuesta);
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
type Pagina = (p: { params: Promise<Record<string, string>> }) => Promise<unknown>;
const cargar = (ruta: string): Promise<{ default: Pagina }> =>
  import(/* @vite-ignore */ `${BASE}${ruta}`);

const html = async (ruta: string, params: Record<string, string> = { id: ID }) => {
  const { default: Pagina } = await cargar(ruta);
  return renderToStaticMarkup((await Pagina({ params: Promise.resolve(params) })) as ReactNode);
};
const texto = async (ruta: string, params?: Record<string, string>) =>
  (await html(ruta, params)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const SALSAS = {
  id: GRUPO,
  nombre: "Salsas",
  clase: "ADICIONAL",
  esTamano: false,
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
  variante: null,
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

  it("los enlaces llevan a las pantallas de escribir", async () => {
    const marcado = await html("/page");
    expect(marcado).toContain(`href="/catalogo/productos/${ID}/opciones/${GRUPO}"`);
    expect(marcado).toContain(`href="/catalogo/productos/${ID}/opciones/nuevo"`);
    expect(marcado).toContain(`href="/catalogo/productos/${ID}/opciones/copiar"`);
  });

  it("sin opciones.editar (un operador) se ven los grupos y no hay ningún enlace de escribir", async () => {
    puede(["productos.ver"]);
    const marcado = await html("/page");
    const t = await texto("/page");
    expect(t).toContain("Salsas");
    for (const prohibido of ["Editar", "Agregar grupo", "Copiar de otro producto"]) {
      expect(t).not.toContain(prohibido);
    }
    expect(marcado.slice(marcado.indexOf("<main"), marcado.indexOf("</main>"))).not.toContain(
      "<a ",
    );
  });

  it("si no se pudieron leer los permisos, tampoco hay enlaces (cierra, no abre)", async () => {
    mundo.permisos = { ok: false, error: "SIN_PERMISO" };
    expect(await texto("/page")).not.toContain("Agregar grupo");
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

describe("la página de un grupo nuevo", () => {
  beforeEach(() => {
    responde({
      ok: true,
      dato: { id: ID, nombre: "Milanesa", versionDeOpciones: 4, grupo: null, claveDelCambio: "c" },
    });
  });

  it("un solo h1; «Agregar grupo», el nombre, «Adicional», «Obligatorio», «Se puede elegir más de una», «No figura en la carta», la primera fila y «Guardar»", async () => {
    const marcado = await html("/nuevo/page");
    expect(mundo.llamadas).toEqual([
      { pagina: "grupo", contexto: { id: "contexto" }, id: ID, grupoId: null },
    ]);
    expect([...marcado.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)].map((m) => m[1])).toEqual(["Milanesa"]);
    const t = await texto("/nuevo/page");
    const orden = [
      "Agregar grupo",
      "Nombre",
      "Adicional",
      "Obligatorio",
      "Se puede elegir más de una",
      "No figura en la carta",
      "Recargo",
      "Quitar",
      "Agregar opción",
      "Guardar",
    ].map((x) => t.indexOf(x));
    expect(orden.every((i) => i >= 0)).toBe(true);
    expect([...orden].sort((a, b) => a - b)).toEqual(orden);
  });

  it("los campos viajan por su nombre: el grupo, las casillas y la fila (el recargo como texto decimal canónico)", async () => {
    const marcado = await html("/nuevo/page");
    for (const nombre of [
      "nombre",
      "esAdicional",
      "esObligatorio",
      "admiteVarias",
      "fueraDeLaCarta",
    ]) {
      expect(marcado).toContain(`name="${nombre}"`);
    }
    expect(marcado).toMatch(/<input[^>]*name="opcion_n0_nombre"/);
    expect(marcado).toMatch(/<input[^>]*name="opcion_n0_recargo"[^>]*value="0.00"/);
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

  it("pide el grupo con los dos ids de la dirección; «Editar», la clase para leer (sin casilla «Adicional») y una fila por opción con su recargo", async () => {
    const params = { id: ID, grupoId: GRUPO };
    const marcado = await html("/[grupoId]/page", params);
    expect(mundo.llamadas).toEqual([
      { pagina: "grupo", contexto: { id: "contexto" }, id: ID, grupoId: GRUPO },
    ]);
    const t = await texto("/[grupoId]/page", params);
    expect(t).toContain("Editar");
    expect(t).toContain("Adicional");
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

describe("la página de la variante", () => {
  const VARIANTE = {
    id: "v1",
    nombre: "Tamaño",
    clase: "VARIANTE",
    esTamano: true,
    esObligatorio: true,
    admiteVarias: false,
    seMuestraEnCarta: true,
    opciones: [{ id: "a", nombre: "Chico", recargo: "0.000000" }],
  };
  const dato = (grupo: unknown) => ({
    ok: true as const,
    dato: { id: ID, nombre: "Milanesa", versionDeOpciones: 4, grupo, claveDelCambio: "c" },
  });

  it("sin variante: «Agregar variante», la medida sin marcar y una fila sin recargo; pide la variante con el id de la dirección", async () => {
    responde(dato(null));
    const marcado = await html("/variante/page");
    expect(mundo.llamadas).toEqual([{ pagina: "variante", contexto: { id: "contexto" }, id: ID }]);
    expect(marcado).toContain("Agregar variante");
    expect(marcado).toContain('name="esTamano"');
    expect(marcado).not.toContain('name="esObligatorio"');
    expect(marcado).not.toMatch(/name="opcion_n0_recargo"/);
    expect(marcado).toMatch(/<input[^>]*name="opcion_n0_nombre"/);
  });

  it("con variante: «Editar», «Es la medida» y sus opciones; «Guardar» apagado sin opciones.editar", async () => {
    responde(dato(VARIANTE));
    const marcado = await html("/variante/page");
    expect(marcado).toMatch(/<input[^>]*name="nombre"[^>]*value="Tamaño"/);
    expect(marcado).toMatch(/<input[^>]*name="opcion_e0_nombre"[^>]*value="Chico"/);
    expect(marcado).toMatch(/<input[^>]*name="esTamano"[^>]*checked/);
    puede(["productos.ver"]);
    expect(await html("/variante/page")).toMatch(/<button[^>]*disabled[^>]*>Guardar/);
  });

  it("el guard y un producto que no está salen con su texto, sin formulario", async () => {
    responde({ ok: false, error: errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA") });
    expect(await html("/variante/page")).not.toContain("<form");
  });
});

describe("la página de copiar de otro producto", () => {
  const COPIA = {
    id: ID,
    nombre: "Milanesa",
    versionDeOpciones: 4,
    candidatos: [
      { id: "a", nombre: "Hamburguesa" },
      { id: "b", nombre: "Pizza" },
    ],
    claveDeLaCopia: "c",
  };
  beforeEach(() => {
    responde({ ok: true, dato: COPIA });
  });

  it("un solo h1; «Producto» con los candidatos y «Copiar»", async () => {
    const marcado = await html("/copiar/page");
    expect([...marcado.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)].map((m) => m[1])).toEqual(["Milanesa"]);
    expect(marcado).toMatch(/<select[^>]*name="productoOrigenId"/);
    expect(marcado).toContain(">Hamburguesa</option>");
    expect(marcado).toContain(">Pizza</option>");
    expect(marcado).toMatch(/<button[^>]*type="submit"[^>]*>Copiar/);
    expect(mundo.llamadas).toEqual([{ pagina: "copia", contexto: { id: "contexto" }, id: ID }]);
  });

  it("sin permiso «Copiar» sale apagado; sin candidatos no hay formulario", async () => {
    puede(["productos.ver"]);
    expect(await html("/copiar/page")).toMatch(/<button[^>]*disabled[^>]*>Copiar/);
    puede(["productos.ver", "opciones.editar"]);
    responde({ ok: true, dato: { ...COPIA, candidatos: [] } });
    expect(await html("/copiar/page")).not.toContain("<form");
  });

  it("un producto que no está sale como el genérico", async () => {
    responde({ ok: false, error: errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA") });
    expect(await texto("/copiar/page")).toContain("Esta acción no está permitida");
  });
});
