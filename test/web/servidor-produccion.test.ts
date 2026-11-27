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
const CLAVE = "33333333-3333-4333-8333-333333333333";
const MASA = "44444444-4444-4444-8444-444444444444";
const VENTA = "55555555-5555-4555-8555-555555555555";
const mundo = vi.hoisted(
  (): {
    listados: unknown[][];
    fichas: unknown[][];
    casos: unknown[][];
    depositos: unknown[][];
    resultado: unknown;
    resultadoDeAbrir: unknown;
    resultadoDeCerrar: unknown;
    ficha: unknown;
    sucursal: unknown;
  } => ({
    listados: [],
    fichas: [],
    casos: [],
    depositos: [],
    resultado: null,
    resultadoDeAbrir: null,
    resultadoDeCerrar: null,
    ficha: null,
    sucursal: null,
  }),
);
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    casosDeUsoDeProduccion: () => ({
      cerrarOrden: (...a: unknown[]) => {
        mundo.casos.push(["cerrar", ...a]);
        return Promise.resolve(mundo.resultadoDeCerrar);
      },
      abrirOrden: (...a: unknown[]) => {
        mundo.casos.push(["abrir", ...a]);
        return Promise.resolve(mundo.resultadoDeAbrir);
      },
      cancelarOrden: (...a: unknown[]) => {
        mundo.casos.push(["cancelar", ...a]);
        return Promise.resolve(mundo.resultado);
      },
      anularOrden: (...a: unknown[]) => {
        mundo.casos.push(["anular", ...a]);
        return Promise.resolve(mundo.resultado);
      },
    }),
    consultasDeStock: () => ({
      listarDepositos: (...a: unknown[]) => {
        mundo.depositos.push(a);
        return Promise.resolve(
          ok([{ id: VENTA, sucursalId: SUCURSAL, uso: "NORMAL", deVenta: true, activo: true }]),
        );
      },
      articulosControlados: () =>
        Promise.resolve(
          ok([{ articuloId: "a-1", productoId: MASA, nombre: "Masa", unidadId: "KILOGRAMO" }]),
        ),
      listarRecetas: () =>
        Promise.resolve(
          ok({
            recetas: [{ productoId: MASA, nombre: "Masa", claseDeUso: "ELABORADO", activo: true }],
            siguiente: null,
          }),
        ),
    }),
    consultasDeProduccion: () => ({
      listarOrdenes: (...a: unknown[]) => {
        mundo.listados.push(a);
        return Promise.resolve(ok([]));
      },
      fichaDeOrden: (...a: unknown[]) => {
        mundo.fichas.push(a);
        return Promise.resolve(ok(mundo.ficha));
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
  abrirLaOrdenDelFormulario,
  anularLaOrdenDeLaFicha,
  cancelarLaOrdenDeLaFicha,
  cargarLaNuevaOrdenDeLaSucursal,
  cargarLaOrden,
  cargarLaOrdenParaElCierre,
  cerrarLaOrdenDelFormulario,
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
    depositos: [],
    resultado: ok({ yaEstaba: false }),
    ficha: null,
    resultadoDeCerrar: ok({
      lote: null,
      costoUnitario: null,
      costoEstado: "SIN_COSTO",
      mermaDeLote: "0",
      excepciones: [],
      yaExistia: false,
    }),
    resultadoDeAbrir: ok({
      ordenId: ORDEN,
      numero: 3,
      esperados: [],
      faltantes: [],
      yaExistia: false,
    }),
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

describe("«Nueva orden»: lo que se ofrece", () => {
  it("se pide para la sucursal que el servidor validó y trae los productos y el depósito de venta", async () => {
    const r = await cargarLaNuevaOrdenDeLaSucursal(CONTEXTO as never);
    expect(r).toEqual({
      ok: true,
      dato: { productos: [{ id: MASA, nombre: "Masa", unidadId: "KILOGRAMO" }], depositoId: VENTA },
    });
    expect(mundo.depositos).toEqual([[CONTEXTO, { sucursalId: SUCURSAL }]]);
  });

  it("sin sucursal elegida ni única, el genérico y no se consulta (nunca se asume «todas»)", async () => {
    mundo.sucursal = { ok: true, dato: { elegibles: [], elegida: null, efectiva: "" } };
    const r = await cargarLaNuevaOrdenDeLaSucursal(CONTEXTO as never);
    expect(r).toMatchObject({ ok: false, error: { codigo: "PRODUCCION_ACCION_NO_PERMITIDA" } });
    expect(mundo.depositos).toEqual([]);
  });

  it("si no se pudo resolver la sucursal, ese error y no se consulta", async () => {
    mundo.sucursal = { ok: false, error: { codigo: "SESION_VENCIDA" } };
    expect(await cargarLaNuevaOrdenDeLaSucursal(CONTEXTO as never)).toEqual({
      ok: false,
      error: { codigo: "SESION_VENCIDA" },
    });
    expect(mundo.depositos).toEqual([]);
  });
});

describe("abrir una orden desde el formulario", () => {
  it("usa la empresa y la sucursal del servidor, la clave que ligó la página y solo el producto, la cantidad y la confirmación; si sale bien va a la ficha", async () => {
    await expect(
      abrirLaOrdenDelFormulario(
        CLAVE,
        formulario({
          productoId: MASA,
          cantidad: "16",
          confirmar: "1",
          empresaId: "otra",
          sucursalId: "otra",
          depositoId: "otro",
          unidadId: "GRAMO",
          clave: "otra",
        }),
      ),
    ).rejects.toThrow(`NEXT_REDIRECT /catalogo/produccion/${ORDEN}`);
    expect(mundo.casos).toEqual([
      [
        "abrir",
        CONTEXTO,
        {
          id: CLAVE,
          productoId: MASA,
          cantidad: "16",
          unidadId: "KILOGRAMO",
          depositoId: VENTA,
          depositoDestinoId: VENTA,
          confirmaciones: ["stock.existencia_negativa"],
        },
      ],
    ]);
    expect(mundo.depositos).toEqual([[CONTEXTO, { sucursalId: SUCURSAL }]]);
  });

  it("repetirlo (ya existía) también va a la ficha: no duplica ni da error", async () => {
    mundo.resultadoDeAbrir = ok({
      ordenId: ORDEN,
      numero: 3,
      esperados: [],
      faltantes: [],
      yaExistia: true,
    });
    await expect(
      abrirLaOrdenDelFormulario(CLAVE, formulario({ productoId: MASA, cantidad: "16" })),
    ).rejects.toThrow(`NEXT_REDIRECT /catalogo/produccion/${ORDEN}`);
  });

  it("si el servidor pide confirmar, devuelve el aviso y se queda en el formulario", async () => {
    mundo.resultadoDeAbrir = err({ error: "CONTROL_REQUIERE_CONFIRMACION", detalle: [] });
    const r = await abrirLaOrdenDelFormulario(
      CLAVE,
      formulario({ productoId: MASA, cantidad: "16" }),
    );
    expect(r).toMatchObject({ error: { codigo: "STOCK_CONTROL_AVISA" } });
    expect(mundo.casos[0]?.[2]).not.toHaveProperty("confirmaciones");
  });

  it("un campo que falta o no es texto no llega al caso de uso: el genérico", async () => {
    const r = await abrirLaOrdenDelFormulario(
      CLAVE,
      formulario({ productoId: new File(["x"], "x.txt"), cantidad: "16" }),
    );
    expect(r).toMatchObject({ error: { codigo: "PRODUCCION_ACCION_NO_PERMITIDA" } });
    expect(mundo.casos).toEqual([]);
  });

  it("sin sucursal elegida ni única, el genérico y no se abre nada", async () => {
    mundo.sucursal = { ok: true, dato: { elegibles: [], elegida: null, efectiva: "" } };
    const r = await abrirLaOrdenDelFormulario(
      CLAVE,
      formulario({ productoId: MASA, cantidad: "16" }),
    );
    expect(r).toMatchObject({ error: { codigo: "PRODUCCION_ACCION_NO_PERMITIDA" } });
    expect(mundo.casos).toEqual([]);
  });

  it("si no se pudo resolver la sucursal, ese error y no se abre nada", async () => {
    mundo.sucursal = { ok: false, error: { codigo: "SESION_VENCIDA" } };
    const r = await abrirLaOrdenDelFormulario(
      CLAVE,
      formulario({ productoId: MASA, cantidad: "16" }),
    );
    expect(r).toEqual({ error: { codigo: "SESION_VENCIDA" } });
    expect(mundo.casos).toEqual([]);
  });
});

const HARINA = "66666666-6666-4666-8666-666666666666";
const MANTECA = "77777777-7777-4777-8777-777777777777";
const FICHA = {
  ordenId: ORDEN,
  numero: 14,
  estado: "ABIERTA",
  nombre: "Masa",
  unidadId: "KILOGRAMO",
  cantidadEsperada: "16.0000",
  renglones: [
    {
      productoId: HARINA,
      nombre: "Harina",
      esperado: "12.0000",
      real: null,
      unidadId: "KILOGRAMO",
    },
    {
      productoId: MANTECA,
      nombre: "Manteca",
      esperado: "4.0000",
      real: null,
      unidadId: "KILOGRAMO",
    },
  ],
};

describe("«Cerrar con lo real»: la orden a cerrar", () => {
  it("se pide con el contexto que ya resolvió la página y el id de la dirección, y trae los renglones", async () => {
    mundo.ficha = FICHA;
    const r = await cargarLaOrdenParaElCierre(CONTEXTO as never, ORDEN);
    expect(r).toMatchObject({ ok: true, dato: { id: ORDEN, numero: 14, renglones: [{}, {}] } });
    expect(mundo.fichas).toEqual([[CONTEXTO, { ordenId: ORDEN }]]);
  });

  it("una orden que no está o ya no está abierta es el genérico", async () => {
    expect(await cargarLaOrdenParaElCierre(CONTEXTO as never, ORDEN)).toMatchObject({
      ok: false,
      error: { codigo: "PRODUCCION_ACCION_NO_PERMITIDA" },
    });
    mundo.ficha = { ...FICHA, estado: "CERRADA" };
    expect(await cargarLaOrdenParaElCierre(CONTEXTO as never, ORDEN)).toMatchObject({
      ok: false,
      error: { codigo: "PRODUCCION_ACCION_NO_PERMITIDA" },
    });
  });
});

describe("cerrar una orden desde el formulario", () => {
  const datos = (extra: Record<string, string> = {}) => {
    const f = new FormData();
    f.append("consumos", "12");
    f.append("consumos", "3.5");
    f.set("obtenido", "15");
    f.set("vence", "2026-12-31");
    for (const [k, v] of Object.entries(extra)) f.set(k, v);
    return f;
  };

  it("usa la empresa del servidor, la orden y la clave que ligó la página y solo lo real, lo obtenido, el vencimiento y la confirmación; si sale bien vuelve a la ficha", async () => {
    mundo.ficha = FICHA;
    const f = datos({
      confirmar: "1",
      empresaId: "otra",
      unidadId: "GRAMO",
      ordenId: "x",
      clave: "y",
    });
    await expect(cerrarLaOrdenDelFormulario(ORDEN, CLAVE, f)).rejects.toThrow(
      `NEXT_REDIRECT /catalogo/produccion/${ORDEN}`,
    );
    expect(mundo.casos).toEqual([
      [
        "cerrar",
        CONTEXTO,
        {
          ordenId: ORDEN,
          clave: CLAVE,
          obtenido: "15",
          unidadId: "KILOGRAMO",
          vence: "2026-12-31",
          consumos: [
            { productoId: HARINA, cantidadReal: "12", unidadId: "KILOGRAMO" },
            { productoId: MANTECA, cantidadReal: "3.5", unidadId: "KILOGRAMO" },
          ],
          confirmaciones: ["stock.existencia_negativa"],
        },
      ],
    ]);
  });

  it("repetirlo (ya existía) también vuelve a la ficha: no duplica ni da error", async () => {
    mundo.ficha = FICHA;
    mundo.resultadoDeCerrar = ok({
      lote: null,
      costoUnitario: null,
      costoEstado: "SIN_COSTO",
      mermaDeLote: "0",
      excepciones: [],
      yaExistia: true,
    });
    await expect(cerrarLaOrdenDelFormulario(ORDEN, CLAVE, datos())).rejects.toThrow(
      `NEXT_REDIRECT /catalogo/produccion/${ORDEN}`,
    );
  });

  it("un campo de consumo que no es texto es un consumo en blanco (cero): lo decide el servidor", async () => {
    mundo.ficha = FICHA;
    const f = new FormData();
    f.append("consumos", new File(["x"], "x.txt"));
    f.append("consumos", "4");
    f.set("obtenido", "15");
    await expect(cerrarLaOrdenDelFormulario(ORDEN, CLAVE, f)).rejects.toThrow("NEXT_REDIRECT");
    expect(mundo.casos[0]?.[2]).toMatchObject({
      consumos: [{ cantidadReal: "0" }, { cantidadReal: "4" }],
      vence: null,
    });
  });

  it("si el servidor pide confirmar, devuelve el aviso y se queda en el formulario; si falta el vencimiento, su texto", async () => {
    mundo.ficha = FICHA;
    mundo.resultadoDeCerrar = err({ error: "CONTROL_REQUIERE_CONFIRMACION", detalle: [] });
    expect(await cerrarLaOrdenDelFormulario(ORDEN, CLAVE, datos())).toMatchObject({
      error: { codigo: "STOCK_CONTROL_AVISA" },
    });
    expect(mundo.casos[0]?.[2]).not.toHaveProperty("confirmaciones");
    mundo.resultadoDeCerrar = err("VENCIMIENTO_REQUERIDO");
    expect(await cerrarLaOrdenDelFormulario(ORDEN, CLAVE, datos())).toMatchObject({
      error: { codigo: "LOTE_VENCIMIENTO_REQUERIDO" },
    });
    mundo.resultadoDeCerrar = err("ORDEN_YA_CERRADA");
    expect(await cerrarLaOrdenDelFormulario(ORDEN, CLAVE, datos())).toMatchObject({
      error: { codigo: "PRODUCCION_ACCION_NO_PERMITIDA" },
    });
  });

  it("una orden que no está: el genérico y no se cierra nada", async () => {
    expect(await cerrarLaOrdenDelFormulario(ORDEN, CLAVE, datos())).toMatchObject({
      error: { codigo: "PRODUCCION_ACCION_NO_PERMITIDA" },
    });
    expect(mundo.casos).toEqual([]);
  });
});
