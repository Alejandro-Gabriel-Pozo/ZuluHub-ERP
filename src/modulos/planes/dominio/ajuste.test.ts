import { describe, expect, it } from "vitest";
import { PERILLAS_DE_PRUEBA, apagada, encendida, limite } from "../../../../test/utilidades/planes";
import type { DefinicionDePerilla } from "../../../capacidades/planes/perillas";
import type { Decision } from "../../../capacidades/planes/vigencia";
import { empresaId } from "../../../primitivas/identificadores/marca";
import { decidirAjuste, type PedidoDeAjuste } from "./ajuste";

const BASE = Date.UTC(2026, 9, 12, 12, 0, 0);
const DIA = 86_400_000;
const en = (ms: number) => new Date(BASE + ms);
const ahora = en(0);
const E1 = empresaId("empresa-1");
const catalogo: Readonly<Record<string, DefinicionDePerilla>> = PERILLAS_DE_PRUEBA;

const decision = (numero: number, desdeMs: number): Decision => ({
  numero,
  vigenteDesde: en(desdeMs),
});

const pedido = (extra: Partial<PedidoDeAjuste> = {}): PedidoDeAjuste => ({
  ahora,
  perilla: "cajas_por_sucursal",
  empresaId: null,
  valor: limite(3),
  vigenteDesde: ahora,
  motivo: "Pagó el extra",
  numeroEsperado: null,
  reemplazaProgramada: false,
  valoresActuales: new Map(),
  ...extra,
});

const decidir = (historial: readonly Decision[], extra: Partial<PedidoDeAjuste> = {}) =>
  decidirAjuste(catalogo, historial, pedido(extra));

describe("decidirAjuste: lo que se inserta", () => {
  it("el primer ajuste de una serie lleva el número 1, el valor y el motivo recortado", () => {
    expect(decidir([], { motivo: "  Pagó el extra " })).toEqual({
      ok: true,
      valor: { numero: 1, valor: limite(3), motivo: "Pagó el extra", reemplazadas: [] },
    });
  });

  it("DEL_PLAN vuelve al plan y se inserta como cualquier decisión", () => {
    expect(decidir([decision(1, -DIA)], { valor: "DEL_PLAN", numeroEsperado: 1 })).toEqual({
      ok: true,
      valor: { numero: 2, valor: "DEL_PLAN", motivo: "Pagó el extra", reemplazadas: [] },
    });
  });

  it("un ajuste de empresa para una perilla de ámbito empresa o sucursal", () => {
    expect(decidir([], { empresaId: E1 }).ok).toBe(true);
    expect(decidir([], { perilla: "vidriera_por_qr", valor: encendida, empresaId: E1 }).ok).toBe(
      true,
    );
  });

  it("ILIMITADO y 0 se aceptan", () => {
    expect(decidir([], { valor: limite("ILIMITADO") }).ok).toBe(true);
    expect(decidir([], { valor: limite(0) }).ok).toBe(true);
  });

  it("reemplaza una programada si se pide", () => {
    const r = decidir([decision(1, DIA)], {
      numeroEsperado: 1,
      reemplazaProgramada: true,
      vigenteDesde: en(DIA),
    });
    expect(r).toMatchObject({ ok: true, valor: { numero: 2, reemplazadas: [1] } });
  });
});

describe("decidirAjuste: los errores, en su orden", () => {
  it("motivo obligatorio", () => {
    expect(decidir([], { motivo: "  " })).toEqual({
      ok: false,
      error: { codigo: "MOTIVO_OBLIGATORIO" },
    });
  });

  it("perilla desconocida (también un nombre heredado de Object)", () => {
    expect(decidir([], { perilla: "fantasma" })).toEqual({
      ok: false,
      error: { codigo: "PERILLA_DESCONOCIDA" },
    });
    expect(decidir([], { perilla: "constructor" })).toEqual({
      ok: false,
      error: { codigo: "PERILLA_DESCONOCIDA" },
    });
  });

  it("ámbito no permitido: una perilla de tenant no se ajusta por empresa", () => {
    expect(decidir([], { perilla: "empresas_por_tenant", empresaId: E1 })).toEqual({
      ok: false,
      error: { codigo: "AMBITO_NO_PERMITIDO" },
    });
    expect(decidir([], { perilla: "empresas_por_tenant", empresaId: null }).ok).toBe(true);
  });

  it.each([
    ["tipo equivocado", limite(1), "vidriera_por_qr"],
    ["negativo", limite(-1), "cajas_por_sucursal"],
    ["decimal", limite(0.5), "cajas_por_sucursal"],
    ["sin etiqueta", { limite: 3 }, "cajas_por_sucursal"],
    ["texto", "3", "cajas_por_sucursal"],
    ["nulo", null, "cajas_por_sucursal"],
    ["otro texto que no es DEL_PLAN", "del_plan", "cajas_por_sucursal"],
  ])("valor inválido: %s", (_, valor, perilla) => {
    expect(decidir([], { perilla, valor })).toEqual({
      ok: false,
      error: { codigo: "VALOR_DE_PERILLA_INVALIDO", perilla },
    });
  });

  it("requiere apagada: no se enciende una perilla cuya requerida está apagada", () => {
    for (const valoresActuales of [
      new Map(),
      new Map([["asignacion_diferida", apagada]]),
      new Map([["asignacion_diferida", limite(0)]]),
    ]) {
      expect(decidir([], { perilla: "overbooking", valor: limite(2), valoresActuales })).toEqual({
        ok: false,
        error: {
          codigo: "PERILLA_REQUIERE_OTRA",
          perilla: "overbooking",
          requiere: "asignacion_diferida",
        },
      });
    }
  });

  it("con la requerida encendida se acepta", () => {
    expect(
      decidir([], {
        perilla: "overbooking",
        valor: limite(2),
        valoresActuales: new Map([["asignacion_diferida", encendida]]),
      }).ok,
    ).toBe(true);
    expect(
      decidir([], {
        perilla: "overbooking",
        valor: limite("ILIMITADO"),
        valoresActuales: new Map([["asignacion_diferida", encendida]]),
      }).ok,
    ).toBe(true);
  });

  it("apagar una dependiente, o volver al plan, no exige a la requerida", () => {
    expect(decidir([], { perilla: "overbooking", valor: limite(0) }).ok).toBe(true);
    expect(decidir([], { perilla: "confirmacion_por_sena", valor: apagada }).ok).toBe(true);
    expect(decidir([], { perilla: "overbooking", valor: "DEL_PLAN" }).ok).toBe(true);
  });

  it("una perilla sin requerida no mira nada más", () => {
    expect(decidir([], { perilla: "vidriera_por_qr", valor: encendida }).ok).toBe(true);
  });

  it("los errores de vigencia: retroactiva, desactualizada, programada pendiente", () => {
    expect(decidir([], { vigenteDesde: en(-DIA) })).toEqual({
      ok: false,
      error: { codigo: "VIGENCIA_RETROACTIVA" },
    });
    expect(decidir([decision(1, -DIA)], { numeroEsperado: null })).toEqual({
      ok: false,
      error: { codigo: "VERSION_DESACTUALIZADA" },
    });
    expect(decidir([decision(1, DIA)], { numeroEsperado: 1 })).toEqual({
      ok: false,
      error: { codigo: "CAMBIO_PROGRAMADO_PENDIENTE" },
    });
  });

  it("orden: motivo, perilla, ámbito, valor, requiere, vigencia", () => {
    const todoMal: Partial<PedidoDeAjuste> = {
      motivo: "",
      perilla: "empresas_por_tenant",
      empresaId: E1,
      valor: "basura",
      vigenteDesde: en(-DIA),
    };
    expect(decidir([], todoMal)).toMatchObject({ error: { codigo: "MOTIVO_OBLIGATORIO" } });
    expect(decidir([], { ...todoMal, motivo: "x", perilla: "fantasma" })).toMatchObject({
      error: { codigo: "PERILLA_DESCONOCIDA" },
    });
    expect(decidir([], { ...todoMal, motivo: "x" })).toMatchObject({
      error: { codigo: "AMBITO_NO_PERMITIDO" },
    });
    expect(decidir([], { ...todoMal, motivo: "x", empresaId: null })).toMatchObject({
      error: { codigo: "VALOR_DE_PERILLA_INVALIDO" },
    });
    expect(
      decidir([], {
        motivo: "x",
        perilla: "overbooking",
        valor: limite(2),
        vigenteDesde: en(-DIA),
      }),
    ).toMatchObject({ error: { codigo: "PERILLA_REQUIERE_OTRA" } });
    expect(decidir([], { motivo: "x", valor: limite(2), vigenteDesde: en(-DIA) })).toMatchObject({
      error: { codigo: "VIGENCIA_RETROACTIVA" },
    });
  });

  it("no modifica sus entradas", () => {
    const h = [decision(1, DIA)];
    const p = pedido({ numeroEsperado: 1, reemplazaProgramada: true });
    const copia = structuredClone({ h, p: { ...p, valoresActuales: [...p.valoresActuales] } });
    decidirAjuste(catalogo, h, p);
    expect({ h, p: { ...p, valoresActuales: [...p.valoresActuales] } }).toEqual(copia);
  });
});
