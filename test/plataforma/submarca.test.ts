import { describe, expect, it } from "vitest";
import { ASPECTO_POR_DEFECTO as ASPECTO_DEL_DOMINIO } from "../../src/modulos/marcas/dominio/aspecto";
import {
  ASPECTO_POR_DEFECTO,
  SIN_PROPIOS,
  cambiosDelBorrador,
  esColorHex,
  esColorMalEscrito,
  hayCambios,
  normalizarColor,
  type FormularioDeSubmarca,
} from "../../apps/plataforma/logica/submarca";

const BASE: FormularioDeSubmarca = {
  nombreVisible: "Zulu",
  colores: { primary: "#9a3412", onPrimary: "#ffffff", secondary: "#334155", accent: "#0f766e" },
  aspecto: ASPECTO_POR_DEFECTO,
  propio: {
    colores: { primary: true, onPrimary: true, secondary: true, accent: true },
    aspecto: { estilo: true, superficie: true, esquinas: true, titulos: true, ingreso: true },
  },
};

/** Una submarca que hereda todo salvo el nombre: nada de lo que muestra es suyo. */
const HEREDADA: FormularioDeSubmarca = { ...BASE, propio: SIN_PROPIOS };

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

  it("editar un color heredado manda SOLO ese color: los demás siguen heredando", () => {
    const actual = { ...HEREDADA, colores: { ...HEREDADA.colores, accent: "#0F766F" } };
    expect(cambiosDelBorrador(HEREDADA, actual)).toEqual({ tema: { accent: "#0f766f" } });
  });

  it("editar un color manda además los que el borrador ya tenía como propios", () => {
    const inicial = {
      ...HEREDADA,
      propio: { ...SIN_PROPIOS, colores: { ...SIN_PROPIOS.colores, primary: true } },
    };
    const actual = { ...inicial, colores: { ...inicial.colores, accent: "#0f766f" } };
    expect(cambiosDelBorrador(inicial, actual)).toEqual({
      tema: { primary: "#9a3412", accent: "#0f766f" },
    });
  });

  it("editar un aspecto heredado manda SOLO ese aspecto; los propios van con él", () => {
    const actual = { ...HEREDADA, aspecto: { ...HEREDADA.aspecto, esquinas: "RECTA" as const } };
    expect(cambiosDelBorrador(HEREDADA, actual)).toEqual({ aspecto: { esquinas: "RECTA" } });
    const conPropio = {
      ...HEREDADA,
      propio: { ...SIN_PROPIOS, aspecto: { ...SIN_PROPIOS.aspecto, estilo: true } },
    };
    expect(
      cambiosDelBorrador(conPropio, {
        ...conPropio,
        aspecto: { ...conPropio.aspecto, esquinas: "RECTA" },
      }),
    ).toEqual({ aspecto: { estilo: "CLARO_CON_BORDES", esquinas: "RECTA" } });
  });

  it("si cambia solo un aspecto manda el aspecto completo cuando todo es propio", () => {
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

  it("esColorMalEscrito: vacío y solo espacios no lo son; lo normalizable tampoco", () => {
    expect(esColorMalEscrito("")).toBe(false);
    expect(esColorMalEscrito("   ")).toBe(false);
    expect(esColorMalEscrito(" 9A3412 ")).toBe(false);
    expect(esColorMalEscrito("xyz")).toBe(true);
    expect(esColorMalEscrito("#fff")).toBe(true);
  });

  it("esColorHex es estricto", () => {
    expect(esColorHex("#abcdef")).toBe(true);
    for (const malo of ["#fff", "#GGGGGG", "#ABCDEF", "abcdef", "#abcdef ", ""]) {
      expect(esColorHex(malo)).toBe(false);
    }
  });
});
