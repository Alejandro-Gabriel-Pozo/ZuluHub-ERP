import { describe, expect, it } from "vitest";
import { instanteIsoEnArgentina } from "./instante-en-argentina";

describe("instanteIsoEnArgentina", () => {
  it("resta tres horas y rotula el desfase", () => {
    expect(instanteIsoEnArgentina(new Date("2026-11-25T21:14:05.999Z"))).toBe(
      "2026-11-25T18:14:05-03:00",
    );
  });
  it("cruza el día hacia atrás: a las 01:00 UTC todavía es el día anterior en Argentina", () => {
    expect(instanteIsoEnArgentina(new Date("2026-01-01T01:00:00Z"))).toBe(
      "2025-12-31T22:00:00-03:00",
    );
  });
  it("una fecha inválida se rechaza (no se escribe un instante inventado)", () => {
    expect(() => instanteIsoEnArgentina(new Date("no es una fecha"))).toThrow(RangeError);
  });
});
