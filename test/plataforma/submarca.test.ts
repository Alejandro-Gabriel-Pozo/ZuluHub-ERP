import { describe, expect, it } from "vitest";
import { ASPECTO_POR_DEFECTO as ASPECTO_DEL_DOMINIO } from "../../src/modulos/marcas/dominio/aspecto";
import {
  ASPECTO_POR_DEFECTO,
  cambiosDelBorrador,
  esColorHex,
  hayCambios,
  normalizarColor,
  type FormularioDeSubmarca,
} from "../../apps/plataforma/logica/submarca";

const BASE: FormularioDeSubmarca = {
  nombreVisible: "Zulu",
  colores: { primary: "#9a3412", onPrimary: "#ffffff", secondary: "#334155", accent: "#0f766e" },
  aspecto: ASPECTO_POR_DEFECTO,
};

describe("submarca", () => {
  it("el aspecto por defecto coincide con el del dominio", () => {
    expect(ASPECTO_POR_DEFECTO).toEqual(ASPECTO_DEL_DOMINIO);
  });

  it("sin cambios no hay nada para guardar", () => {
    expect(cambiosDelBorrador(BASE, { ...BASE })).toEqual({});
    expect(hayCambios(BASE, { ...BASE })).toBe(false);
  });

  it("si cambia un color manda el tema completo con on-primary como clave", () => {
    const actual = { ...BASE, colores: { ...BASE.colores, accent: "#0F766F" } };
    expect(cambiosDelBorrador(BASE, actual)).toEqual({
      tema: {
        primary: "#9a3412",
        "on-primary": "#ffffff",
        secondary: "#334155",
        accent: "#0f766f",
      },
    });
    expect(hayCambios(BASE, actual)).toBe(true);
  });

  it("los colores se comparan normalizados", () => {
    const actual = { ...BASE, colores: { ...BASE.colores, primary: " 9A3412 " } };
    expect(cambiosDelBorrador(BASE, actual)).toEqual({});
  });

  it("un color vacío no se manda", () => {
    const actual = { ...BASE, colores: { ...BASE.colores, secondary: "" } };
    expect(cambiosDelBorrador(BASE, actual)).toEqual({
      tema: { primary: "#9a3412", "on-primary": "#ffffff", accent: "#0f766e" },
    });
  });

  it("si cambia solo un aspecto manda el aspecto completo", () => {
    const actual = { ...BASE, aspecto: { ...BASE.aspecto, esquinas: "RECTA" as const } };
    expect(cambiosDelBorrador(BASE, actual)).toEqual({
      aspecto: { ...ASPECTO_POR_DEFECTO, esquinas: "RECTA" },
    });
  });

  it("el nombre se recorta y solo se manda si cambió", () => {
    expect(cambiosDelBorrador(BASE, { ...BASE, nombreVisible: "  Zulu Hub  " })).toEqual({
      nombreVisible: "Zulu Hub",
    });
    expect(cambiosDelBorrador(BASE, { ...BASE, nombreVisible: " Zulu " })).toEqual({});
  });

  it.each([
    ["9A3412", "#9a3412"],
    [" #ABCDEF ", "#abcdef"],
    ["xyz", "xyz"],
    ["", ""],
  ])("normalizarColor(%j) = %j", (entrada, salida) => {
    expect(normalizarColor(entrada)).toBe(salida);
  });

  it("esColorHex es estricto", () => {
    expect(esColorHex("#abcdef")).toBe(true);
    for (const malo of ["#fff", "#GGGGGG", "#ABCDEF", "abcdef", "#abcdef ", ""]) {
      expect(esColorHex(malo)).toBe(false);
    }
  });
});
