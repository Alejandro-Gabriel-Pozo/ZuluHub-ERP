import { describe, expect, it } from "vitest";
import {
  armarResumen,
  etiquetaDeVersion,
  FECHA_MAXIMA_DE_VIGENCIA,
  LEYENDA_DE_PROGRAMADA,
  textoDelError,
  validarCambio,
} from "../../apps/plataforma/logica/cambio-de-plan";

const base = {
  vigenteDesde: "2026-11-01",
  motivo: "Pasa al plan Pro",
  hayProgramada: false,
  reemplaza: false,
  fechaMinima: "2026-10-29",
};

describe("validarCambio", () => {
  it("sin faltas con datos buenos", () => {
    expect(validarCambio(base)).toEqual({});
  });
  it("fecha vacía, anterior a la mínima y posterior al máximo", () => {
    expect(validarCambio({ ...base, vigenteDesde: "" }).vigenteDesde).toBe(
      "Elegí desde qué fecha rige.",
    );
    expect(validarCambio({ ...base, vigenteDesde: "2026-10-28" }).vigenteDesde).toContain(
      "desde mañana",
    );
    expect(validarCambio({ ...base, vigenteDesde: FECHA_MAXIMA_DE_VIGENCIA })).toEqual({});
    expect(validarCambio({ ...base, vigenteDesde: "2101-01-01" }).vigenteDesde).toContain(
      "no puede pasar",
    );
  });
  it("motivo vacío, de espacios y más largo que 500", () => {
    expect(validarCambio({ ...base, motivo: "   " }).motivo).toBe("Escribí el motivo del cambio.");
    expect(validarCambio({ ...base, motivo: "a".repeat(500) })).toEqual({});
    expect(validarCambio({ ...base, motivo: `  ${"a".repeat(500)}  ` })).toEqual({});
    expect(validarCambio({ ...base, motivo: "a".repeat(501) }).motivo).toContain("500");
  });
  it("con cambio programado exige la casilla", () => {
    expect(validarCambio({ ...base, hayProgramada: true }).reemplaza).toBeDefined();
    expect(validarCambio({ ...base, hayProgramada: true, reemplaza: true })).toEqual({});
  });
});

describe("textos", () => {
  it("rotula nombre y versión", () => {
    expect(etiquetaDeVersion({ nombre: "Pro", versionNumero: 2, esActual: false })).toBe(
      "Pro (versión 2)",
    );
    expect(etiquetaDeVersion({ nombre: "Pro", versionNumero: 2, esActual: true })).toBe(
      "Pro (versión 2, actual)",
    );
  });
  it("el resumen nombra plan y fecha, o lo que falta", () => {
    expect(armarResumen({ nombre: "Pro", versionNumero: 2 }, "2026-11-01")).toBe(
      "Se cambia a Pro (versión 2), vigente desde 01/11/2026.",
    );
    expect(armarResumen(undefined, "")).toBe(
      "Se cambia al plan elegido, vigente desde la fecha que elijas.",
    );
  });
  it("la leyenda distingue fecha igual o anterior de posterior", () => {
    expect(LEYENDA_DE_PROGRAMADA).toBe(
      "Si la nueva fecha es igual o anterior, reemplaza el cambio programado; si es posterior, se aplica después de él.",
    );
  });
  it("textoDelError: los campos de la ventana no repiten texto general", () => {
    expect(textoDelError({ tipo: "CAMPO", campo: "motivo", texto: "x" })).toBeNull();
    expect(textoDelError({ tipo: "CAMPO", campo: "cuit", texto: "x" })).toBe("x");
    expect(textoDelError({ tipo: "INESPERADO" })).toBe("No pudimos cambiar el plan.");
    expect(textoDelError({ tipo: "OCULTAR_ACCION" })).toBe(
      "No tenés permiso para cambiar el plan.",
    );
  });
});
