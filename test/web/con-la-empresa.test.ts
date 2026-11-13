import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeCodigo } from "../../src/capacidades/experiencia/respuesta";

/**
 * `apps/web/servidor/con-la-empresa.ts`: la persona, la empresa y el origen los fija el SERVIDOR (sesión, host, cookie validada), nunca el pedido del navegador.
 * Previene: que una acción de cualquier módulo (caja, catálogo, facturación, configuración fiscal, cuenta) corra con otro origen, sin sesión o sin una empresa elegida
 * y validada. Antes la función vivía en `servidor/facturacion.ts` y esta prueba no existía por separado: se probaba solo a través del facturador.
 */
vi.mock("server-only", () => ({}));
const mundo = vi.hoisted(
  (): {
    pedido: { ok: boolean };
    sesion: unknown;
    entrada: { ok: boolean; dato?: { tipo: string; contexto?: unknown } };
    cookie: string | undefined;
    pedidos: unknown[];
    explota: boolean;
  } => ({
    pedido: { ok: true },
    sesion: { id: "s" },
    entrada: { ok: true, dato: { tipo: "ENTRA", contexto: { empresaId: "e1" } } },
    cookie: "e1",
    pedidos: [],
    explota: false,
  }),
);
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: () => (mundo.cookie === undefined ? undefined : { value: mundo.cookie }),
    }),
}));
vi.mock("../../apps/web/servidor/acciones", () => ({
  pedidoDeLaAccion: () => Promise.resolve(mundo.pedido),
}));
vi.mock("../../apps/web/servidor/cookies", () => ({ COOKIE_DE_EMPRESA: "pd_empresa" }));
vi.mock("../../apps/web/servidor/sesion", () => ({
  dependenciasDeSesion: { respuesta: { marca: "dependencias" } },
  sesionDelPedido: () => {
    if (mundo.explota) return Promise.reject(new Error("falló"));
    return Promise.resolve({
      sesion: mundo.sesion,
      puerta: { marcaId: "11111111-1111-4111-8111-111111111111" },
    });
  },
}));
vi.mock("../../src/composicion/sesion-y-empresa", () => ({
  resolverEmpresa: (_d: unknown, pedido: unknown) => {
    mundo.pedidos.push(pedido);
    return Promise.resolve(mundo.entrada);
  },
}));
vi.mock("../../src/composicion/a-respuesta", () => ({
  aRespuestaDeExcepcion: () => ({ ok: false, error: errorDeCodigo("ERROR_INTERNO") }),
}));

const { conLaEmpresa } = await import("../../apps/web/servidor/con-la-empresa");

beforeEach(() => {
  mundo.pedido = { ok: true };
  mundo.sesion = { id: "s" };
  mundo.entrada = { ok: true, dato: { tipo: "ENTRA", contexto: { empresaId: "e1" } } };
  mundo.cookie = "e1";
  mundo.pedidos = [];
  mundo.explota = false;
});

describe("conLaEmpresa", () => {
  it("con sesión y empresa elegida corre la acción una vez con el contexto del servidor", async () => {
    const hacer = vi.fn((contexto: unknown) =>
      Promise.resolve({ ok: true as const, dato: contexto }),
    );
    const r = await conLaEmpresa(hacer);
    expect(r).toEqual({ ok: true, dato: { empresaId: "e1" } });
    expect(hacer).toHaveBeenCalledTimes(1);
    expect(mundo.pedidos).toHaveLength(1);
  });

  it("un pedido de otro origen se rechaza sin resolver ni ejecutar nada", async () => {
    mundo.pedido = { ok: false };
    const hacer = vi.fn();
    expect(await conLaEmpresa(hacer)).toBe(mundo.pedido);
    expect(hacer).not.toHaveBeenCalled();
    expect(mundo.pedidos).toHaveLength(0);
  });

  it("sin sesión devuelve SESION_VENCIDA y no ejecuta", async () => {
    mundo.sesion = null;
    const hacer = vi.fn();
    expect(await conLaEmpresa(hacer)).toEqual({
      ok: false,
      error: errorDeCodigo("SESION_VENCIDA"),
    });
    expect(hacer).not.toHaveBeenCalled();
  });

  it("sin empresa elegida devuelve SIN_PERMISO y no ejecuta (cierra ante la duda)", async () => {
    mundo.entrada = { ok: true, dato: { tipo: "ELEGIR" } };
    const hacer = vi.fn();
    expect(await conLaEmpresa(hacer)).toEqual({ ok: false, error: errorDeCodigo("SIN_PERMISO") });
    expect(hacer).not.toHaveBeenCalled();
  });

  it("si la empresa de la cookie no es válida devuelve el error de la resolución y no ejecuta", async () => {
    mundo.entrada = { ok: false };
    const hacer = vi.fn();
    expect(await conLaEmpresa(hacer)).toBe(mundo.entrada);
    expect(hacer).not.toHaveBeenCalled();
  });

  it("una excepción se traduce a un error público, no se propaga", async () => {
    mundo.explota = true;
    const hacer = vi.fn();
    expect(await conLaEmpresa(hacer)).toEqual({
      ok: false,
      error: errorDeCodigo("ERROR_INTERNO"),
    });
    expect(hacer).not.toHaveBeenCalled();
  });

  it("toma la empresa de la cookie del servidor para validarla, no de lo que traiga la acción", async () => {
    mundo.cookie = "otra-empresa";
    await conLaEmpresa(() => Promise.resolve({ ok: true as const, dato: null }));
    expect(mundo.pedidos[0]).toMatchObject({ cookieDeEmpresa: "otra-empresa" });
  });
});
