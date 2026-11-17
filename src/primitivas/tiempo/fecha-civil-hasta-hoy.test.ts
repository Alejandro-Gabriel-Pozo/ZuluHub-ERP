import { describe, expect, it } from "vitest";
import {
  FECHA_CIVIL_MINIMA,
  ZONA_DE_ARGENTINA,
  fechaCivilHastaHoyDesdeTexto,
  hoyEnArgentina,
} from "./fecha-civil-hasta-hoy";

// 2026-11-06 12:00 en Argentina (UTC-3).
const AHORA = new Date("2026-11-06T15:00:00Z");

describe("hoy en Argentina", () => {
  it("usa la zona de Argentina y no UTC", () => {
    expect(ZONA_DE_ARGENTINA).toBe("America/Argentina/Buenos_Aires");
    // 22:30 del 6/11 en Buenos Aires ya es 7/11 en UTC: sigue siendo el 6.
    expect(hoyEnArgentina(new Date("2026-11-07T01:30:00Z"))).toEqual({
      ok: true,
      valor: "2026-11-06",
    });
    // 00:30 del 7/11 en Buenos Aires: ya es el 7.
    expect(hoyEnArgentina(new Date("2026-11-07T03:30:00Z"))).toEqual({
      ok: true,
      valor: "2026-11-07",
    });
    expect(hoyEnArgentina(new Date("2026-11-07T02:59:59Z"))).toEqual({
      ok: true,
      valor: "2026-11-06",
    });
  });

  it("un instante inválido no tiene «hoy»", () => {
    expect(hoyEnArgentina(new Date("no es una fecha")).ok).toBe(false);
  });
});

describe("fecha civil entre 1900 y hoy", () => {
  it("el piso es 1900-01-01", () => {
    expect(FECHA_CIVIL_MINIMA).toBe("1900-01-01");
  });

  it.each(["1900-01-01", "1900-12-31", "1999-12-31", "2015-03-01", "2026-11-05", "2026-11-06"])(
    "%s entra",
    (f) => {
      expect(fechaCivilHastaHoyDesdeTexto(f, AHORA)).toEqual({ ok: true, valor: f });
    },
  );

  it.each(["1899-12-31", "0001-01-01", "1800-06-15", "2026-11-07", "2027-03-01", "9999-12-31"])(
    "%s se rechaza por rango",
    (f) => {
      expect(fechaCivilHastaHoyDesdeTexto(f, AHORA)).toEqual({
        ok: false,
        error: "FECHA_FUERA_DE_RANGO",
      });
    },
  );

  it.each([
    "2023-02-29",
    "2023-13-01",
    "2026-1-01",
    "2026-11-06T00:00:00Z",
    " 2026-11-06",
    "",
    "abc",
  ])("%j no es una fecha civil", (f) => {
    expect(fechaCivilHastaHoyDesdeTexto(f, AHORA)).toEqual({
      ok: false,
      error: "FECHA_CIVIL_INVALIDA",
    });
  });

  it("el techo es el día de Argentina: a las 22:30 de Buenos Aires el 6/11 sigue valiendo y el 7/11 no", () => {
    const nocheEnBuenosAires = new Date("2026-11-07T01:30:00Z");
    expect(fechaCivilHastaHoyDesdeTexto("2026-11-06", nocheEnBuenosAires).ok).toBe(true);
    expect(fechaCivilHastaHoyDesdeTexto("2026-11-07", nocheEnBuenosAires).ok).toBe(false);
    const pasadaLaMedianoche = new Date("2026-11-07T03:00:00Z");
    expect(fechaCivilHastaHoyDesdeTexto("2026-11-07", pasadaLaMedianoche).ok).toBe(true);
  });

  it("sin «hoy» calculable (instante inválido) cierra: no acepta ni una fecha pasada", () => {
    expect(fechaCivilHastaHoyDesdeTexto("2015-03-01", new Date(Number.NaN))).toEqual({
      ok: false,
      error: "FECHA_FUERA_DE_RANGO",
    });
  });
});
