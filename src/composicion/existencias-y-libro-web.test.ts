import { describe, expect, it } from "vitest";
import type { ContextoOperativo } from "../contexto/contexto";
import { err, ok } from "../primitivas/resultado/resultado";
import {
  existenciasDelDeposito,
  movimientosDelDeposito,
  type DependenciasDeExistenciasYLibroWeb,
} from "./existencias-y-libro-web";

/**
 * «Existencias» y «Movimientos» de la web con el módulo simulado: qué pide la composición (sucursal del servidor, depósito entre los de la sucursal, cursor opaco) y qué sale hacia la pantalla.
 * Contra la base real, `test/integracion/stock-movimientos-del-deposito.test.ts`.
 */
const SUC = "11111111-1111-4111-8111-111111111111";
const D1 = "22222222-2222-4222-8222-222222222222";
const D2 = "33333333-3333-4333-8333-333333333333";
const P1 = "44444444-4444-4444-8444-444444444444";
const M1 = "55555555-5555-4555-8555-555555555555";
const A1 = "66666666-6666-4666-8666-666666666666";
const contexto = { empresaId: "e1" } as unknown as ContextoOperativo;
const GENERICO = "STOCK_ACCION_NO_PERMITIDA";

const deposito = (id: string, nombre: string, activo = true) => ({ id, nombre, activo });
const movimiento = (cambios: Record<string, unknown> = {}) => ({
  movimientoId: M1,
  numero: 1,
  clase: "ENTRADA",
  motivo: "COMPRA",
  origenTipo: "MANUAL",
  hechoEn: new Date("2026-11-25T15:30:00.000Z"),
  registradoPor: P1,
  articuloId: A1,
  productoId: "p1",
  nombre: "Harina",
  unidadId: "KG",
  cantidad: "5.5000",
  esAnulacion: false,
  anulado: false,
  anulable: true,
  ...cambios,
});

type Montaje = {
  llamadas: { que: string; entrada: unknown }[];
  registrados: string[];
  depositos: () => unknown;
  existencias: () => unknown;
  movimientos: () => unknown;
  personas: () => unknown;
};
const montar = (cambios: Partial<Montaje> = {}) => {
  const m: Montaje = {
    llamadas: [],
    registrados: [],
    depositos: () => ok([deposito(D1, "Salón"), deposito(D2, "Cocina")]),
    existencias: () => ok({ existencias: [], siguiente: null }),
    movimientos: () => ok({ movimientos: [], siguiente: null }),
    personas: () => ok(new Map([[P1, "ana@ejemplo.com"]])),
    ...cambios,
  };
  const registrar = (que: string, entrada: unknown, r: () => unknown) => {
    m.llamadas.push({ que, entrada });
    return Promise.resolve(r());
  };
  const d = {
    consultas: () => ({
      listarDepositos: (_c: unknown, e: unknown) => registrar("depositos", e, m.depositos),
      existencias: (_c: unknown, e: unknown) => registrar("existencias", e, m.existencias),
      movimientosDelDeposito: (_c: unknown, e: unknown) =>
        registrar("movimientos", e, m.movimientos),
    }),
    consultasDeIdentidad: () => ({
      personasParaMostrar: (_c: unknown, e: unknown) => registrar("personas", e, m.personas),
    }),
    respuesta: { registrar: (detalle: string) => m.registrados.push(detalle) },
  } as unknown as DependenciasDeExistenciasYLibroWeb;
  return { m, d };
};
const codigoDe = (r: { ok: boolean; error?: { codigo: string } }) =>
  r.ok ? "OK" : (r.error?.codigo ?? "?");
const cursor = (x: object) => Buffer.from(JSON.stringify(x)).toString("base64url");

describe("existenciasDelDeposito", () => {
  it("sin depósito pedido toma el primero de la sucursal; la existencia sale como texto y «negativa» es el signo", async () => {
    const { m, d } = montar({
      existencias: () =>
        ok({
          existencias: [
            {
              articuloId: A1,
              productoId: "p",
              nombre: "Harina",
              unidadId: "KG",
              depositoId: D1,
              existencia: "-2.0000",
              uso: "NORMAL",
              disponible: "0",
            },
            {
              articuloId: "a2",
              productoId: "p2",
              nombre: "Sal",
              unidadId: "KG",
              depositoId: D1,
              existencia: "3.5000",
              uso: "NORMAL",
              disponible: "3.5",
            },
          ],
          siguiente: null,
        }),
    });
    const r = await existenciasDelDeposito(d, contexto, SUC, {});
    expect(r).toEqual({
      ok: true,
      dato: {
        depositos: [
          { id: D1, nombre: "Salón" },
          { id: D2, nombre: "Cocina" },
        ],
        depositoId: D1,
        existencias: [
          {
            articuloId: A1,
            nombre: "Harina",
            unidadId: "KG",
            existencia: "-2.0000",
            negativa: true,
          },
          {
            articuloId: "a2",
            nombre: "Sal",
            unidadId: "KG",
            existencia: "3.5000",
            negativa: false,
          },
        ],
        siguiente: null,
      },
    });
    expect(m.llamadas[0]).toEqual({ que: "depositos", entrada: { sucursalId: SUC } });
    expect(m.llamadas[1]).toEqual({
      que: "existencias",
      entrada: { depositoId: D1, despuesDe: undefined },
    });
  });

  it("no ofrece los desactivados; pedir uno que no es de la sucursal es el genérico y no lee existencias", async () => {
    const { m, d } = montar({
      depositos: () => ok([deposito(D1, "Salón"), deposito(D2, "Viejo", false)]),
    });
    expect((await existenciasDelDeposito(d, contexto, SUC, {})).ok).toBe(true);
    const r = await existenciasDelDeposito(d, contexto, SUC, { depositoId: D2 });
    expect(codigoDe(r)).toBe(GENERICO);
    expect(m.llamadas.filter((l) => l.que === "existencias")).toHaveLength(1);
  });

  it("una sucursal sin depósitos activos sale vacía, sin consultar existencias", async () => {
    const { m, d } = montar({ depositos: () => ok([]) });
    const r = await existenciasDelDeposito(d, contexto, SUC, {});
    expect(r).toEqual({
      ok: true,
      dato: { depositos: [], depositoId: null, existencias: [], siguiente: null },
    });
    expect(m.llamadas.map((l) => l.que)).toEqual(["depositos"]);
  });

  it("el cursor de la página siguiente viaja opaco y vuelve a la consulta tal cual; uno roto es el genérico", async () => {
    const sig = { nombreClave: "harina", articuloId: A1, depositoId: D1 };
    const a = montar({ existencias: () => ok({ existencias: [], siguiente: sig }) });
    const pagina = await existenciasDelDeposito(a.d, contexto, SUC, {});
    const opaco = pagina.ok ? pagina.dato.siguiente : null;
    expect(opaco).toBe(cursor(sig));
    const b = montar();
    await existenciasDelDeposito(b.d, contexto, SUC, { despues: opaco });
    expect(b.m.llamadas.find((l) => l.que === "existencias")?.entrada).toEqual({
      depositoId: D1,
      despuesDe: sig,
    });
    for (const roto of ["no es base64 de json", cursor({ nombreClave: 1 }), cursor([1])]) {
      const c = montar();
      expect(codigoDe(await existenciasDelDeposito(c.d, contexto, SUC, { despues: roto }))).toBe(
        GENERICO,
      );
      expect(c.m.llamadas).toEqual([]);
    }
  });

  it("un id que no tiene forma de id es el genérico; un error de la consulta no se esconde; una excepción sale con referencia", async () => {
    const a = montar();
    expect(codigoDe(await existenciasDelDeposito(a.d, contexto, SUC, { depositoId: "x" }))).toBe(
      GENERICO,
    );
    const b = montar({ existencias: () => err({ tipo: "ERROR_DE_BASE" }) });
    const r = await existenciasDelDeposito(b.d, contexto, SUC, {});
    expect(codigoDe(r)).not.toBe(GENERICO);
    expect(b.m.registrados).toHaveLength(1);
    const c = montar({
      existencias: () => {
        throw new Error("la base no responde");
      },
    });
    expect(codigoDe(await existenciasDelDeposito(c.d, contexto, SUC, {}))).not.toBe(GENERICO);
    expect(c.m.registrados).toHaveLength(1);
  });
});

describe("movimientosDelDeposito", () => {
  it("una tarjeta por renglón con el correo de quien lo registró (una sola consulta de personas), el instante en ISO y sin ids de persona", async () => {
    const { m, d } = montar({
      movimientos: () =>
        ok({ movimientos: [movimiento(), movimiento({ numero: 2 })], siguiente: null }),
    });
    const r = await movimientosDelDeposito(d, contexto, SUC, {});
    expect(r.ok && r.dato.movimientos.map((x) => [x.numero, x.quien, x.hechoEn])).toEqual([
      [1, "ana@ejemplo.com", "2026-11-25T15:30:00.000Z"],
      [2, "ana@ejemplo.com", "2026-11-25T15:30:00.000Z"],
    ]);
    expect(JSON.stringify(r)).not.toContain(P1);
    expect(m.llamadas.filter((l) => l.que === "personas")).toEqual([
      { que: "personas", entrada: { ids: [P1] } },
    ]);
  });

  it("sin permiso para ver personas, el correo sale en null y la lista sale igual; otro fallo de identidad no se esconde", async () => {
    const a = montar({
      movimientos: () => ok({ movimientos: [movimiento()], siguiente: null }),
      personas: () => err("SIN_PERMISO"),
    });
    const r = await movimientosDelDeposito(a.d, contexto, SUC, {});
    expect(r.ok && r.dato.movimientos[0]?.quien).toBeNull();
    const b = montar({
      movimientos: () => ok({ movimientos: [movimiento()], siguiente: null }),
      personas: () => err({ tipo: "ERROR_DE_BASE" }),
    });
    expect(codigoDe(await movimientosDelDeposito(b.d, contexto, SUC, {}))).not.toBe(GENERICO);
  });

  it("sin movimientos no consulta personas; la cantidad sigue siendo texto y las banderas del servidor salen tal cual", async () => {
    const a = montar();
    await movimientosDelDeposito(a.d, contexto, SUC, {});
    expect(a.m.llamadas.some((l) => l.que === "personas")).toBe(false);
    const b = montar({
      movimientos: () =>
        ok({
          movimientos: [movimiento({ cantidad: "-1.2500", anulado: true, anulable: false })],
          siguiente: null,
        }),
    });
    const r = await movimientosDelDeposito(b.d, contexto, SUC, {});
    expect(r.ok && r.dato.movimientos[0]).toMatchObject({
      cantidad: "-1.2500",
      anulado: true,
      anulable: false,
    });
  });

  it("el cursor viaja opaco; uno roto o de otra forma es el genérico y no consulta", async () => {
    const sig = { hechoEn: "2026-11-25T15:30:00.000Z", movimientoId: M1, numero: 3 };
    const a = montar({ movimientos: () => ok({ movimientos: [], siguiente: sig }) });
    const pagina = await movimientosDelDeposito(a.d, contexto, SUC, { depositoId: D2 });
    const opaco = pagina.ok ? pagina.dato.siguiente : null;
    expect(opaco).toBe(cursor(sig));
    const b = montar();
    await movimientosDelDeposito(b.d, contexto, SUC, { depositoId: D2, despues: opaco });
    expect(b.m.llamadas.find((l) => l.que === "movimientos")?.entrada).toEqual({
      depositoId: D2,
      despuesDe: sig,
    });
    const c = montar();
    expect(
      codigoDe(
        await movimientosDelDeposito(c.d, contexto, SUC, { despues: cursor({ hechoEn: 1 }) }),
      ),
    ).toBe(GENERICO);
    expect(c.m.llamadas).toEqual([]);
  });
});
