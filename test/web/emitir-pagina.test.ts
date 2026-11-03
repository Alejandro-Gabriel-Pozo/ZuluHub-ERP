import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeCodigo, type Respuesta } from "../../src/capacidades/experiencia/respuesta";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * La página de emitir `/facturacion/comprobantes/emitir`, renderizada en el servidor: pide las dos lecturas que necesita (si la empresa
 * discrimina IVA y los puntos de venta activos de la sucursal) con el contexto de la empresa, nunca con datos de la dirección, y pinta
 * el paso 1. Cada rechazo del servidor (sin permiso, módulo en desarrollo, sucursal sin elegir o fuera de alcance, empresa ajena) se ve
 * con su texto y sin el código crudo: la pantalla no replica ninguna regla, muestra el motivo que da el servidor.
 */
vi.mock("server-only", () => ({}));

const mundo = vi.hoisted(
  (): {
    discrimina: unknown;
    puntos: unknown;
    lecturas: { cual: string; contexto: unknown }[];
  } => ({ discrimina: null, puntos: null, lecturas: [] }),
);
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    consultasDeEmpresas: () => ({
      permisosDelActor: () =>
        Promise.resolve({
          ok: true,
          valor: {
            acciones: ["comprobantes.ver", "comprobantes.emitir_manual"],
            modulos: { activos: ["facturacion"], enSoloLectura: [] },
          },
        }),
    }),
  },
}));
vi.mock("../../apps/web/servidor/facturacion", () => ({
  discriminaIvaParaEmitir: (contexto: unknown) => {
    mundo.lecturas.push({ cual: "discriminaIva", contexto });
    return Promise.resolve(mundo.discrimina);
  },
  puntosDeVentaParaEmitir: (contexto: unknown) => {
    mundo.lecturas.push({ cual: "puntosDeVenta", contexto });
    return Promise.resolve(mundo.puntos);
  },
}));
vi.mock("../../apps/web/app/s/app/acciones-de-facturacion", () => ({
  emitirFacturaAccion: () => Promise.reject(new Error("la página no emite nada")),
}));
const CONTEXTO = { id: "contexto-de-la-empresa" };
vi.mock("../../apps/web/servidor/sesion", () => ({
  empresaDelPedido: () =>
    Promise.resolve({
      puerta: { marca: { nombre: "Marca de prueba" } },
      entrada: {
        ok: true,
        dato: {
          tipo: "ENTRA",
          empresa: { nombre: "Empresa de prueba" },
          contexto: { id: "contexto-de-la-empresa" },
        },
      },
    }),
}));

const cargar = (ruta: string): Promise<{ default: () => Promise<unknown> }> =>
  import(/* @vite-ignore */ ruta);

const RUTA = "../../apps/web/app/s/app/(operacion)/facturacion/comprobantes/emitir/page";
async function html(): Promise<string> {
  const { default: Pagina } = await cargar(RUTA);
  return renderToStaticMarkup((await Pagina()) as ReactNode);
}
const pagina = async (): Promise<string> =>
  (await html()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const titulos = (marcado: string): string[] =>
  [...marcado.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)].map((m) => m[1] as string);

const PUNTOS = [
  { id: "6a1f0c2e-3b4d-4e5f-8a7b-9c0d1e2f3a4b", numero: 1, ambiente: "PRODUCCION" },
  { id: "7b2a1d3f-4c5e-4f60-9b8c-0d1e2f3a4b5c", numero: 2, ambiente: "HOMOLOGACION" },
];
const rechazo = (codigo: Parameters<typeof errorDeCodigo>[0]): Respuesta<never> => ({
  ok: false,
  error: errorDeCodigo(codigo),
});

beforeEach(() => {
  mundo.lecturas = [];
  mundo.discrimina = { ok: true, dato: { discriminaIva: true } };
  mundo.puntos = { ok: true, dato: { items: PUNTOS } };
});

describe("la página de emitir", () => {
  it("pide las dos lecturas con el contexto de la empresa y pinta el paso 1: cliente, «Siguiente» y nada del paso 3", async () => {
    const texto = await pagina();
    expect(mundo.lecturas).toEqual([
      { cual: "discriminaIva", contexto: CONTEXTO },
      { cual: "puntosDeVenta", contexto: CONTEXTO },
    ]);
    for (const esperado of [
      "Cliente",
      "Renglones",
      "Revisar",
      "Documento",
      "Consumidor final",
      "Siguiente",
    ]) {
      expect(texto).toContain(esperado);
    }
    // El paso 3 (con su botón «Emitir factura» y «Volver») no está: la persona todavía no llegó.
    expect(await html()).not.toMatch(/<button[^>]*>(Emitir factura|Volver)</);
  });

  it("hay UN solo h1, «Emitir factura», y «Comprobantes» queda marcado en la barra", async () => {
    const marcado = await html();
    expect(titulos(marcado)).toEqual(["Emitir factura"]);
    expect(marcado).toMatch(
      /<a[^>]*href="\/facturacion\/comprobantes"[^>]*aria-current="page"|<a[^>]*aria-current="page"[^>]*href="\/facturacion\/comprobantes"/,
    );
  });

  it("no tiene formulario ni campo con la empresa, el emisor o la sucursal: no hay nada que el navegador pueda decidir", async () => {
    const principal = /<main\b[\s\S]*<\/main>/.exec(await html())?.[0] ?? "";
    expect(principal).toContain("Documento");
    expect(principal).not.toMatch(/empresa|emisor|sucursal/i);
    expect(principal).not.toMatch(/<form\b|<input[^>]*type="hidden"/);
  });
});

describe("la página de emitir: lo que dice el servidor", () => {
  it.each([
    ["SIN_PERMISO", "No tiene permiso para hacer esto."],
    ["MODULO_EN_DESARROLLO", "Esta función todavía está en desarrollo."],
    ["MODULO_EN_SOLO_LECTURA", "Esta función quedó en solo lectura"],
    ["MODULO_NO_ACTIVO", "Esta función no está activada para la empresa."],
    ["EMPRESA_NO_OPERA", "La empresa no está operando en este momento."],
    ["SESION_VENCIDA", "Tu sesión venció"],
  ] as const)(
    "si no deja leer si discrimina IVA (%s): se ve su motivo, sin código y sin ofrecer nada",
    async (codigo, esperado) => {
      mundo.discrimina = rechazo(codigo);
      const texto = await pagina();
      expect(texto).toContain(esperado);
      expect(texto).not.toContain(codigo);
      expect(texto).not.toContain("Siguiente");
      // No sigue pidiendo lecturas a un servidor que ya dijo que no.
      expect(mundo.lecturas.map((l) => l.cual)).toEqual(["discriminaIva"]);
    },
  );

  it.each([
    ["FISCAL_SUCURSAL_NO_ELEGIDA", "Elegí una sucursal."],
    ["FISCAL_SUCURSAL_FUERA_DE_ALCANCE", "Sucursal fuera de su alcance."],
    ["SIN_PERMISO", "No tiene permiso para hacer esto."],
  ] as const)(
    "si no deja leer los puntos de venta (%s): se ve su motivo",
    async (codigo, esperado) => {
      mundo.puntos = rechazo(codigo);
      const texto = await pagina();
      expect(texto).toContain(esperado);
      expect(texto).not.toContain(codigo);
      expect(texto).not.toContain("Siguiente");
    },
  );

  it("un error inesperado se ve con su referencia y sin detalle", async () => {
    mundo.puntos = {
      ok: false,
      error: { ...errorDeCodigo("ERROR_INTERNO"), referencia: "PD-ABC123" },
    };
    const texto = await pagina();
    expect(texto).toContain("PD-ABC123");
    expect(texto).not.toContain("ERROR_INTERNO");
  });

  it("sin puntos de venta activos la pantalla se ofrece igual: el servidor es quien decide (se ve en «Revisar»)", async () => {
    mundo.puntos = { ok: true, dato: { items: [] } };
    expect(await pagina()).toContain("Siguiente");
  });
});
