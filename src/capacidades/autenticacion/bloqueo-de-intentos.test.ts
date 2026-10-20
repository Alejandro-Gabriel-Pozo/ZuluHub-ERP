import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  POLITICA_DE_INTENTOS,
  decisionDeBloqueo,
  retencionDeFallosEnMs,
  type PoliticaDeIntentos,
} from "./bloqueo-de-intentos";

const SEGUNDO = 1000;
const MINUTO = 60 * SEGUNDO;
const T0 = new Date("2026-10-20T12:00:00.000Z");
const en = (ms: number) => new Date(T0.getTime() + ms);
const fallosCada = (cada: number, n: number) => Array.from({ length: n }, (_, i) => en(i * cada));

describe("POLITICA_DE_INTENTOS (ASUMIDO en h5-p8 §2.4)", () => {
  it("5 fallidos en 10 minutos bloquean 15 minutos, y no se puede cambiar por accidente", () => {
    expect(POLITICA_DE_INTENTOS).toEqual({
      maximo: 5,
      ventanaEnMs: 10 * MINUTO,
      bloqueoEnMs: 15 * MINUTO,
    });
    expect(Object.isFrozen(POLITICA_DE_INTENTOS)).toBe(true);
  });

  it("se recuerda un fallo mientras pueda formar parte de un bloqueo vigente: la ventana más lo que dura", () => {
    expect(retencionDeFallosEnMs()).toBe(25 * MINUTO);
    expect(retencionDeFallosEnMs({ maximo: 3, ventanaEnMs: 1000, bloqueoEnMs: 20 })).toBe(1020);
  });
});

describe("decisionDeBloqueo", () => {
  it("sin fallos, o con menos de cinco, no hay bloqueo", () => {
    expect(decisionDeBloqueo([], T0)).toEqual({ bloqueado: false });
    expect(decisionDeBloqueo(fallosCada(SEGUNDO, 4), en(5 * SEGUNDO))).toEqual({
      bloqueado: false,
    });
  });

  it("el quinto fallo dentro de la ventana bloquea hasta 15 minutos después de ese quinto", () => {
    const fallos = fallosCada(SEGUNDO, 5);
    const ultimo = en(4 * SEGUNDO);
    expect(decisionDeBloqueo(fallos, ultimo)).toEqual({
      bloqueado: true,
      hasta: en(4 * SEGUNDO + 15 * MINUTO),
    });
    // Un instante antes de terminar sigue bloqueado; en el instante exacto, ya no.
    expect(decisionDeBloqueo(fallos, en(4 * SEGUNDO + 15 * MINUTO - 1)).bloqueado).toBe(true);
    expect(decisionDeBloqueo(fallos, en(4 * SEGUNDO + 15 * MINUTO))).toEqual({ bloqueado: false });
  });

  it("cinco fallos que caben justo en 10 minutos bloquean; si el primero y el quinto se llevan 10 minutos y un milisegundo, no", () => {
    const justo = [0, 1, 2, 3, 10 * MINUTO].map(en);
    expect(decisionDeBloqueo(justo, en(10 * MINUTO)).bloqueado).toBe(true);
    const pasado = [0, 1, 2, 3, 10 * MINUTO + 1].map(en);
    expect(decisionDeBloqueo(pasado, en(10 * MINUTO + 1))).toEqual({ bloqueado: false });
  });

  it("fallos espaciados (uno cada 3 minutos) nunca bloquean aunque sean muchos", () => {
    expect(decisionDeBloqueo(fallosCada(3 * MINUTO, 20), en(60 * MINUTO))).toEqual({
      bloqueado: false,
    });
  });

  it("el orden en que llegan los instantes no importa", () => {
    const fallos = [en(4 * SEGUNDO), en(0), en(3 * SEGUNDO), en(SEGUNDO), en(2 * SEGUNDO)];
    expect(decisionDeBloqueo(fallos, en(5 * SEGUNDO))).toEqual({
      bloqueado: true,
      hasta: en(4 * SEGUNDO + 15 * MINUTO),
    });
  });

  it("con varios grupos, manda el que termina más tarde", () => {
    const grupoViejo = fallosCada(SEGUNDO, 5);
    const grupoNuevo = fallosCada(SEGUNDO, 5).map((f) => new Date(f.getTime() + 20 * MINUTO));
    const todos = [...grupoViejo, ...grupoNuevo];
    expect(decisionDeBloqueo(todos, en(20 * MINUTO + 5 * SEGUNDO))).toEqual({
      bloqueado: true,
      hasta: en(20 * MINUTO + 4 * SEGUNDO + 15 * MINUTO),
    });
    // El grupo viejo ya terminó: sin el nuevo no hay bloqueo.
    expect(decisionDeBloqueo(grupoViejo, en(20 * MINUTO))).toEqual({ bloqueado: false });
  });

  it("después del bloqueo, fallos nuevos aislados no lo reviven con los viejos", () => {
    const viejos = fallosCada(SEGUNDO, 5);
    const nuevo = en(16 * MINUTO);
    expect(decisionDeBloqueo([...viejos, nuevo], nuevo)).toEqual({ bloqueado: false });
  });

  it("más de cinco fallos juntos: el bloqueo cuenta desde el último grupo de cinco", () => {
    const fallos = fallosCada(SEGUNDO, 8);
    expect(decisionDeBloqueo(fallos, en(8 * SEGUNDO))).toEqual({
      bloqueado: true,
      hasta: en(7 * SEGUNDO + 15 * MINUTO),
    });
  });

  it("un instante inválido cuenta como ahora (no se puede esconder un fallo con una fecha rota)", () => {
    const rotos = [new Date("x"), new Date("y"), new Date("z"), new Date("w"), new Date("v")];
    expect(decisionDeBloqueo(rotos, T0)).toEqual({ bloqueado: true, hasta: en(15 * MINUTO) });
    const cuatroRotosYUno = [...rotos.slice(0, 4), T0];
    expect(decisionDeBloqueo(cuatroRotosYUno, T0).bloqueado).toBe(true);
  });

  it("un reloj inválido es un error de programación", () => {
    expect(() => decisionDeBloqueo([], new Date("x"))).toThrow(RangeError);
    expect(() => decisionDeBloqueo([], new Date("x"))).toThrow("ahora debe ser una fecha válida");
  });

  it("una política propia: con máximo 1, un solo fallo bloquea", () => {
    const una: PoliticaDeIntentos = { maximo: 1, ventanaEnMs: 1, bloqueoEnMs: 100 };
    expect(decisionDeBloqueo([T0], en(50), una)).toEqual({ bloqueado: true, hasta: en(100) });
    expect(decisionDeBloqueo([], en(50), una)).toEqual({ bloqueado: false });
  });

  it.each([
    ["máximo cero", { maximo: 0, ventanaEnMs: 1, bloqueoEnMs: 1 }],
    ["máximo no entero", { maximo: 1.5, ventanaEnMs: 1, bloqueoEnMs: 1 }],
    ["ventana cero", { maximo: 5, ventanaEnMs: 0, bloqueoEnMs: 1 }],
    ["ventana infinita", { maximo: 5, ventanaEnMs: Infinity, bloqueoEnMs: 1 }],
    ["ventana NaN", { maximo: 5, ventanaEnMs: NaN, bloqueoEnMs: 1 }],
    ["bloqueo cero", { maximo: 5, ventanaEnMs: 1, bloqueoEnMs: 0 }],
    ["bloqueo infinito", { maximo: 5, ventanaEnMs: 1, bloqueoEnMs: Infinity }],
    ["bloqueo NaN", { maximo: 5, ventanaEnMs: 1, bloqueoEnMs: NaN }],
  ])("una política incoherente (%s) lanza", (_c, politica) => {
    expect(() => decisionDeBloqueo([], T0, politica)).toThrow(RangeError);
    expect(() => decisionDeBloqueo([], T0, politica)).toThrow(
      "política de intentos inválida: el máximo y los plazos son positivos",
    );
  });

  it("propiedad: bloqueado si y solo si algún grupo de cinco consecutivos cabe en la ventana y no terminó el plazo", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 40 * MINUTO }), { maxLength: 14 }),
        fc.integer({ min: 0, max: 80 * MINUTO }),
        (instantes, desde) => {
          const ahora = en(desde);
          const ordenados = [...instantes].sort((a, b) => a - b);
          let esperado = Number.NEGATIVE_INFINITY;
          for (let i = 4; i < ordenados.length; i++) {
            if ((ordenados[i] as number) - (ordenados[i - 4] as number) <= 10 * MINUTO) {
              esperado = Math.max(esperado, (ordenados[i] as number) + 15 * MINUTO);
            }
          }
          const d = decisionDeBloqueo(instantes.map(en), ahora);
          expect(d.bloqueado).toBe(desde < esperado);
          if (d.bloqueado) expect(d.hasta).toEqual(en(esperado));
        },
      ),
    );
  });
});
