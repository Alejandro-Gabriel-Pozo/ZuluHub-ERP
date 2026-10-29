import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeCodigo, type Respuesta } from "../../src/capacidades/experiencia/respuesta";
import { PAGINA, SUCURSALES } from "../utilidades/listado-de-comprobantes";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * La página del listado de comprobantes: lee los filtros de la dirección, los traduce al pedido con el día de Argentina, pide el
 * listado al servidor con el contexto de la empresa, y pinta cada situación con su texto: sin sucursal elegida (hace elegir), sucursal
 * fuera de alcance, vacío, errores (con la referencia, sin el código crudo) y clave de página que no sirve (vuelve a la primera).
 */
vi.mock("server-only", () => ({}));
type Cargado = {
  sucursales: readonly { id: string; nombre: string; activa: boolean }[];
  efectiva: string;
  puntosDeVenta: readonly number[];
  pagina: Respuesta<unknown>;
};
const servidor = vi.hoisted(
  (): {
    llamadas: { contexto: unknown; entrada: unknown }[];
    puntosDeVenta: number[];
    cargado: unknown;
  } => ({ llamadas: [], puntosDeVenta: [], cargado: null }),
);
vi.mock("../../apps/web/servidor/facturacion", () => ({
  cargarElListado: (contexto: unknown, armar: (puntosDeVenta: readonly number[]) => unknown) => {
    servidor.llamadas.push({ contexto, entrada: armar(servidor.puntosDeVenta) });
    return Promise.resolve(servidor.cargado);
  },
  elegirLaSucursal: () => Promise.resolve({ error: null }),
}));
vi.mock("../../apps/web/servidor/sesion", () => ({
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

const cargar = (
  ruta: string,
): Promise<{
  default: (p: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  }) => Promise<unknown>;
}> => import(/* @vite-ignore */ ruta);

// Los comparadores asimétricos de Vitest devuelven `any`: acá sale tipado como `unknown`.
const conDigest = (parte: string): unknown => expect.stringContaining(parte);

const RUTA = "../../apps/web/app/s/app/(operacion)/facturacion/comprobantes/page";

const html = async (params: Record<string, string | string[] | undefined> = {}) => {
  const { default: Pagina } = await cargar(RUTA);
  return renderToStaticMarkup(
    (await Pagina({ searchParams: Promise.resolve(params) })) as ReactNode,
  );
};
const texto = async (params?: Record<string, string | string[] | undefined>) =>
  (await html(params))
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

const cargado = (c: Partial<Cargado> = {}) => {
  servidor.cargado = {
    sucursales: SUCURSALES,
    efectiva: "s-centro",
    puntosDeVenta: [],
    pagina: { ok: true, dato: PAGINA },
    ...c,
  } satisfies Cargado;
};

describe("la página del listado de comprobantes", () => {
  beforeEach(() => {
    servidor.llamadas = [];
    servidor.puntosDeVenta = [];
    vi.useFakeTimers();
    // 23:30 del 28/10/2026 en Argentina: ya es el 29 en UTC.
    vi.setSystemTime(new Date("2026-10-29T02:30:00Z"));
    cargado();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("con comprobantes: un solo h1 «Comprobantes», los filtros y las filas", async () => {
    const marcado = await html();
    expect([...marcado.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)].map((m) => m[1])).toEqual([
      "Comprobantes",
    ]);
    const t = await texto();
    expect(t).toContain("Filtros (0)");
    expect(t).toContain("Factura B 00001-00001234");
    expect(t).toContain("Página siguiente");
  });

  it("«Página siguiente» fija las fechas del período en el enlace (no se corren si pasa la medianoche)", async () => {
    const marcado = await html({ estado: "RECHAZADO" });
    const href = /<a[^>]*href="([^"]+)"[^>]*>Página siguiente/.exec(marcado)?.[1] ?? "";
    const url = new URL(href.replace(/&amp;/g, "&"), "https://app.ejemplo.test");
    expect(url.searchParams.get("periodo")).toBe("personalizado");
    expect(url.searchParams.get("desde")).toBe("2026-10-01");
    expect(url.searchParams.get("hasta")).toBe("2026-10-28");
    expect(url.searchParams.get("estado")).toBe("RECHAZADO");
    expect(url.searchParams.get("despues")).toBe(PAGINA.siguiente);

    // Un minuto después de la medianoche (ya es el 29 en Argentina), la página siguiente pide el mismo rango.
    vi.setSystemTime(new Date("2026-10-29T03:01:00Z"));
    servidor.llamadas = [];
    await html({ periodo: "personalizado", desde: "2026-10-01", hasta: "2026-10-28" });
    expect(servidor.llamadas.map((l) => l.entrada)).toEqual([
      { desde: "2026-10-01", hasta: "2026-10-28" },
    ]);
  });

  it("sin puntos de venta reales del servidor, no se ofrece el filtro «Punto de venta» ni su columna", async () => {
    const marcado = await html({ puntoDeVenta: "3" });
    expect(marcado).not.toContain('name="puntoDeVenta"');
    expect(await texto()).not.toContain("Punto de venta");
  });

  it("la barra marca «Comprobantes» como el destino actual y no marca ningún otro", async () => {
    const marcado = await html();
    const actuales = [
      ...marcado.matchAll(/<a[^>]*aria-current="page"[^>]*>(?:<[^>]+>)*([^<]+)/g),
    ].map((m) => m[1]);
    expect(actuales).toEqual(["Comprobantes"]);
  });

  it("pide el listado con el contexto de la empresa y «Este mes» al día de Argentina", async () => {
    await html();
    expect(servidor.llamadas).toEqual([
      { contexto: { id: "contexto" }, entrada: { desde: "2026-10-01", hasta: "2026-10-28" } },
    ]);
  });

  it("los filtros de la dirección llegan al pedido; lo inválido, no", async () => {
    await html({
      periodo: "hoy",
      estado: "RECHAZADO",
      letra: "B",
      texto: "Sur",
      despues: "2026-10-12T10:00:00.000000Z|0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b",
    });
    await html({ periodo: "ayer", estado: "INVENTADO", letra: "Z", puntoDeVenta: "x" });
    expect(servidor.llamadas.map((l) => l.entrada)).toEqual([
      {
        desde: "2026-10-28",
        hasta: "2026-10-28",
        estado: "RECHAZADO",
        letra: "B",
        texto: "Sur",
        despuesDe: "2026-10-12T10:00:00.000000Z|0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b",
      },
      { desde: "2026-10-01", hasta: "2026-10-28" },
    ]);
  });

  it("un punto de venta que no es de la sucursal no se filtra; uno que sí, sí", async () => {
    servidor.puntosDeVenta = [1, 2];
    await html({ puntoDeVenta: "3" });
    await html({ puntoDeVenta: "2" });
    expect(servidor.llamadas.map((l) => l.entrada)).toEqual([
      { desde: "2026-10-01", hasta: "2026-10-28" },
      { desde: "2026-10-01", hasta: "2026-10-28", puntoDeVenta: 2 },
    ]);
  });

  it("sin comprobantes: el texto de vacío", async () => {
    cargado({ pagina: { ok: true, dato: { items: [], siguiente: null } } });
    expect(await texto()).toContain(
      "No hay comprobantes con esos filtros. Probá con otro período o tocá «Limpiar».",
    );
  });

  it("sin sucursal elegida: invita a elegir y muestra el selector, sin filtros ni el texto del error", async () => {
    cargado({
      efectiva: "",
      pagina: { ok: false, error: errorDeCodigo("FISCAL_SUCURSAL_NO_ELEGIDA") },
    });
    const marcado = await html();
    const t = await texto();
    expect(t).toContain("Elegí una sucursal para ver sus comprobantes.");
    expect(marcado).toContain('name="sucursalId"');
    expect(marcado).not.toContain('name="periodo"');
    expect(marcado).not.toContain("<table");
    expect(t).not.toContain("Elegí una sucursal.");
  });

  it("sucursal fuera de alcance: lo dice, y deja elegir otra", async () => {
    cargado({
      efectiva: "",
      pagina: { ok: false, error: errorDeCodigo("FISCAL_SUCURSAL_FUERA_DE_ALCANCE") },
    });
    const marcado = await html();
    expect(await texto()).toContain("Sucursal fuera de su alcance.");
    expect(marcado).toContain('name="sucursalId"');
  });

  it.each([
    ["SIN_PERMISO", "No tiene permiso para hacer esto."],
    ["MODULO_EN_DESARROLLO", "Esta función todavía está en desarrollo."],
    ["SESION_VENCIDA", "Tu sesión venció"],
    ["FISCAL_FILTRO_INVALIDO", "Los filtros del listado no son válidos."],
  ] as const)("el error %s se ve con su texto y sin el código", async (codigo, esperado) => {
    cargado({ pagina: { ok: false, error: errorDeCodigo(codigo) } });
    const t = await texto();
    expect(t).toContain(esperado);
    expect(t).not.toContain(codigo);
  });

  it("un error inesperado dice «No pudimos cargar la lista» con la referencia y nada técnico", async () => {
    cargado({
      pagina: { ok: false, error: { ...errorDeCodigo("ERROR_INTERNO"), referencia: "PD-ABC123" } },
    });
    const t = await texto();
    expect(t).toContain("No pudimos cargar la lista. Probá de nuevo.");
    expect(t).toContain("PD-ABC123");
    expect(t).not.toContain("ERROR_INTERNO");
    // Los filtros siguen a la vista para probar de nuevo.
    expect(t).toContain("Filtros (0)");
  });

  it("una clave de página que no sirve vuelve a la primera página (con los mismos filtros), sin mostrar error", async () => {
    cargado({ pagina: { ok: false, error: errorDeCodigo("FISCAL_FILTRO_INVALIDO") } });
    await expect(html({ estado: "RECHAZADO", despues: "vieja" })).rejects.toMatchObject({
      digest: conDigest("/facturacion/comprobantes?estado=RECHAZADO;"),
    });
    // Sin clave de página, el mismo error es de los filtros y se muestra.
    expect(await texto({ estado: "RECHAZADO" })).toContain(
      "Los filtros del listado no son válidos.",
    );
  });
});
