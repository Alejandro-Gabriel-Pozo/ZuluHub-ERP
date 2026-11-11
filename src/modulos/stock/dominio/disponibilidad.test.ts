import { describe, expect, it } from "vitest";
import { diasHastaElVencimiento, esDisponible, esFechaCivil, estaVencido } from "./disponibilidad";

describe("disponibilidad de un lote (S-3, D27, D118)", () => {
  const hoy = "2026-11-10";
  it("un lote liberado o sin calidad, que vence hoy o después, está disponible", () => {
    expect(esDisponible({ calidad: null, vence: null }, hoy)).toBe(true);
    expect(esDisponible({ calidad: "LIBERADO", vence: hoy }, hoy)).toBe(true);
    expect(esDisponible({ calidad: null, vence: "2026-11-11" }, hoy)).toBe(true);
  });
  it("vencido ayer no está disponible; vence hoy sí (vale hasta el final del día)", () => {
    expect(estaVencido("2026-11-09", hoy)).toBe(true);
    expect(estaVencido(hoy, hoy)).toBe(false);
    expect(estaVencido(null, hoy)).toBe(false);
    expect(esDisponible({ calidad: null, vence: "2026-11-09" }, hoy)).toBe(false);
  });
  it("en cuarentena, en revisión o rechazado no está disponible aunque no venza", () => {
    for (const calidad of ["EN_CUARENTENA", "EN_REVISION", "RECHAZADO"] as const) {
      expect(esDisponible({ calidad, vence: null }, hoy)).toBe(false);
    }
  });
  it("las fechas civiles tienen forma AAAA-MM-DD", () => {
    expect(esFechaCivil("2026-11-10")).toBe(true);
    expect(esFechaCivil("2026-1-10")).toBe(false);
    expect(esFechaCivil("2026-11-10T00:00")).toBe(false);
    expect(esFechaCivil("")).toBe(false);
    expect(esFechaCivil("x2026-11-10")).toBe(false);
  });
  it("cuenta jornadas, también al cruzar mes y año", () => {
    expect(diasHastaElVencimiento("2026-11-10", "2026-11-10")).toBe(0);
    expect(diasHastaElVencimiento("2026-11-13", "2026-11-10")).toBe(3);
    expect(diasHastaElVencimiento("2027-01-01", "2026-12-31")).toBe(1);
    expect(diasHastaElVencimiento("2026-11-09", "2026-11-10")).toBe(-1);
    expect(diasHastaElVencimiento("2024-03-01", "2024-02-28")).toBe(2);
  });
});
