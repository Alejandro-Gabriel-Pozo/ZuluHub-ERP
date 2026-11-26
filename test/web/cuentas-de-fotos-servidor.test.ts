import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El servidor de «Conectá tu cuenta de fotos» (`apps/web/servidor/cuentas-de-fotos.ts`): de lo que manda el formulario a lo que pide a la composición. Del formulario solo lee la cuenta y el motivo; la clave del
 * gesto, la cuenta (su id) y la versión las ligó la página. La empresa, la persona y el proveedor no viajan: los fija el servidor. La validez de cada dato la decide la composición
 * (`entradas-de-cuentas-de-fotos.test.ts`), no esta capa. Tras cualquier resultado vuelve a pedir la página.
 */
vi.mock("server-only", () => ({}));
const revalidar = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: revalidar }));
const mundo = vi.hoisted(() => ({
  pedidos: [] as unknown[][],
  error: null as { codigo: string } | null,
}));
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: { casosDeUsoDeCatalogo: () => ({}), consultasDeCatalogo: () => ({}) },
}));
vi.mock("../../apps/web/servidor/sesion", () => ({ dependenciasDeSesion: { respuesta: {} } }));
vi.mock("../../apps/web/servidor/con-la-empresa", () => ({
  conLaEmpresa: (hacer: (contexto: unknown) => Promise<unknown>) => hacer({ empresaId: "e1" }),
}));
vi.mock("../../src/composicion/cuentas-de-fotos-web", () => ({
  declararLaCuentaDeFotos: (...args: unknown[]) => {
    mundo.pedidos.push(["declarar", ...args]);
    return Promise.resolve(
      mundo.error === null ? { ok: true, dato: {} } : { ok: false, error: mundo.error },
    );
  },
  retirarLaCuentaDeFotos: (...args: unknown[]) => {
    mundo.pedidos.push(["retirar", ...args]);
    return Promise.resolve({ ok: true, dato: {} });
  },
  verLasCuentasDeFotos: vi.fn(),
}));

import {
  declararLaCuenta,
  nuevaClaveDeCuentaDeFotos,
  retirarLaCuenta,
} from "../../apps/web/servidor/cuentas-de-fotos";

describe("las acciones del servidor de «Conectá tu cuenta de fotos»: del formulario al pedido", () => {
  beforeEach(() => {
    mundo.pedidos = [];
    mundo.error = null;
    revalidar.mockClear();
  });

  it("declarar pasa la cuenta como texto con la clave del gesto, sin empresa, persona ni proveedor, y vuelve a pedir la página", async () => {
    const datos = new FormData();
    datos.set("cuenta", "mi-hotel");
    datos.set("empresaId", "otra-empresa");
    datos.set("proveedor", "IMAGEKIT");
    expect(await declararLaCuenta({ claveDeIdempotencia: "k".repeat(36) }, datos)).toEqual({
      error: null,
    });
    expect(mundo.pedidos).toHaveLength(1);
    expect(mundo.pedidos[0]?.[3]).toEqual({
      claveDeIdempotencia: "k".repeat(36),
      cuenta: "mi-hotel",
    });
    expect(revalidar).toHaveBeenCalledWith("/catalogo/carta-en-linea/cuentas-de-fotos");
  });

  it("retirar pasa el motivo con la cuenta y la versión que ligó la página", async () => {
    const datos = new FormData();
    datos.set("motivo", "Cerramos la cuenta");
    expect(await retirarLaCuenta({ id: "c-1", versionEsperada: 2 }, datos)).toEqual({
      error: null,
    });
    expect(mundo.pedidos[0]?.[3]).toEqual({
      id: "c-1",
      versionEsperada: 2,
      motivo: "Cerramos la cuenta",
    });
    expect(revalidar).toHaveBeenCalledTimes(1);
  });

  it("un error de la composición vuelve como error de la acción y también vuelve a pedir la página", async () => {
    mundo.error = { codigo: "CATALOGO_ACCION_NO_PERMITIDA" };
    const datos = new FormData();
    datos.set("cuenta", "x");
    expect(await declararLaCuenta({ claveDeIdempotencia: "k".repeat(36) }, datos)).toEqual({
      error: { codigo: "CATALOGO_ACCION_NO_PERMITIDA" },
    });
    expect(revalidar).toHaveBeenCalledTimes(1);
  });

  it("cada apertura de la página fija una clave distinta y con la forma que exige la base", () => {
    const a = nuevaClaveDeCuentaDeFotos();
    const b = nuevaClaveDeCuentaDeFotos();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
  });
});
