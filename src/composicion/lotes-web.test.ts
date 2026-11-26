import { describe, expect, it } from "vitest";
import type { ContextoOperativo } from "../contexto/contexto";
import { err, ok } from "../primitivas/resultado/resultado";
import {
  DIAS_POR_DEFECTO,
  lotesDelArticulo,
  vencimientosDeLaSucursal,
  type DependenciasDeLotesWeb,
} from "./lotes-web";

/** La pestaña «Lotes» con el módulo simulado: qué pide la composición y qué sale hacia la pantalla. Contra la base real, `test/integracion/stock-lotes-web.test.ts`. */
const SUC = "11111111-1111-4111-8111-111111111111";
const A1 = "66666666-6666-4666-8666-666666666666";
const A2 = "77777777-7777-4777-8777-777777777777";
const contexto = { empresaId: "e1" } as unknown as ContextoOperativo;
const GENERICO = "STOCK_ACCION_NO_PERMITIDA";

const controlado = (articuloId: string, nombre: string) => ({
  articuloId,
  productoId: "p",
  nombre,
  unidadId: "KG",
});
const lote = (cambios: Record<string, unknown> = {}) => ({
  loteId: "l1",
  codigo: "Q-1",
  fechaDeVencimiento: "2026-12-02",
  esSinAsignar: false,
  existencia: "3.0000",
  disponible: "2.0000",
  version: 3,
  depositos: [],
  ...cambios,
});
const venc = (cambios: Record<string, unknown> = {}) => ({
  loteId: "l1",
  articuloId: A1,
  productoId: "p",
  nombre: "Queso",
  codigo: "Q-1",
  depositoId: "d1",
  sucursalId: SUC,
  vence: "2026-11-25",
  existencia: "3.0000",
  unidadId: "KG",
  situacion: { tipo: "VENCE_HOY" },
  seLosPierde: "123.000000",
  ...cambios,
});

const montar = (
  r: { controlados?: () => unknown; lotes?: () => unknown; vencen?: () => unknown } = {},
) => {
  const llamadas: { que: string; entrada: unknown }[] = [];
  const registrados: string[] = [];
  const d = {
    consultas: () => ({
      articulosControlados: () => {
        llamadas.push({ que: "controlados", entrada: undefined });
        return Promise.resolve(
          (r.controlados ?? (() => ok([controlado(A1, "Queso"), controlado(A2, "Pollo")])))(),
        );
      },
      lotesDeArticulo: (_c: unknown, entrada: unknown) => {
        llamadas.push({ que: "lotes", entrada });
        return Promise.resolve(
          (r.lotes ?? (() => ok({ articuloId: A1, control: null, lotes: [lote()] })))(),
        );
      },
      vencimientosProximos: (_c: unknown, entrada: unknown) => {
        llamadas.push({ que: "vencen", entrada });
        return Promise.resolve((r.vencen ?? (() => ok([venc()])))());
      },
    }),
    respuesta: { registrar: (detalle: string) => registrados.push(detalle) },
  } as unknown as DependenciasDeLotesWeb;
  return { d, llamadas, registrados };
};
const codigoDe = (r: { ok: boolean; error?: { codigo: string } }) =>
  r.ok ? "OK" : (r.error?.codigo ?? "?");

describe("lotesDelArticulo", () => {
  it("sin artículo pedido toma el primero controlado y sale con su unidad; cantidades como texto, sin importes", async () => {
    const { d, llamadas } = montar();
    const r = await lotesDelArticulo(d, contexto, {});
    expect(r).toEqual({
      ok: true,
      dato: {
        articulos: [
          { id: A1, nombre: "Queso" },
          { id: A2, nombre: "Pollo" },
        ],
        articuloId: A1,
        unidadId: "KG",
        control: null,
        lotes: [
          {
            loteId: "l1",
            codigo: "Q-1",
            vence: "2026-12-02",
            existencia: "3.0000",
            disponible: "2.0000",
            sinAsignar: false,
            version: 3,
            depositos: [],
          },
        ],
      },
    });
    expect(llamadas.find((x) => x.que === "lotes")?.entrada).toEqual({ articuloId: A1 });
  });

  it("el artículo pedido tiene que estar entre los controlados: otro sale como el genérico y no consulta lotes", async () => {
    const { d, llamadas, registrados } = montar();
    const r = await lotesDelArticulo(d, contexto, {
      articuloId: "88888888-8888-4888-8888-888888888888",
    });
    expect(codigoDe(r)).toBe(GENERICO);
    expect(llamadas.map((x) => x.que)).toEqual(["controlados"]);
    expect(registrados).toHaveLength(0);
    expect((await lotesDelArticulo(d, contexto, { articuloId: A2 })).ok).toBe(true);
  });

  it("lo que no es un identificador, o trae campos de más, es el genérico y no consulta", async () => {
    const { d, llamadas } = montar();
    for (const crudo of [
      { articuloId: "x" },
      { articuloId: A1, depositoId: A2 },
      { articuloId: 5 },
    ]) {
      expect(codigoDe(await lotesDelArticulo(d, contexto, crudo))).toBe(GENERICO);
    }
    expect(llamadas).toEqual([]);
  });

  it("sin artículos controlados sale vacío; con lotes sin asignar lo marca", async () => {
    const vacio = await lotesDelArticulo(montar({ controlados: () => ok([]) }).d, contexto, {});
    expect(vacio).toEqual({
      ok: true,
      dato: { articulos: [], articuloId: null, unidadId: null, control: null, lotes: [] },
    });
    const sin = montar({
      lotes: () =>
        ok({
          articuloId: A1,
          control: null,
          lotes: [lote({ esSinAsignar: true, fechaDeVencimiento: null })],
        }),
    });
    const r = await lotesDelArticulo(sin.d, contexto, {});
    expect(r.ok && r.dato.lotes[0]).toMatchObject({ sinAsignar: true, vence: null });
  });

  it("un rechazo de la consulta (permiso) no se esconde: sale con su código", async () => {
    const { d } = montar({ controlados: () => err("SIN_PERMISO") });
    expect(codigoDe(await lotesDelArticulo(d, contexto, {}))).not.toBe("OK");
    const sinLotes = montar({ lotes: () => err("SIN_PERMISO") });
    expect((await lotesDelArticulo(sinLotes.d, contexto, {})).ok).toBe(false);
  });
});

describe("vencimientosDeLaSucursal", () => {
  it("pide la sucursal que fija el servidor y los días por defecto; «vence hoy» sale con estado y NUNCA con importe", async () => {
    const { d, llamadas } = montar();
    const r = await vencimientosDeLaSucursal(d, contexto, SUC, {});
    expect(llamadas[0]).toEqual({
      que: "vencen",
      entrada: { dias: DIAS_POR_DEFECTO, sucursalId: SUC },
    });
    expect(r).toEqual({
      ok: true,
      dato: {
        dias: 7,
        vencimientos: [
          {
            loteId: "l1",
            nombre: "Queso",
            codigo: "Q-1",
            vence: "2026-11-25",
            existencia: "3.0000",
            unidadId: "KG",
            estado: "VENCE_HOY",
          },
        ],
      },
    });
    expect(JSON.stringify(r)).not.toContain("123.000000");
  });

  it("«Vencido» sale con estado; lo que vence más adelante, sin estado", async () => {
    const { d } = montar({
      vencen: () =>
        ok([
          venc({ situacion: { tipo: "VENCIDO", dias: 1 } }),
          venc({ loteId: "l2", situacion: { tipo: "POR_VENCER", dias: 4 } }),
        ]),
    });
    const r = await vencimientosDeLaSucursal(d, contexto, SUC, { dias: "30" });
    expect(r.ok && r.dato.dias).toBe(30);
    expect(r.ok && r.dato.vencimientos.map((v) => v.estado)).toEqual(["VENCIDO", null]);
  });

  it("los días son un entero de 0 a 365: 0 y 365 pasan; otro valor es el genérico y no consulta", async () => {
    const { d, llamadas } = montar();
    expect((await vencimientosDeLaSucursal(d, contexto, SUC, { dias: "0" })).ok).toBe(true);
    expect((await vencimientosDeLaSucursal(d, contexto, SUC, { dias: "365" })).ok).toBe(true);
    const antes = llamadas.length;
    for (const dias of ["366", "-1", "7.5", "abc", "", "1000", 7]) {
      expect(codigoDe(await vencimientosDeLaSucursal(d, contexto, SUC, { dias }))).toBe(GENERICO);
    }
    expect(llamadas).toHaveLength(antes);
  });

  it("un rechazo de la consulta sale con su código", async () => {
    const { d } = montar({ vencen: () => err("SIN_PERMISO") });
    expect((await vencimientosDeLaSucursal(d, contexto, SUC, {})).ok).toBe(false);
  });
});
