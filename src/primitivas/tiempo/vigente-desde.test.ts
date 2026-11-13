import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { hoyEnArgentina } from "./fecha-civil-hasta-hoy";
import { FECHA_CIVIL_MAXIMA, vigenteDesdeDesdeTexto } from "./vigente-desde";

// 2026-11-13 10:00 en Argentina (13:00Z).
const AHORA = new Date("2026-11-13T13:00:00Z");

describe("vigente desde (hoy o futuro, nunca pasado)", () => {
  it("sin fecha rige desde ahora", () => {
    expect(vigenteDesdeDesdeTexto(null, AHORA)).toEqual({ ok: true, valor: AHORA });
  });

  it("con la fecha de hoy en Argentina rige desde ahora (no desde la medianoche, que ya pasó)", () => {
    expect(vigenteDesdeDesdeTexto("2026-11-13", AHORA)).toEqual({ ok: true, valor: AHORA });
  });

  it("el cambio de día de Argentina frente a UTC: a las 01:00 UTC todavía es el día anterior allá", () => {
    const tarde = new Date("2026-11-14T01:00:00Z"); // 22:00 del 13/11 en Argentina
    expect(vigenteDesdeDesdeTexto("2026-11-13", tarde)).toEqual({ ok: true, valor: tarde });
    expect(vigenteDesdeDesdeTexto("2026-11-14", tarde)).toEqual({
      ok: true,
      valor: new Date("2026-11-14T03:00:00Z"),
    });
    expect(vigenteDesdeDesdeTexto("2026-11-12", tarde)).toEqual({
      ok: false,
      error: "FECHA_PASADA",
    });
  });

  it("una fecha futura rige desde la medianoche de Argentina de ese día", () => {
    expect(vigenteDesdeDesdeTexto("2026-11-14", AHORA)).toEqual({
      ok: true,
      valor: new Date("2026-11-14T03:00:00Z"),
    });
    expect(vigenteDesdeDesdeTexto("2027-01-01", AHORA)).toEqual({
      ok: true,
      valor: new Date("2027-01-01T03:00:00Z"),
    });
  });

  it("una fecha pasada se rechaza, también la de ayer", () => {
    expect(vigenteDesdeDesdeTexto("2026-11-12", AHORA)).toEqual({
      ok: false,
      error: "FECHA_PASADA",
    });
    expect(vigenteDesdeDesdeTexto("2020-01-01", AHORA)).toEqual({
      ok: false,
      error: "FECHA_PASADA",
    });
  });

  it("el techo: justo el último día pasa, el siguiente no", () => {
    expect(vigenteDesdeDesdeTexto(FECHA_CIVIL_MAXIMA, AHORA)).toEqual({
      ok: true,
      valor: new Date("2100-12-31T03:00:00Z"),
    });
    expect(vigenteDesdeDesdeTexto("2101-01-01", AHORA)).toEqual({
      ok: false,
      error: "FECHA_FUERA_DE_RANGO",
    });
  });

  it("lo que no es una fecha real se rechaza, sin normalizar", () => {
    for (const t of [
      "",
      "2026-13-01",
      "2026-02-30",
      "13/11/2026",
      "2026-11-14 ",
      "2026-1-4",
      "mañana",
    ]) {
      expect(vigenteDesdeDesdeTexto(t, AHORA), t).toEqual({
        ok: false,
        error: "FECHA_CIVIL_INVALIDA",
      });
    }
  });

  it("un reloj inválido no se interpreta", () => {
    expect(vigenteDesdeDesdeTexto(null, new Date(Number.NaN))).toEqual({
      ok: false,
      error: "RELOJ_INVALIDO",
    });
    expect(vigenteDesdeDesdeTexto("2026-11-14", new Date(Number.NaN))).toEqual({
      ok: false,
      error: "RELOJ_INVALIDO",
    });
  });

  it("propiedad: el instante de una fecha futura es el primero de ese día en Argentina", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 3000 }), (dias) => {
        const fecha = new Date(Date.UTC(2026, 10, 13 + dias)).toISOString().slice(0, 10);
        const r = vigenteDesdeDesdeTexto(fecha, AHORA);
        if (fecha > FECHA_CIVIL_MAXIMA) return;
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(hoyEnArgentina(r.valor)).toEqual({ ok: true, valor: fecha });
        expect(hoyEnArgentina(new Date(r.valor.getTime() - 1))).not.toEqual({
          ok: true,
          valor: fecha,
        });
      }),
      { numRuns: 200 },
    );
  });
});
