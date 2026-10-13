import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  LIMITES_DE_INACTIVIDAD,
  estadoDeInactividad,
  type LimitesDeInactividad,
} from "./inactividad";

const MINUTO = 60_000;
const ULTIMO_USO = new Date("2026-10-13T12:00:00.000Z");
const despues = (ms: number) => new Date(ULTIMO_USO.getTime() + ms);

describe("LIMITES_DE_INACTIVIDAD (decisión del dueño)", () => {
  it("vence a los 15 minutos y avisa a los 12", () => {
    expect(LIMITES_DE_INACTIVIDAD).toEqual({
      avisoEnMs: 12 * MINUTO,
      vencimientoEnMs: 15 * MINUTO,
    });
  });

  it("no se puede cambiar por accidente", () => {
    expect(Object.isFrozen(LIMITES_DE_INACTIVIDAD)).toBe(true);
  });
});

describe("estadoDeInactividad con los límites por defecto", () => {
  it.each([
    ["recién usada", 0, "VIGENTE"],
    ["a los 11 minutos", 11 * MINUTO, "VIGENTE"],
    ["un milisegundo antes del aviso", 12 * MINUTO - 1, "VIGENTE"],
    ["justo en el aviso", 12 * MINUTO, "POR_VENCER"],
    ["a los 14 minutos", 14 * MINUTO, "POR_VENCER"],
    ["un milisegundo antes del vencimiento", 15 * MINUTO - 1, "POR_VENCER"],
    ["justo en el vencimiento", 15 * MINUTO, "VENCIDA"],
    ["un milisegundo después del vencimiento", 15 * MINUTO + 1, "VENCIDA"],
    ["horas después", 5 * 60 * MINUTO, "VENCIDA"],
  ])("%s → %s", (_nombre, ms, esperado) => {
    expect(estadoDeInactividad(ULTIMO_USO, despues(ms))).toBe(esperado);
  });

  it("un último uso posterior a ahora (reloj atrasado) es inactividad cero", () => {
    expect(estadoDeInactividad(despues(10 * MINUTO), ULTIMO_USO)).toBe("VIGENTE");
  });

  it("falla cerrado: una fecha inválida cuenta como vencida", () => {
    const invalida = new Date("no es una fecha");
    expect(estadoDeInactividad(invalida, ULTIMO_USO)).toBe("VENCIDA");
    expect(estadoDeInactividad(ULTIMO_USO, invalida)).toBe("VENCIDA");
  });

  it("no modifica las fechas que recibe", () => {
    const antes = ULTIMO_USO.getTime();
    estadoDeInactividad(ULTIMO_USO, despues(20 * MINUTO));
    expect(ULTIMO_USO.getTime()).toBe(antes);
  });
});

describe("estadoDeInactividad con límites propios", () => {
  const limites: LimitesDeInactividad = { avisoEnMs: 1_000, vencimientoEnMs: 5_000 };

  it.each([
    [999, "VIGENTE"],
    [1_000, "POR_VENCER"],
    [4_999, "POR_VENCER"],
    [5_000, "VENCIDA"],
  ])("a los %i ms → %s", (ms, esperado) => {
    expect(estadoDeInactividad(ULTIMO_USO, despues(ms), limites)).toBe(esperado);
  });

  it.each([
    ["el aviso igual al vencimiento", { avisoEnMs: 5_000, vencimientoEnMs: 5_000 }],
    ["el aviso mayor que el vencimiento", { avisoEnMs: 6_000, vencimientoEnMs: 5_000 }],
    ["el aviso en cero", { avisoEnMs: 0, vencimientoEnMs: 5_000 }],
    ["el aviso negativo", { avisoEnMs: -1, vencimientoEnMs: 5_000 }],
    ["el aviso no finito", { avisoEnMs: Number.NaN, vencimientoEnMs: 5_000 }],
    ["el vencimiento infinito", { avisoEnMs: 1_000, vencimientoEnMs: Number.POSITIVE_INFINITY }],
    ["el vencimiento NaN", { avisoEnMs: 1_000, vencimientoEnMs: Number.NaN }],
  ])("rechaza límites incoherentes: %s", (_nombre, malos) => {
    expect(() => estadoDeInactividad(ULTIMO_USO, ULTIMO_USO, malos)).toThrow(RangeError);
    expect(() => estadoDeInactividad(ULTIMO_USO, ULTIMO_USO, malos)).toThrow(
      "límites de inactividad inválidos",
    );
  });

  it("con límites coherentes pero mínimos funciona (aviso de 1 ms)", () => {
    const minimos = { avisoEnMs: 1, vencimientoEnMs: 2 };
    expect(estadoDeInactividad(ULTIMO_USO, despues(0), minimos)).toBe("VIGENTE");
    expect(estadoDeInactividad(ULTIMO_USO, despues(1), minimos)).toBe("POR_VENCER");
    expect(estadoDeInactividad(ULTIMO_USO, despues(2), minimos)).toBe("VENCIDA");
  });
});

describe("estadoDeInactividad: propiedades", () => {
  it("el estado solo empeora con el tiempo (VIGENTE → POR_VENCER → VENCIDA)", () => {
    const orden = { VIGENTE: 0, POR_VENCER: 1, VENCIDA: 2 } as const;
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 60 * MINUTO }),
        fc.integer({ min: 0, max: 60 * MINUTO }),
        (a, b) => {
          const [antes, despuesDe] = a <= b ? [a, b] : [b, a];
          expect(orden[estadoDeInactividad(ULTIMO_USO, despues(despuesDe))]).toBeGreaterThanOrEqual(
            orden[estadoDeInactividad(ULTIMO_USO, despues(antes))],
          );
        },
      ),
    );
  });
});
