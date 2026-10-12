import { describe, expect, it } from "vitest";
import {
  TOLERANCIA_DE_RELOJ_EN_MS,
  estadosDeVigencia,
  hayProgramadaPendiente,
  versionVigente,
  type EstadoDeVigencia,
} from "./vigencia";

const AHORA = new Date("2026-10-12T12:00:00.000Z");
const dia = (n: number) => new Date(AHORA.getTime() + n * 86_400_000);
const v = (numero: number, desde: Date) => ({ numero, vigenteDesde: desde });
const estados = (versiones: ReturnType<typeof v>[]): EstadoDeVigencia[] =>
  estadosDeVigencia(versiones, AHORA).map((x) => x.estado);

describe("TOLERANCIA_DE_RELOJ_EN_MS", () => {
  it("es de un minuto, como en la base", () => {
    expect(TOLERANCIA_DE_RELOJ_EN_MS).toBe(60_000);
  });
});

describe("versionVigente", () => {
  it("sin versiones, o con ninguna empezada, no hay vigente", () => {
    expect(versionVigente([], AHORA)).toBeNull();
    expect(versionVigente([v(1, dia(1))], AHORA)).toBeNull();
  });

  it("rige la de mayor número entre las que ya empezaron, no la de fecha más reciente", () => {
    const versiones = [v(1, dia(-1)), v(2, dia(-10)), v(3, dia(5))];
    expect(versionVigente(versiones, AHORA)).toBe(versiones[1]);
  });

  it("no importa el orden en que vienen", () => {
    const a = v(1, dia(-3));
    const b = v(2, dia(-2));
    const c = v(3, dia(-1));
    expect(versionVigente([a, b, c], AHORA)).toBe(c);
    expect(versionVigente([c, a, b], AHORA)).toBe(c);
    expect(versionVigente([b, c, a], AHORA)).toBe(c);
  });

  it("ante dos con el mismo número (la base no lo admite) queda la primera que vino", () => {
    const primera = { numero: 2, vigenteDesde: dia(-2), id: "primera" };
    const segunda = { numero: 2, vigenteDesde: dia(-1), id: "segunda" };
    expect(versionVigente([primera, segunda], AHORA)).toBe(primera);
    expect(versionVigente([segunda, primera], AHORA)).toBe(segunda);
  });

  it("la que empieza justo ahora ya rige; un milisegundo después, todavía no", () => {
    const justo = v(1, AHORA);
    const despues = v(2, new Date(AHORA.getTime() + 1));
    expect(versionVigente([justo, despues], AHORA)).toBe(justo);
    expect(versionVigente([despues], AHORA)).toBeNull();
  });
});

describe("estadosDeVigencia", () => {
  it("sin versiones, nada", () => {
    expect(estadosDeVigencia([], AHORA)).toEqual([]);
  });

  it("una sola ya empezada es la vigente", () => {
    expect(estados([v(1, dia(-1))])).toEqual(["VIGENTE"]);
  });

  it("las empezadas anteriores a la vigente son ANTERIOR", () => {
    expect(estados([v(1, dia(-30)), v(2, dia(-10)), v(3, dia(-1))])).toEqual([
      "ANTERIOR",
      "ANTERIOR",
      "VIGENTE",
    ]);
  });

  it("una futura es PROGRAMADA y la vigente sigue rigiendo hasta que empiece", () => {
    expect(estados([v(1, dia(-1)), v(2, dia(7))])).toEqual(["VIGENTE", "PROGRAMADA"]);
  });

  it("varias programadas en orden de fecha: todas van a regir, una después de la otra", () => {
    expect(estados([v(1, dia(-1)), v(2, dia(7)), v(3, dia(14))])).toEqual([
      "VIGENTE",
      "PROGRAMADA",
      "PROGRAMADA",
    ]);
  });

  it("una decisión nueva deja sin efecto a la programada anterior si empieza antes que ella", () => {
    expect(estados([v(1, dia(-1)), v(2, dia(14)), v(3, dia(7))])).toEqual([
      "VIGENTE",
      "SIN_EFECTO",
      "PROGRAMADA",
    ]);
  });

  it("también si empieza a la vez (el número mayor manda)", () => {
    expect(estados([v(1, dia(-1)), v(2, dia(7)), v(3, dia(7))])).toEqual([
      "VIGENTE",
      "SIN_EFECTO",
      "PROGRAMADA",
    ]);
  });

  it("una nueva que ya rige deja sin efecto a las programadas anteriores cuando empieza", () => {
    expect(estados([v(1, dia(-5)), v(2, dia(3)), v(3, dia(-1))])).toEqual([
      "ANTERIOR",
      "SIN_EFECTO",
      "VIGENTE",
    ]);
  });

  it("una empezada que nunca rigió (otra de número mayor empezó antes) es SIN_EFECTO, no ANTERIOR", () => {
    expect(estados([v(1, dia(-1)), v(2, dia(-5))])).toEqual(["SIN_EFECTO", "VIGENTE"]);
  });

  it("una versión que empieza justo ahora es la vigente", () => {
    expect(estados([v(1, dia(-1)), v(2, AHORA)])).toEqual(["ANTERIOR", "VIGENTE"]);
  });

  it("la que empieza un milisegundo después es PROGRAMADA", () => {
    expect(estados([v(1, dia(-1)), v(2, new Date(AHORA.getTime() + 1))])).toEqual([
      "VIGENTE",
      "PROGRAMADA",
    ]);
  });

  it("sin ninguna empezada, todas las no pisadas son PROGRAMADA", () => {
    expect(estados([v(1, dia(3)), v(2, dia(5))])).toEqual(["PROGRAMADA", "PROGRAMADA"]);
  });

  it("conserva el orden de entrada, sus campos y el mismo contenido", () => {
    const entrada = [
      { numero: 2, vigenteDesde: dia(-1), id: "b" },
      { numero: 1, vigenteDesde: dia(-9), id: "a" },
    ];
    const salida = estadosDeVigencia(entrada, AHORA);
    expect(salida.map((x) => x.id)).toEqual(["b", "a"]);
    expect(salida.map((x) => x.estado)).toEqual(["VIGENTE", "ANTERIOR"]);
    expect(salida[0]?.vigenteDesde).toBe(entrada[0]?.vigenteDesde);
    expect(entrada[0]).not.toHaveProperty("estado");
  });
});

describe("hayProgramadaPendiente", () => {
  it("es verdad solo si alguna va a regir en el futuro", () => {
    expect(hayProgramadaPendiente([], AHORA)).toBe(false);
    expect(hayProgramadaPendiente([v(1, dia(-1))], AHORA)).toBe(false);
    expect(hayProgramadaPendiente([v(1, dia(-1)), v(2, dia(3))], AHORA)).toBe(true);
    expect(hayProgramadaPendiente([v(1, dia(3))], AHORA)).toBe(true);
  });

  it("una futura sin efecto no cuenta", () => {
    expect(hayProgramadaPendiente([v(1, dia(-1)), v(2, dia(3)), v(3, dia(-2))], AHORA)).toBe(false);
  });
});
