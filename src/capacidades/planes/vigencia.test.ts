import { describe, expect, it } from "vitest";
import {
  TOLERANCIA_DE_VIGENCIA_EN_MS,
  decidirCambio,
  estadoDeDecision,
  motivoValido,
  vigenteEn,
  type Decision,
  type PedidoDeCambio,
} from "./vigencia";

const BASE = Date.UTC(2026, 9, 12, 12, 0, 0);
const DIA = 86_400_000;
const en = (ms: number) => new Date(BASE + ms);
const ahora = en(0);
const decision = (numero: number, desdeMs: number): Decision => ({
  numero,
  vigenteDesde: en(desdeMs),
});

describe("vigenteEn: rige la de mayor número entre las que ya empezaron", () => {
  it("sin historial, o sin ninguna empezada, no hay vigente", () => {
    expect(vigenteEn([], ahora)).toBeNull();
    expect(vigenteEn([decision(1, DIA)], ahora)).toBeNull();
  });

  it("la que empieza justo ahora ya rige", () => {
    expect(vigenteEn([decision(1, 0)], ahora)?.numero).toBe(1);
  });

  it("gana el número mayor, no la fecha mayor", () => {
    const h = [decision(1, -10 * DIA), decision(2, -20 * DIA), decision(3, -DIA)];
    expect(vigenteEn(h, ahora)?.numero).toBe(3);
    expect(vigenteEn([decision(1, -DIA), decision(2, -10 * DIA)], ahora)?.numero).toBe(2);
  });

  it("una programada no cuenta aunque tenga el número mayor", () => {
    expect(vigenteEn([decision(1, -DIA), decision(2, DIA)], ahora)?.numero).toBe(1);
  });

  it("no depende del orden de la lista", () => {
    const h = [decision(3, -DIA), decision(1, -DIA), decision(2, -DIA)];
    expect(vigenteEn(h, ahora)?.numero).toBe(3);
    expect(vigenteEn([...h].reverse(), ahora)?.numero).toBe(3);
  });

  it("devuelve la misma decisión que se le pasó (con sus datos extra)", () => {
    const extra = { ...decision(1, -DIA), versionDePlanId: "v1" };
    expect(vigenteEn([extra], ahora)).toBe(extra);
  });

  it("una fecha inválida es un defecto, no una decisión que pase en silencio", () => {
    expect(() => vigenteEn([decision(1, Number.NaN)], ahora)).toThrow(RangeError);
    expect(() => vigenteEn([decision(1, Number.NaN)], ahora)).toThrow(/fecha inválida/);
    expect(() => vigenteEn([decision(1, 0)], new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe("estadoDeDecision: VIGENTE, PROGRAMADA, SIN_EFECTO o ANTERIOR", () => {
  const estados = (h: readonly Decision[]) => h.map((d) => estadoDeDecision(h, d, ahora));

  it("una sola decisión: vigente si empezó, programada si no", () => {
    expect(estados([decision(1, -DIA)])).toEqual(["VIGENTE"]);
    expect(estados([decision(1, 0)])).toEqual(["VIGENTE"]);
    expect(estados([decision(1, DIA)])).toEqual(["PROGRAMADA"]);
  });

  it("la vigente y las anteriores que ya rigieron", () => {
    expect(estados([decision(1, -3 * DIA), decision(2, -2 * DIA), decision(3, -DIA)])).toEqual([
      "ANTERIOR",
      "ANTERIOR",
      "VIGENTE",
    ]);
  });

  it("una programada posterior convive con la vigente", () => {
    expect(estados([decision(1, -DIA), decision(2, DIA)])).toEqual(["VIGENTE", "PROGRAMADA"]);
  });

  it("una decisión nueva que empieza antes deja sin efecto a la programada anterior", () => {
    // 1 programada para dentro de 2 días; 2 empieza hoy: cuando llegue 1, ya manda 2.
    expect(estados([decision(1, 2 * DIA), decision(2, 0)])).toEqual(["SIN_EFECTO", "VIGENTE"]);
    // También si 2 es programada y empieza antes que 1.
    expect(estados([decision(1, 3 * DIA), decision(2, 2 * DIA)])).toEqual([
      "SIN_EFECTO",
      "PROGRAMADA",
    ]);
  });

  it("empezar a la misma hora que una anterior también la deja sin efecto", () => {
    expect(estados([decision(1, DIA), decision(2, DIA)])).toEqual(["SIN_EFECTO", "PROGRAMADA"]);
  });

  it("una programada anterior que empieza ANTES que la nueva sí rige mientras tanto", () => {
    expect(estados([decision(1, DIA), decision(2, 2 * DIA)])).toEqual(["PROGRAMADA", "PROGRAMADA"]);
    const despues = [decision(1, DIA), decision(2, 2 * DIA)].map((d, _, h) =>
      estadoDeDecision(h, d, en(1.5 * DIA)),
    );
    expect(despues).toEqual(["VIGENTE", "PROGRAMADA"]);
    const mas = [decision(1, DIA), decision(2, 2 * DIA)].map((d, _, h) =>
      estadoDeDecision(h, d, en(3 * DIA)),
    );
    expect(mas).toEqual(["ANTERIOR", "VIGENTE"]);
  });

  it("una decisión ya empezada pero pisada por una de mayor número con vigencia anterior nunca rigió", () => {
    expect(estados([decision(1, -DIA), decision(2, -2 * DIA)])).toEqual(["SIN_EFECTO", "VIGENTE"]);
  });

  it("la fecha inválida es un defecto", () => {
    const h = [decision(1, 0)];
    expect(() => estadoDeDecision(h, h[0] as Decision, new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe("decidirCambio", () => {
  const pedido = (extra: Partial<PedidoDeCambio> = {}): PedidoDeCambio => ({
    ahora,
    vigenteDesde: ahora,
    numeroEsperado: null,
    reemplazaProgramada: false,
    ...extra,
  });

  it("la tolerancia es de un minuto", () => {
    expect(TOLERANCIA_DE_VIGENCIA_EN_MS).toBe(60_000);
  });

  it("el primer cambio de una serie vacía lleva el número 1", () => {
    expect(decidirCambio([], pedido())).toEqual({
      ok: true,
      valor: { numero: 1, programadasPendientes: [], reemplazadas: [] },
    });
  });

  it("el siguiente lleva el último + 1 (aunque la lista venga desordenada)", () => {
    const h = [decision(2, -DIA), decision(1, -2 * DIA), decision(3, -DIA)];
    const r = decidirCambio(h, pedido({ numeroEsperado: 3 }));
    expect(r.ok && r.valor.numero).toBe(4);
  });

  it("vigencia retroactiva: más de un minuto antes de ahora; justo un minuto todavía vale", () => {
    const limite = -TOLERANCIA_DE_VIGENCIA_EN_MS;
    expect(decidirCambio([], pedido({ vigenteDesde: en(limite) })).ok).toBe(true);
    expect(decidirCambio([], pedido({ vigenteDesde: en(limite - 1) }))).toEqual({
      ok: false,
      error: { codigo: "VIGENCIA_RETROACTIVA" },
    });
    expect(decidirCambio([], pedido({ vigenteDesde: en(DIA) })).ok).toBe(true);
  });

  it("versión desactualizada: el número esperado tiene que ser el último", () => {
    const h = [decision(1, -DIA), decision(2, -DIA)];
    expect(decidirCambio(h, pedido({ numeroEsperado: 2 })).ok).toBe(true);
    for (const esperado of [1, 3, 0, null]) {
      expect(decidirCambio(h, pedido({ numeroEsperado: esperado }))).toEqual({
        ok: false,
        error: { codigo: "VERSION_DESACTUALIZADA" },
      });
    }
    // Serie vacía: solo vale `null`.
    expect(decidirCambio([], pedido({ numeroEsperado: 0 })).ok).toBe(false);
    expect(decidirCambio([], pedido({ numeroEsperado: 1 })).ok).toBe(false);
  });

  it("cambio programado pendiente: hay una programada y no se pidió reemplazarla", () => {
    const h = [decision(1, -DIA), decision(2, DIA)];
    expect(decidirCambio(h, pedido({ numeroEsperado: 2 }))).toEqual({
      ok: false,
      error: { codigo: "CAMBIO_PROGRAMADO_PENDIENTE" },
    });
    expect(decidirCambio(h, pedido({ numeroEsperado: 2, reemplazaProgramada: true })).ok).toBe(
      true,
    );
  });

  it("una programada ya sin efecto no cuenta como pendiente", () => {
    const h = [decision(1, 2 * DIA), decision(2, 0)];
    expect(decidirCambio(h, pedido({ numeroEsperado: 2 })).ok).toBe(true);
  });

  it("reemplazaProgramada sin nada programado no molesta", () => {
    const r = decidirCambio(
      [decision(1, -DIA)],
      pedido({ numeroEsperado: 1, reemplazaProgramada: true }),
    );
    expect(r).toEqual({
      ok: true,
      valor: { numero: 2, programadasPendientes: [], reemplazadas: [] },
    });
  });

  it("informa las programadas pendientes y las que la nueva deja sin efecto", () => {
    // 2 (en 1 día) y 3 (en 3 días) programadas; la nueva empieza en 2 días: 3 queda sin efecto, 2 rige antes.
    const h = [decision(1, -DIA), decision(3, 3 * DIA), decision(2, DIA)];
    const r = decidirCambio(
      h,
      pedido({ numeroEsperado: 3, reemplazaProgramada: true, vigenteDesde: en(2 * DIA) }),
    );
    expect(r).toEqual({
      ok: true,
      valor: { numero: 4, programadasPendientes: [2, 3], reemplazadas: [3] },
    });
  });

  it("una programada que empieza justo a la hora de la nueva queda reemplazada", () => {
    const h = [decision(1, DIA)];
    const r = decidirCambio(
      h,
      pedido({ numeroEsperado: 1, reemplazaProgramada: true, vigenteDesde: en(DIA) }),
    );
    expect(r.ok && r.valor.reemplazadas).toEqual([1]);
  });

  it("orden de los errores: retroactiva, desactualizada, programada pendiente", () => {
    const h = [decision(1, -DIA), decision(2, DIA)];
    const todoMal = pedido({ vigenteDesde: en(-DIA), numeroEsperado: 1 });
    expect(decidirCambio(h, todoMal)).toEqual({
      ok: false,
      error: { codigo: "VIGENCIA_RETROACTIVA" },
    });
    expect(decidirCambio(h, { ...todoMal, vigenteDesde: ahora })).toEqual({
      ok: false,
      error: { codigo: "VERSION_DESACTUALIZADA" },
    });
  });

  it("no modifica el historial", () => {
    const h = [decision(2, DIA), decision(1, -DIA)];
    const copia = structuredClone(h);
    decidirCambio(h, pedido({ numeroEsperado: 2, reemplazaProgramada: true }));
    expect(h).toEqual(copia);
  });
});

describe("motivoValido", () => {
  it("recorta y rechaza el vacío", () => {
    expect(motivoValido("  cambio de plan ")).toBe("cambio de plan");
    expect(motivoValido("")).toBeNull();
    expect(motivoValido(" \t\n ")).toBeNull();
  });
});
