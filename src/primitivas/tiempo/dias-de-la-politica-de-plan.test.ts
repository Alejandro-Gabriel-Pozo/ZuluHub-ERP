import { describe, expect, it } from "vitest";
import {
  esDiasDeLaPoliticaDePlan,
  MAXIMO_DE_DIAS_DE_LA_POLITICA_DE_PLAN,
} from "./dias-de-la-politica-de-plan";

describe("días de la política de cambio de plan", () => {
  it("el tope es un año (365 días)", () => {
    expect(MAXIMO_DE_DIAS_DE_LA_POLITICA_DE_PLAN).toBe(365);
  });

  it("admite los enteros de 0 al tope, ambos extremos incluidos", () => {
    for (const dias of [0, 1, 3, 364, 365]) {
      expect(esDiasDeLaPoliticaDePlan(dias), String(dias)).toBe(true);
    }
  });

  it("rechaza lo que pasa del tope, lo negativo y lo no entero", () => {
    for (const dias of [366, -1, 0.5, 1.0000001, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(esDiasDeLaPoliticaDePlan(dias), String(dias)).toBe(false);
    }
  });

  it("lo que llegue sin tipar de afuera tampoco pasa", () => {
    const sinTipar: readonly unknown[] = ["1", "365", null, undefined, {}, true, [1]];
    for (const dias of sinTipar) {
      expect(esDiasDeLaPoliticaDePlan(dias as number), String(dias)).toBe(false);
    }
  });
});
