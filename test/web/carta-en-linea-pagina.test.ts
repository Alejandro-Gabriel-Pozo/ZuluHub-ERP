import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeCodigo, type Respuesta } from "../../src/capacidades/experiencia/respuesta";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * La página de «Carta en línea» (C1): pide al servidor lo suyo con la sucursal que FIJA el servidor (nunca «todas»: sin ninguna, manda a elegirla), liga a las acciones lo que la persona vio (la clave
 * de creación de una carta nueva —una nueva por apertura—, la carta, la sucursal mostrada y su versión, y el ESTADO que pide el botón) y pinta cada situación con su texto del catálogo: botones activos
 * o apagados según el permiso, el contador y los motivos, y los errores. Un solo `h1`.
 */
vi.mock("server-only", () => ({}));
const mundo = vi.hoisted(
  (): {
    permisos: unknown;
    sucursal: string;
    respuesta: unknown;
    llamadas: unknown[][];
    claves: string[];
    ligadas: { accion: string; args: unknown[] }[];
    redirigido: string | null;
  } => ({
    permisos: null,
    sucursal: "",
    respuesta: null,
    llamadas: [],
    claves: [],
    ligadas: [],
    redirigido: null,
  }),
);
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    mundo.redirigido = destino;
    throw new Error("REDIRECT");
  },
}));
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: { consultasDeEmpresas: () => ({ permisosDelActor: () => Promise.resolve(mundo.permisos) }) },
}));
vi.mock("../../apps/web/servidor/carta-en-linea", () => ({
  sucursalDeLaCarta: () => Promise.resolve(mundo.sucursal),
  cargarLaCartaEnLinea: (...args: unknown[]) => {
    mundo.llamadas.push(args);
    return Promise.resolve(mundo.respuesta);
  },
  nuevaClaveDeCarta: () => {
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
vi.mock("../../apps/web/app/s/app/acciones-de-carta-en-linea", () => ({
  guardarLosTextosAccion: accion("guardar"),
  estadoDeLaCartaAccion: accion("estado"),
}));
vi.mock("../../apps/web/servidor/sesion", () => ({
  dependenciasDeSesion: {},
  empresaDelPedido: () =>
    Promise.resolve({
      puerta: { marca: { nombre: "Marca de prueba", hostDeApp: "app.ejemplo.test" } },
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

const CARTA = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const SUCURSAL = "5c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const PAGINA = "../../apps/web/app/s/app/(operacion)/catalogo/carta-en-linea/page";
const html = async () => {
  const { default: Pagina } = (await import(/* @vite-ignore */ PAGINA)) as {
    default: () => Promise<unknown>;
  };
  return renderToStaticMarkup((await Pagina()) as ReactNode);
};
const principal = (m: string) => /<main\b[^>]*>(.*)<\/main>/s.exec(m)?.[1] ?? "";
const texto = (m: string) =>
  principal(m)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
const h1 = (m: string) => [...m.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)].map((x) => x[1]);
const dato = (carta: unknown, extra: Record<string, unknown> = {}): Respuesta<unknown> => ({
  ok: true,
  dato: {
    carta,
    direccion: carta === null ? null : "https://app.ejemplo.test/CODIGO",
    qrSvg:
      carta === null
        ? null
        : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>',
    salen: 12,
    faltan: { sinPrecio: 2, sinSeccion: 0, desactivados: 1, ocultos: 0 },
    ...extra,
  },
});
const EXISTENTE = {
  id: CARTA,
  nombre: "Parador",
  rubro: "Parrilla",
  lugar: null,
  estado: "FUERA_DE_LINEA",
  version: 3,
};
const puede = (acciones: string[]) => {
  mundo.permisos = {
    ok: true,
    valor: { acciones, modulos: { activos: ["vidriera"], enSoloLectura: [] } },
  };
};
const TODOS = [
  "vidrieras.ver",
  "vidrieras.editar",
  "vidrieras.crear",
  "vidrieras.publicar_en_linea",
  "vidrieras.retirar_de_linea",
];

beforeEach(() => {
  Object.assign(mundo, {
    sucursal: SUCURSAL,
    llamadas: [],
    claves: [],
    ligadas: [],
    redirigido: null,
    respuesta: dato(EXISTENTE),
  });
  puede(TODOS);
});

describe("la página «Carta en línea»", () => {
  it("un solo h1, con la sucursal que fija el servidor y el host de la marca; sin sucursal manda a elegirla (nunca «todas»)", async () => {
    const marcado = await html();
    expect(h1(marcado)).toEqual(["Carta en línea"]);
    expect(mundo.llamadas).toEqual([[{ id: "contexto" }, SUCURSAL, "app.ejemplo.test"]]);
    mundo.sucursal = "";
    mundo.llamadas = [];
    await expect(html()).rejects.toThrow("REDIRECT");
    expect(mundo.redirigido).toBe("/sucursal");
    expect(mundo.llamadas).toEqual([]);
  });

  it("muestra el estado, el botón «Poner en línea», los tres campos con sus valores, la dirección, «Descargar QR», «No disponible», el contador y los motivos con cantidad", async () => {
    const marcado = await html();
    const t = texto(marcado);
    for (const esperado of [
      "Fuera de línea",
      "Poner en línea",
      "Dirección pública",
      "https://app.ejemplo.test/CODIGO",
      "Copiar",
      "Descargar QR",
      "No disponible",
      "Salen 12 productos",
      "Sin precio · 2",
      "Desactivado · 1",
    ])
      expect(t).toContain(esperado);
    expect(t).not.toContain("Sin sección ·");
    expect(marcado).toContain('value="Parador"');
    expect(marcado).toContain('value="Parrilla"');
    expect(marcado).toContain('download="qr-de-la-carta.svg"');
  });

  it("liga a «Guardar» la carta, la sucursal mostrada y la versión vista, y a «Poner en línea» el ESTADO que pide (no alterna)", async () => {
    await html();
    expect(mundo.ligadas).toEqual([
      {
        accion: "guardar",
        args: [null, { cartaId: CARTA, sucursalId: SUCURSAL, versionEsperada: 3 }],
      },
      {
        accion: "estado",
        args: [
          null,
          { cartaId: CARTA, sucursalId: SUCURSAL, versionEsperada: 3, estado: "EN_LINEA" },
        ],
      },
    ]);
    mundo.ligadas = [];
    mundo.respuesta = dato({ ...EXISTENTE, estado: "EN_LINEA", version: 4 });
    expect(texto(await html())).toContain("Sacar de línea");
    expect(mundo.ligadas[1]).toEqual({
      accion: "estado",
      args: [
        null,
        { cartaId: CARTA, sucursalId: SUCURSAL, versionEsperada: 4, estado: "FUERA_DE_LINEA" },
      ],
    });
  });

  it("una carta nueva: sin estado ni botón de línea, una clave de creación NUEVA por apertura y versión en null; sin dirección", async () => {
    mundo.respuesta = dato(null);
    const t = texto(await html());
    expect(t).not.toContain("Poner en línea");
    expect(t).not.toContain("Dirección pública");
    expect(mundo.ligadas).toEqual([
      {
        accion: "guardar",
        args: [null, { cartaId: "clave-1", sucursalId: SUCURSAL, versionEsperada: null }],
      },
    ]);
    mundo.ligadas = [];
    await html();
    expect(mundo.ligadas[0]?.args).toEqual([
      null,
      { cartaId: "clave-2", sucursalId: SUCURSAL, versionEsperada: null },
    ]);
  });

  it("sin permiso para cambiar (un operador) los botones salen apagados; con permiso y productos, activos; sin productos que salgan, «Poner en línea» apagado", async () => {
    puede(["vidrieras.ver"]);
    const apagado = await html();
    expect(
      [...apagado.matchAll(/<button\b[^>]*disabled[^>]*>(.*?)<\/button>/g)].map((m) => m[1]),
    ).toEqual(expect.arrayContaining(["Poner en línea", "Guardar"]));
    puede(TODOS);
    const activo = await html();
    expect(activo).not.toMatch(/<button\b[^>]*disabled[^>]*>Poner en línea/);
    mundo.respuesta = dato(EXISTENTE, { salen: 0 });
    expect(await html()).toMatch(/<button\b[^>]*disabled[^>]*>Poner en línea/);
  });

  it("sin leer los permisos todo sale apagado (cierra); con un solo producto el contador va en singular", async () => {
    mundo.permisos = { ok: false, error: { codigo: "SIN_PERMISO" } };
    mundo.respuesta = dato(EXISTENTE, { salen: 1 });
    const marcado = await html();
    expect(texto(marcado)).toContain("Sale 1 producto");
    expect(marcado).toMatch(/<button\b[^>]*disabled[^>]*>Poner en línea/);
    expect(marcado).toMatch(/<button\b[^>]*disabled[^>]*>Guardar/);
  });

  it("si el servidor rechaza la lectura (módulo en desarrollo, hoy) sale su motivo y ningún dato", async () => {
    mundo.respuesta = { ok: false, error: errorDeCodigo("MODULO_EN_DESARROLLO") };
    const marcado = await html();
    expect(h1(marcado)).toEqual(["Carta en línea"]);
    expect(texto(marcado)).not.toContain("Parador");
    expect(mundo.ligadas).toEqual([]);
  });
});
