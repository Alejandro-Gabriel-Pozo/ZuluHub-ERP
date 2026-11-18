import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "../../src/primitivas/resultado/resultado";

/**
 * `apps/web/servidor/ocultar.ts`: la empresa, la persona y el LOCAL los fija el SERVIDOR (`conLaEmpresa` y la sucursal elegida), nunca el navegador; el producto y el estado que se quiere
 * vienen ligados por la página. La composición es la real (`src/composicion/ocultar-web.ts`); las consultas y el caso de uso son falsos (con la base real, `test/integracion/ocultar-web.test.ts`).
 * Previene: ocultar en un local que eligió el navegador, tomar «ningún local» por «todas», y que una acción repetida alterne en vez de fijar el estado.
 */
vi.mock("server-only", () => ({}));
const revalidadas = vi.hoisted((): string[] => []);
vi.mock("next/cache", () => ({ revalidatePath: (ruta: string) => revalidadas.push(ruta) }));
const CONTEXTO = { empresaId: "empresa-de-la-sesion" };
const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const LOCAL = "2d1b8c3a-4e5f-4071-8c9d-1e2f3a4b5c6d";
const mundo = vi.hoisted(
  (): {
    contextos: unknown[];
    pedidos: unknown[];
    consultas: unknown[];
    resultado: unknown;
    ocultos: unknown;
    sucursal: unknown;
  } => ({
    contextos: [],
    pedidos: [],
    consultas: [],
    resultado: null,
    ocultos: null,
    sucursal: null,
  }),
);
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    casosDeUsoDeCatalogo: () => ({
      ocultarProducto: (contexto: unknown, entrada: unknown) => {
        mundo.contextos.push(contexto);
        mundo.pedidos.push(entrada);
        return Promise.resolve(mundo.resultado);
      },
    }),
    consultasDeCatalogo: () => ({
      productosOcultos: (_contexto: unknown, entrada: unknown) => {
        mundo.consultas.push(entrada);
        return Promise.resolve(mundo.ocultos);
      },
    }),
  },
}));
vi.mock("../../apps/web/servidor/sesion", () => ({
  dependenciasDeSesion: {
    respuesta: { registrar: () => undefined, azar: () => new Uint8Array(4) },
  },
}));
vi.mock("../../apps/web/servidor/con-la-empresa", () => ({
  conLaEmpresa: (hacer: (contexto: unknown) => unknown) => hacer(CONTEXTO),
}));
vi.mock("../../apps/web/servidor/sucursal-elegida", () => ({
  sucursalDelPedido: () => Promise.resolve(mundo.sucursal),
}));

import { cargarLaVisibilidad, ocultarOMostrar } from "../../apps/web/servidor/ocultar";

const conLocal = (efectiva: string) => {
  mundo.sucursal = { ok: true, dato: { elegibles: [], elegida: null, efectiva } };
};

beforeEach(() => {
  Object.assign(mundo, {
    contextos: [],
    pedidos: [],
    consultas: [],
    resultado: ok({ yaEstaba: false, sigueOcultoPor: null }),
    ocultos: ok([]),
  });
  revalidadas.length = 0;
  conLocal(LOCAL);
});

describe("ocultarOMostrar", () => {
  it("en el local: usa el contexto del servidor y el local de la sesión, pide el estado ligado y vuelve a pedir la ficha", async () => {
    expect(await ocultarOMostrar(ID, "LOCAL", true)).toEqual({ error: null });
    expect(mundo.contextos).toEqual([CONTEXTO]);
    expect(mundo.pedidos).toEqual([
      { productoId: ID, alcance: { tipo: "SUCURSAL", sucursalId: LOCAL }, oculto: true },
    ]);
    expect(revalidadas).toEqual([`/catalogo/productos/${ID}`]);
  });

  it("en toda la empresa: alcance EMPRESA, sin mirar el local", async () => {
    conLocal("");
    expect(await ocultarOMostrar(ID, "EMPRESA", false)).toEqual({ error: null });
    expect(mundo.pedidos).toEqual([
      { productoId: ID, alcance: { tipo: "EMPRESA" }, oculto: false },
    ]);
  });

  it("sin local con el que trabajar: «Ocultar en este local» cierra con el genérico, no toca nada y no revalida", async () => {
    conLocal("");
    const r = await ocultarOMostrar(ID, "LOCAL", true);
    expect(r.error?.codigo).toBe("CATALOGO_ACCION_NO_PERMITIDA");
    expect(mundo.pedidos).toEqual([]);
    expect(revalidadas).toEqual([]);
  });

  it("si no se pudo leer la sucursal elegida, tampoco se oculta en el local", async () => {
    mundo.sucursal = { ok: false, error: { codigo: "SESION_VENCIDA" } };
    expect((await ocultarOMostrar(ID, "LOCAL", true)).error?.codigo).toBe(
      "CATALOGO_ACCION_NO_PERMITIDA",
    );
    expect(mundo.pedidos).toEqual([]);
  });

  it("un rechazo del servidor sale ya traducido, con su texto propio, y no revalida", async () => {
    mundo.resultado = err("PRODUCTO_CON_EXISTENCIA");
    const r = await ocultarOMostrar(ID, "LOCAL", true);
    expect(r.error?.codigo).toBe("CATALOGO_PRODUCTO_CON_EXISTENCIA");
    expect(revalidadas).toEqual([]);
  });

  it("repetir el mismo pedido manda el mismo estado las dos veces (no alterna)", async () => {
    await ocultarOMostrar(ID, "LOCAL", true);
    await ocultarOMostrar(ID, "LOCAL", true);
    expect(mundo.pedidos).toHaveLength(2);
    expect(mundo.pedidos[1]).toEqual(mundo.pedidos[0]);
  });
});

describe("cargarLaVisibilidad", () => {
  it("con local: lo pregunta por ese local", async () => {
    mundo.ocultos = ok([
      {
        productoId: ID,
        nombre: "x",
        sucursalId: LOCAL,
        actualizadoPor: null,
        actualizadoEn: new Date(0),
      },
    ]);
    expect(await cargarLaVisibilidad(CONTEXTO as never, ID)).toEqual({
      ok: true,
      dato: { local: true, empresa: false },
    });
    expect(mundo.consultas).toEqual([{ sucursalId: LOCAL }]);
  });

  it("sin local (nada elegido): pregunta sin sucursal y el local sale `null`", async () => {
    conLocal("");
    expect(await cargarLaVisibilidad(CONTEXTO as never, ID)).toEqual({
      ok: true,
      dato: { local: null, empresa: false },
    });
    expect(mundo.consultas).toEqual([{}]);
  });
});
