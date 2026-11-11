import { describe, expect, it } from "vitest";
import {
  CALIDADES_DE_LOTE,
  calidadHabilita,
  decidirCambioDeCalidad,
  esCalidadDeLote,
} from "./calidad";

describe("calidad del lote", () => {
  it("conoce los cuatro estados y nada más", () => {
    expect(CALIDADES_DE_LOTE).toEqual(["EN_CUARENTENA", "EN_REVISION", "LIBERADO", "RECHAZADO"]);
    expect(esCalidadDeLote("LIBERADO")).toBe(true);
    expect(esCalidadDeLote("liberado")).toBe(false);
    expect(esCalidadDeLote("")).toBe(false);
  });
  it("solo habilita sin calidad o liberado", () => {
    expect(calidadHabilita(null)).toBe(true);
    expect(calidadHabilita("LIBERADO")).toBe(true);
    for (const e of ["EN_CUARENTENA", "EN_REVISION", "RECHAZADO"] as const) {
      expect(calidadHabilita(e)).toBe(false);
    }
  });
  it("cualquier estado pasa a cualquier otro con motivo; el mismo estado ya estaba", () => {
    for (const desde of [null, ...CALIDADES_DE_LOTE]) {
      for (const hacia of CALIDADES_DE_LOTE) {
        expect(decidirCambioDeCalidad(desde, hacia, "revisión de la tanda")).toEqual({
          ok: true,
          valor: desde === hacia ? "YA_ESTABA" : "CAMBIA",
        });
      }
    }
  });
  it("sin motivo no cambia nada, ni siquiera el mismo estado", () => {
    expect(decidirCambioDeCalidad("LIBERADO", "RECHAZADO", "")).toEqual({
      ok: false,
      error: "MOTIVO_REQUERIDO",
    });
    expect(decidirCambioDeCalidad("LIBERADO", "LIBERADO", "   ")).toEqual({
      ok: false,
      error: "MOTIVO_REQUERIDO",
    });
  });
});
