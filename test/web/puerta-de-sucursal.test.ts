import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { debeElegirSucursal } from "../../apps/web/pantallas/puerta-de-sucursal";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * La puerta de «Elegir sucursal» al ingresar (dueño, 2026-11-05): el Inicio manda a `/sucursal` solo cuando la persona tiene sucursales
 * para elegir y no tiene una efectiva. Previene: dejar entrar sin sucursal, o pedir elegir cuando ya hay una (elegida o única abierta).
 */
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`REDIRECT:${destino}`);
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
type Del = {
  ok: boolean;
  dato?: {
    elegibles: { id: string; nombre: string; activa: boolean }[];
    elegida: string | null;
    efectiva: string;
  };
};
const mundo = vi.hoisted((): { del: Del } => ({ del: { ok: false } }));
vi.mock("../../apps/web/servidor/sucursal-elegida", () => ({
  sucursalDelPedido: () => Promise.resolve(mundo.del),
}));
vi.mock("../../apps/web/servidor/modulos", () => ({
  destinosDeModulos: () => Promise.resolve([]),
  pendientesDeLaEmpresa: () => Promise.resolve([]),
}));
vi.mock("../../apps/web/servidor/sesion", () => ({
  dependenciasDeSesion: { respuesta: { registrar: () => undefined } },
  empresaDelPedido: () =>
    Promise.resolve({
      puerta: { marca: { nombre: "Marca de prueba" } },
      entrada: {
        ok: true,
        dato: {
          tipo: "ENTRA",
          empresa: {
            empresaId: "e",
            nombre: "Empresa de prueba",
            rol: "GERENTE",
            estadoEfectivo: "OPERA",
          },
          contexto: { id: "c" },
        },
      },
    }),
}));

type Pagina = () => Promise<unknown>;
const cargar = (ruta: string): Promise<{ default: Pagina }> => import(/* @vite-ignore */ ruta);
const INICIO = "../../apps/web/app/s/app/(operacion)/page";
const ELEGIR = "../../apps/web/app/s/app/(operacion)/sucursal/page";
const A = { id: "a", nombre: "Centro", activa: true };
const B = { id: "b", nombre: "Norte", activa: true };

const entrar = async (ruta: string): Promise<string> => {
  const { default: Pagina } = await cargar(ruta);
  return renderToStaticMarkup((await Pagina()) as ReactNode);
};

beforeEach(() => {
  mundo.del = { ok: false };
});

describe("la función pura de la puerta", () => {
  it.each([
    [2, "", true],
    [1, "", true],
    [2, "a", false],
    [1, "a", false],
    [0, "", false],
  ])("%i elegibles, efectiva «%s»: debe elegir = %s", (n, efectiva, esperado) => {
    expect(debeElegirSucursal(n, efectiva)).toBe(esperado);
  });
});

describe("el Inicio", () => {
  it("sin sucursal efectiva y con sucursales para elegir: va a /sucursal", async () => {
    mundo.del = { ok: true, dato: { elegibles: [A, B], elegida: null, efectiva: "" } };
    await expect(entrar(INICIO)).rejects.toThrow("REDIRECT:/sucursal");
  });

  it.each([
    ["una única abierta que se toma sola", { elegibles: [A], elegida: null, efectiva: "a" }],
    ["ya hay una elegida", { elegibles: [A, B], elegida: "b", efectiva: "b" }],
    ["ninguna sucursal para elegir", { elegibles: [], elegida: null, efectiva: "" }],
  ])("%s: no redirige", async (_n, dato) => {
    mundo.del = { ok: true, dato };
    expect(await entrar(INICIO)).toContain("Empresa de prueba");
  });

  it("con error de la consulta: no redirige, sigue como hoy", async () => {
    mundo.del = { ok: false };
    expect(await entrar(INICIO)).toContain("Empresa de prueba");
  });
});

describe("la pantalla «Elegir sucursal»", () => {
  it("sin elegida: selector en blanco y botón «Continuar»", async () => {
    mundo.del = { ok: true, dato: { elegibles: [A, B], elegida: null, efectiva: "" } };
    const html = await entrar(ELEGIR);
    expect(html).toContain("Elegí una sucursal");
    expect(html).toContain("Continuar");
    expect(html).toContain('<option value="" selected="">');
    expect(html).not.toContain('value="a" selected');
  });

  it("con una elegida: arranca con esa seleccionada", async () => {
    mundo.del = { ok: true, dato: { elegibles: [A, B], elegida: "b", efectiva: "b" } };
    expect(await entrar(ELEGIR)).toMatch(
      /<option[^>]*value="b"[^>]*selected|<option[^>]*selected[^>]*value="b"/,
    );
  });

  it("sin sucursales para elegir: vuelve al Inicio", async () => {
    mundo.del = { ok: true, dato: { elegibles: [], elegida: null, efectiva: "" } };
    await expect(entrar(ELEGIR)).rejects.toThrow("REDIRECT:/");
  });
});
