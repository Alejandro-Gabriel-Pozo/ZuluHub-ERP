import { describe, expect, it } from "vitest";
import { terceroQueFalta, tipoAdmitido } from "./exigencia-de-tercero";
import type { TerceroIdentificado } from "./tercero-identificado";

const nombre: TerceroIdentificado = { tipo: "NOMBRE", nombre: "Juan Pérez" };
const empleado: TerceroIdentificado = {
  tipo: "EMPLEADO",
  personaId: "0b6e1c1a-2f6c-4f5a-9d41-5b1d6c7a8e90",
};

describe("terceroQueFalta", () => {
  it("se exige y no hay nadie: falta", () => {
    expect(terceroQueFalta("SE_EXIGE", null)).toEqual({ ok: false, error: "TERCERO_REQUERIDO" });
  });
  it("se exige y hay alguien: no falta", () => {
    expect(terceroQueFalta("SE_EXIGE", nombre)).toEqual({ ok: true, valor: null });
  });
  it("no se exige y no hay nadie: no falta", () => {
    expect(terceroQueFalta("NO_SE_EXIGE", null)).toEqual({ ok: true, valor: null });
  });
  it("no se exige y hay alguien: no falta", () => {
    expect(terceroQueFalta("NO_SE_EXIGE", empleado)).toEqual({ ok: true, valor: null });
  });
});

describe("tipoAdmitido", () => {
  it("la entrada no admite empleado", () => {
    expect(tipoAdmitido("ENTRADA", empleado)).toBe(false);
  });
  it("la entrada admite nombre", () => {
    expect(tipoAdmitido("ENTRADA", nombre)).toBe(true);
  });
  it("la salida admite nombre y empleado", () => {
    expect(tipoAdmitido("SALIDA", nombre)).toBe(true);
    expect(tipoAdmitido("SALIDA", empleado)).toBe(true);
  });
});
