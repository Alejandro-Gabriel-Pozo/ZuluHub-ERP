import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "../../src/primitivas/resultado/resultado";

/**
 * `apps/web/servidor/produccion.ts`: la empresa, la persona y la sucursal las fija el SERVIDOR (`conLaEmpresa`, `sucursalDelPedido`) y del formulario solo se toma el motivo; el id de la
 * orden viene ligado por la página. La composición es la real (`src/composicion/produccion-web.ts`); las consultas y los casos de uso son falsos (con la base real se prueban en
 * `test/integracion/produccion-web.test.ts`). Previene: listar las órdenes de «todas» las sucursales porque el navegador no mandó ninguna, cancelar o anular una orden de otra empresa
 * porque lo dijo el navegador, y quedarse en el formulario después de una acción que salió bien (o salir de él si falló).
 */
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`NEXT_REDIRECT ${destino}`);
  },
}));
const CONTEXTO = { empresaId: "empresa-de-la-sesion" };
const ORDEN = "11111111-1111-4111-8111-111111111111";
const SUCURSAL = "22222222-2222-4222-8222-222222222222";
const mundo = vi.hoisted(
  (): {
    listados: unknown[][];
    fichas: unknown[][];
    casos: unknown[][];
    resultado: unknown;
    sucursal: unknown;
  } => ({ listados: [], fichas: [], casos: [], resultado: null, sucursal: null }),
);
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    casosDeUsoDeProduccion: () => ({
      cancelarOrden: (...a: unknown[]) => {
        mundo.casos.push(["cancelar", ...a]);
        return Promise.resolve(mundo.resultado);
      },
      anularOrden: (...a: unknown[]) => {
        mundo.casos.push(["anular", ...a]);
        return Promise.resolve(mundo.resultado);
      },
    }),
    consultasDeProduccion: () => ({
      listarOrdenes: (...a: unknown[]) => {
        mundo.listados.push(a);
        return Promise.resolve(ok([]));
      },
      fichaDeOrden: (...a: unknown[]) => {
        mundo.fichas.push(a);
        return Promise.resolve(ok(null));
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

import {
  anularLaOrdenDeLaFicha,
  cancelarLaOrdenDeLaFicha,
  cargarLaOrden,
  cargarLasOrdenes,
} from "../../apps/web/servidor/produccion";

const formulario = (campos: Record<string, string | File>): FormData => {
  const datos = new FormData();
  for (const [nombre, valor] of Object.entries(campos)) datos.set(nombre, valor);
  return datos;
};

beforeEach(() => {
  Object.assign(mundo, {
    listados: [],
    fichas: [],
    casos: [],
    resultado: ok({ yaEstaba: false }),
    sucursal: { ok: true, dato: { elegibles: [], elegida: SUCURSAL, efectiva: SUCURSAL } },
  });
});

describe("la lista de órdenes", () => {
  it("la sucursal es la que el servidor validó (nunca la que diga el navegador) y viaja con el filtro", async () => {
    const r = await cargarLasOrdenes(CONTEXTO as never, { estado: "ABIERTA" });
    expect(r).toEqual({ ok: true, dato: { ordenes: [] } });
    expect(mundo.listados).toEqual([[CONTEXTO, { estado: "ABIERTA", sucursalId: SUCURSAL }]]);
  });

  it("sin sucursal elegida ni única, el genérico y no se consulta (nunca se asume «todas»)", async () => {
    mundo.sucursal = { ok: true, dato: { elegibles: [], elegida: null, efectiva: "" } };
    const r = await cargarLasOrdenes(CONTEXTO as never, { estado: "" });
    expect(r).toMatchObject({ ok: false, error: { codigo: "PRODUCCION_ACCION_NO_PERMITIDA" } });
    expect(mundo.listados).toEqual([]);
  });

  it("si no se pudo resolver la sucursal, ese error y no se consulta", async () => {
    mundo.sucursal = { ok: false, error: { codigo: "SESION_VENCIDA" } };
    const r = await cargarLasOrdenes(CONTEXTO as never, { estado: "" });
    expect(r).toEqual({ ok: false, error: { codigo: "SESION_VENCIDA" } });
    expect(mundo.listados).toEqual([]);
  });
});

describe("la ficha de una orden", () => {
  it("pide la ficha con el contexto que ya resolvió la página y el id de la dirección", async () => {
    const r = await cargarLaOrden(CONTEXTO as never, ORDEN);
    expect(r).toMatchObject({ ok: false, error: { codigo: "PRODUCCION_ACCION_NO_PERMITIDA" } });
    expect(mundo.fichas).toEqual([[CONTEXTO, { ordenId: ORDEN }]]);
  });
});

describe.each([
  ["cancelar", cancelarLaOrdenDeLaFicha],
  ["anular", anularLaOrdenDeLaFicha],
] as const)("%s desde la ficha", (caso, accion) => {
  it("usa la empresa del servidor, el id que ligó la página y solo el motivo del formulario; si sale bien vuelve a la ficha", async () => {
    await expect(
      accion(ORDEN, formulario({ motivo: "Se rompió el horno", empresaId: "otra", ordenId: "x" })),
    ).rejects.toThrow(`NEXT_REDIRECT /catalogo/produccion/${ORDEN}`);
    expect(mundo.casos).toEqual([
      [caso, CONTEXTO, { ordenId: ORDEN, motivo: "Se rompió el horno" }],
    ]);
  });

  it("repetirlo (ya estaba) también vuelve a la ficha: no duplica ni da error", async () => {
    mundo.resultado = ok({ yaEstaba: true });
    await expect(accion(ORDEN, formulario({ motivo: "otra vez" }))).rejects.toThrow(
      `NEXT_REDIRECT /catalogo/produccion/${ORDEN}`,
    );
  });

  it("un campo que falta o no es texto es un motivo vacío: lo rechaza el servidor", async () => {
    mundo.resultado = err("MOTIVO_REQUERIDO");
    const r = await accion(ORDEN, formulario({ motivo: new File(["x"], "x.txt") }));
    expect(r).toMatchObject({ error: { codigo: "PRODUCCION_ACCION_NO_PERMITIDA" } });
    expect(mundo.casos[0]?.[2]).toEqual({ ordenId: ORDEN, motivo: "" });
  });

  it("si el servidor rechaza, devuelve el error ya traducido y se queda en el formulario", async () => {
    mundo.resultado = err("ORDEN_YA_CERRADA");
    const r = await accion(ORDEN, formulario({ motivo: "x" }));
    expect(r).toMatchObject({ error: { codigo: "PRODUCCION_ACCION_NO_PERMITIDA" } });
  });
});
