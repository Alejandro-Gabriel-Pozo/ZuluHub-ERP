import { describe, expect, it } from "vitest";
import type { ContextoOperativo } from "../contexto/contexto";
import { err, ok } from "../primitivas/resultado/resultado";
import {
  controlarElLoteDelArticulo,
  corregirElLote,
  dejarDeControlarElLoteDelArticulo,
  depositosParaReasignar,
  reasignarEntreLotes,
  type DependenciasDeLotesEscrituraWeb,
} from "./lotes-escritura-web";

/** Las acciones de lotes con el módulo simulado: qué resuelve la composición (producto del servidor, modo fijo, depósito de la sucursal) y qué pide al caso de uso. Contra la base real, `test/integracion/stock-lotes-web.test.ts`. */
const SUC = "11111111-1111-4111-8111-111111111111";
const D1 = "22222222-2222-4222-8222-222222222222";
const D2 = "33333333-3333-4333-8333-333333333333";
const A1 = "55555555-5555-4555-8555-555555555555";
const L1 = "66666666-6666-4666-8666-666666666666";
const L2 = "77777777-7777-4777-8777-777777777777";
const CLAVE = "88888888-8888-4888-8888-888888888888";
const contexto = { empresaId: "e1" } as unknown as ContextoOperativo;
const GENERICO = "STOCK_ACCION_NO_PERMITIDA";

const codigoDe = (r: { ok: boolean; error?: { codigo: string } }) =>
  r.ok ? "OK" : (r.error?.codigo ?? "?");

const montar = (r: { reasignar?: () => unknown; corregir?: () => unknown } = {}) => {
  const llamadas: { que: string; entrada: unknown }[] = [];
  const d = {
    casosDeUso: () => ({
      controlarLote: (_c: unknown, entrada: unknown) => {
        llamadas.push({ que: "controlar", entrada });
        return Promise.resolve(ok({ articuloId: A1, yaExistia: false }));
      },
      dejarDeControlarLote: (_c: unknown, entrada: unknown) => {
        llamadas.push({ que: "dejar", entrada });
        return Promise.resolve(ok({ yaEstaba: false }));
      },
      corregirLote: (_c: unknown, entrada: unknown) => {
        llamadas.push({ que: "corregir", entrada });
        return Promise.resolve((r.corregir ?? (() => ok({ version: 4 })))());
      },
      reasignarLote: (_c: unknown, entrada: unknown) => {
        llamadas.push({ que: "reasignar", entrada });
        return Promise.resolve((r.reasignar ?? (() => ok({ yaExistia: false })))());
      },
    }),
    consultas: () => ({
      articulosControlados: () =>
        Promise.resolve(
          ok([{ articuloId: A1, productoId: "p1", nombre: "Queso", unidadId: "KILOGRAMO" }]),
        ),
      listarDepositos: () =>
        Promise.resolve(
          ok([
            { id: D1, nombre: "Salón", activo: true },
            { id: D2, nombre: "Viejo", activo: false },
          ]),
        ),
    }),
    respuesta: { registrar: () => undefined },
  } as unknown as DependenciasDeLotesEscrituraWeb;
  return { d, llamadas };
};

describe("controlarElLoteDelArticulo / dejarDeControlarElLoteDelArticulo", () => {
  it("el producto sale del servidor y el modo es fijo: con vencimiento y sin calidad", async () => {
    const { d, llamadas } = montar();
    expect(await controlarElLoteDelArticulo(d, contexto, { articuloId: A1 })).toMatchObject({
      ok: true,
      dato: { yaExistia: false },
    });
    expect(llamadas).toEqual([
      {
        que: "controlar",
        entrada: { productoId: "p1", modo: "LOTE_Y_VENCIMIENTO", conCalidad: false },
      },
    ]);
  });

  it("dejar de controlar pide el producto del servidor", async () => {
    const { d, llamadas } = montar();
    expect(await dejarDeControlarElLoteDelArticulo(d, contexto, { articuloId: A1 })).toMatchObject({
      ok: true,
      dato: { yaEstaba: false },
    });
    expect(llamadas).toEqual([{ que: "dejar", entrada: { productoId: "p1" } }]);
  });

  it("un artículo que no se controla, el modo o el producto mandados por el navegador, o una forma rota, se rechazan sin llamar al caso de uso", async () => {
    const { d, llamadas } = montar();
    for (const crudo of [
      { articuloId: L1 },
      { articuloId: A1, modo: "LOTE" },
      { articuloId: A1, productoId: "p1" },
      { articuloId: "x" },
      {},
    ]) {
      expect(codigoDe(await controlarElLoteDelArticulo(d, contexto, crudo))).toBe(GENERICO);
      expect(codigoDe(await dejarDeControlarElLoteDelArticulo(d, contexto, crudo))).toBe(GENERICO);
    }
    expect(llamadas).toEqual([]);
  });
});

describe("corregirElLote", () => {
  const base = { loteId: L1, version: 3, vence: "2026-12-02", detalle: "se cargó mal" };

  it("manda la VERSIÓN que se vio, la fecha y el motivo; devuelve la versión nueva", async () => {
    const { d, llamadas } = montar();
    expect(await corregirElLote(d, contexto, base)).toMatchObject({
      ok: true,
      dato: { version: 4 },
    });
    expect(llamadas[0]).toEqual({
      que: "corregir",
      entrada: {
        loteId: L1,
        versionEsperada: 3,
        fechaDeVencimiento: "2026-12-02",
        detalle: "se cargó mal",
      },
    });
  });

  it("la versión puede llegar como texto de dígitos; una fecha que no es AAAA-MM-DD o una versión negativa se rechazan", async () => {
    const { d, llamadas } = montar();
    expect((await corregirElLote(d, contexto, { ...base, version: "3" })).ok).toBe(true);
    for (const malo of [
      { ...base, vence: "2/12/2026" },
      { ...base, vence: "" },
      { ...base, vence: "2026-12-02x" },
      { ...base, vence: "x2026-12-02" },
      { ...base, vence: "2026-12-02\n" },
      { ...base, version: "-1" },
      { ...base, version: "3.5" },
      { ...base, otro: 1 },
    ]) {
      expect(codigoDe(await corregirElLote(d, contexto, malo))).toBe(GENERICO);
    }
    expect(llamadas).toHaveLength(1);
  });

  it("un lote desactualizado llega como error, no como éxito", async () => {
    const { d } = montar({ corregir: () => err("LOTE_DESACTUALIZADO" as const) });
    expect((await corregirElLote(d, contexto, base)).ok).toBe(false);
  });
});

describe("reasignarEntreLotes", () => {
  const base = {
    clave: CLAVE,
    articuloId: A1,
    depositoId: D1,
    loteOrigenId: L1,
    loteDestinoId: L2,
    cantidad: "2.5",
    detalle: "llegó el lote",
  };

  it("el producto sale del servidor y el depósito tiene que ser un depósito activo de la sucursal", async () => {
    const { d, llamadas } = montar();
    expect(await reasignarEntreLotes(d, contexto, SUC, base)).toMatchObject({
      ok: true,
      dato: { yaExistia: false },
    });
    expect(llamadas[0]).toEqual({
      que: "reasignar",
      entrada: {
        clave: CLAVE,
        depositoId: D1,
        productoId: "p1",
        loteOrigenId: L1,
        loteDestinoId: L2,
        cantidad: "2.5",
        motivo: "llegó el lote",
      },
    });
  });

  it("un depósito inactivo o de otra sucursal, un artículo ajeno, un campo de más o una clave rota no llegan al caso de uso", async () => {
    const { d, llamadas } = montar();
    for (const malo of [
      { ...base, depositoId: D2 },
      { ...base, depositoId: L1 },
      { ...base, articuloId: L1 },
      { ...base, productoId: "p1" },
      { ...base, clave: "x" },
      { ...base, cantidad: "9".repeat(41) },
    ]) {
      expect(codigoDe(await reasignarEntreLotes(d, contexto, SUC, malo))).toBe(GENERICO);
    }
    expect(llamadas).toEqual([]);
  });

  it("el saldo insuficiente del lote sale con su texto propio y la repetición con el mismo contenido es éxito", async () => {
    const corto = montar({ reasignar: () => err("SALDO_DE_LOTE_INSUFICIENTE" as const) });
    expect(codigoDe(await reasignarEntreLotes(corto.d, contexto, SUC, base))).toBe(
      "STOCK_SALDO_DE_LOTE_INSUFICIENTE",
    );
    const repetida = montar({ reasignar: () => ok({ yaExistia: true }) });
    expect(await reasignarEntreLotes(repetida.d, contexto, SUC, base)).toMatchObject({
      ok: true,
      dato: { yaExistia: true },
    });
  });
});

describe("depositosParaReasignar", () => {
  it("lista solo los depósitos activos de la sucursal, con su nombre", async () => {
    const { d } = montar();
    expect(await depositosParaReasignar(d, contexto, SUC)).toMatchObject({
      ok: true,
      dato: [{ id: D1, nombre: "Salón" }],
    });
  });
});
