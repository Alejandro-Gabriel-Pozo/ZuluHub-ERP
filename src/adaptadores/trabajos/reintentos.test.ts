import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import {
  POLITICA_POR_DEFECTO,
  decidirReintento,
  esperaDeReintentoEnMs,
  politicaDeReintentos,
  type PoliticaDeReintentos,
} from "./reintentos";

const MIN = 60_000;
const T0 = new Date("2026-10-11T12:00:00.000Z");
const POLITICA: PoliticaDeReintentos = {
  maximoDeIntentos: 5,
  esperaBaseEnMs: 1_000,
  esperaMaximaEnMs: 10_000,
  plazoDeTomaEnMs: 30_000,
};

describe("esperaDeReintentoEnMs", () => {
  it("crece al doble en cada intento y se frena en el tope", () => {
    const esperas = [1, 2, 3, 4, 5, 6, 7].map((n) => esperaDeReintentoEnMs(n, POLITICA));
    expect(esperas).toEqual([1_000, 2_000, 4_000, 8_000, 10_000, 10_000, 10_000]);
  });

  it("con la política por defecto: 1, 2, 4 y 8 minutos", () => {
    const esperas = [1, 2, 3, 4].map((n) => esperaDeReintentoEnMs(n, POLITICA_POR_DEFECTO));
    expect(esperas).toEqual([1 * MIN, 2 * MIN, 4 * MIN, 8 * MIN]);
  });

  it("un número enorme de intentos no desborda: queda en el tope", () => {
    expect(esperaDeReintentoEnMs(5_000, POLITICA)).toBe(10_000);
  });

  it("rechaza intentos que no son enteros mayores o iguales a 1", () => {
    for (const malo of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => esperaDeReintentoEnMs(malo, POLITICA)).toThrow(
        `intentos debe ser un entero mayor o igual a 1 (llegó ${malo})`,
      );
    }
  });

  it("es una función pura: mismos datos, misma espera, sin aleatoriedad", () => {
    const una = Array.from({ length: 200 }, () => esperaDeReintentoEnMs(3, POLITICA));
    expect(new Set(una)).toEqual(new Set([4_000]));
  });

  it("propiedad: nunca baja al reintentar más y nunca pasa del tope", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 0, max: 100_000_000 }),
        fc.integer({ min: 1, max: 5_000 }),
        (base, extra, intentos) => {
          const politica = { ...POLITICA, esperaBaseEnMs: base, esperaMaximaEnMs: base + extra };
          const actual = esperaDeReintentoEnMs(intentos, politica);
          const siguiente = esperaDeReintentoEnMs(intentos + 1, politica);
          expect(siguiente).toBeGreaterThanOrEqual(actual);
          expect(actual).toBeLessThanOrEqual(politica.esperaMaximaEnMs);
          expect(actual).toBeGreaterThanOrEqual(base);
        },
      ),
    );
  });
});

describe("decidirReintento", () => {
  it("reprograma desde `ahora` con la espera del intento", () => {
    expect(decidirReintento(1, T0, POLITICA)).toEqual({
      tipo: "REPROGRAMAR",
      proximoIntento: new Date(T0.getTime() + 1_000),
    });
    expect(decidirReintento(3, T0, POLITICA)).toEqual({
      tipo: "REPROGRAMAR",
      proximoIntento: new Date(T0.getTime() + 4_000),
    });
  });

  it("al llegar al tope de intentos queda FALLIDO; un intento antes todavía reprograma", () => {
    expect(decidirReintento(4, T0, POLITICA).tipo).toBe("REPROGRAMAR");
    expect(decidirReintento(5, T0, POLITICA)).toEqual({ tipo: "FALLIDO" });
    expect(decidirReintento(6, T0, POLITICA)).toEqual({ tipo: "FALLIDO" });
  });

  it("con un solo intento permitido, el primer fallo ya es definitivo", () => {
    expect(decidirReintento(1, T0, { ...POLITICA, maximoDeIntentos: 1 })).toEqual({
      tipo: "FALLIDO",
    });
  });

  it("rechaza intentos inválidos, también los que superan el tope", () => {
    // 7.5 e Infinity pasarían por "se acabaron los intentos" si no se validaran antes.
    for (const malo of [0, -3, 2.5, Number.NaN, 7.5, Number.POSITIVE_INFINITY]) {
      expect(() => decidirReintento(malo, T0, POLITICA)).toThrow(
        `intentos debe ser un entero mayor o igual a 1 (llegó ${malo})`,
      );
    }
  });

  it("no depende del reloj: el mismo `ahora` da siempre la misma decisión", () => {
    const decisiones = Array.from({ length: 100 }, () =>
      JSON.stringify(decidirReintento(2, T0, POLITICA)),
    );
    expect(new Set(decisiones).size).toBe(1);
  });

  it("propiedad: reprograma exactamente mientras queden intentos, siempre hacia el futuro", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 60 }),
        fc.integer({ min: 0, max: 4_000_000_000_000 }),
        (maximo, intentos, ms) => {
          const ahora = new Date(ms);
          const decision = decidirReintento(intentos, ahora, {
            ...POLITICA,
            maximoDeIntentos: maximo,
          });
          if (intentos >= maximo) {
            expect(decision).toEqual({ tipo: "FALLIDO" });
          } else {
            expect(decision.tipo).toBe("REPROGRAMAR");
            if (decision.tipo === "REPROGRAMAR") {
              expect(decision.proximoIntento.getTime()).toBeGreaterThan(ms);
            }
          }
        },
      ),
    );
  });
});

describe("politicaDeReintentos", () => {
  it("sin argumentos devuelve la de por defecto", () => {
    expect(politicaDeReintentos()).toEqual(POLITICA_POR_DEFECTO);
  });

  it("completa lo que falta", () => {
    expect(politicaDeReintentos({ maximoDeIntentos: 2 })).toEqual({
      ...POLITICA_POR_DEFECTO,
      maximoDeIntentos: 2,
    });
  });

  it.each([
    ["maximoDeIntentos", 0],
    ["maximoDeIntentos", 1.5],
    ["maximoDeIntentos", Number.NaN],
    ["esperaBaseEnMs", 0],
    ["esperaBaseEnMs", -1],
    ["esperaMaximaEnMs", 0],
    ["plazoDeTomaEnMs", 0],
    ["plazoDeTomaEnMs", Number.POSITIVE_INFINITY],
  ] as const)("rechaza %s = %s", (campo, valor) => {
    expect(() => politicaDeReintentos({ [campo]: valor })).toThrow(
      `${campo} debe ser un entero mayor o igual a 1 (llegó ${valor})`,
    );
  });

  it("el tope de la espera no puede ser menor que la espera base", () => {
    expect(() => politicaDeReintentos({ esperaBaseEnMs: 100, esperaMaximaEnMs: 99 })).toThrow(
      "esperaMaximaEnMs no puede ser menor que esperaBaseEnMs",
    );
    expect(() =>
      politicaDeReintentos({ esperaBaseEnMs: 100, esperaMaximaEnMs: 100 }),
    ).not.toThrow();
  });

  it("los valores por defecto son los documentados", () => {
    expect(POLITICA_POR_DEFECTO).toEqual({
      maximoDeIntentos: 5,
      esperaBaseEnMs: 60_000,
      esperaMaximaEnMs: 21_600_000,
      plazoDeTomaEnMs: 300_000,
    });
  });
});
