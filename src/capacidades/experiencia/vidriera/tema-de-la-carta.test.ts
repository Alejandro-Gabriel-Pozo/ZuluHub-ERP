import { describe, expect, it } from "vitest";
import {
  TOKEN_DE_CADA_COLOR_DEL_TEMA,
  cssDelTemaDeLaCarta,
  temaDeLaCarta,
  type TemaDeLaCarta,
} from "./tema-de-la-carta";

const dar = (cara: "DIA" | "BOLICHE" | "NOCHE", color: string): TemaDeLaCarta => {
  const r = temaDeLaCarta(cara, color);
  if (!r.ok) throw new Error("válido esperado");
  return r.valor;
};

describe("temaDeLaCarta: valores exactos", () => {
  it("DIA con el azul de la maqueta: fondo blanco, texto oscuro y el azul en la cabecera con texto blanco", () => {
    expect(dar("DIA", "#1f4e79")).toEqual({
      fondo: "#ffffff",
      superficie: "#f3f5f7",
      texto: "#1b1f24",
      textoSuave: "#2b333c",
      borde: "#6b7585",
      foco: "#111827",
      agotado: "#8f1d16",
      acento: "#1f4e79",
      primariaFondo: "#1f4e79",
      primariaTexto: "#ffffff",
    });
  });

  it("BOLICHE cambia solo el fondo y la superficie respecto de DIA", () => {
    const dia = dar("DIA", "#1f4e79");
    const boliche = dar("BOLICHE", "#1f4e79");
    expect(boliche).toEqual({ ...dia, fondo: "#f6f7f4", superficie: "#ffffff" });
  });

  it("NOCHE toma solo el tono: fondo oscuro, texto claro y un tono claro en el botón", () => {
    const noche = dar("NOCHE", "#1f4e79");
    expect(noche.fondo).toBe("#101a23");
    expect(noche.texto).toMatch(/^#[0-9a-f]{6}$/);
    expect(noche.primariaTexto).toBe(noche.fondo);
    expect(noche.primariaFondo).not.toBe("#1f4e79");
    // El mismo tono con otra luminosidad da el mismo fondo: solo cuenta el matiz.
    expect(dar("NOCHE", "#ff0000").fondo).toBe(dar("NOCHE", "#800000").fondo);
  });

  it("NOCHE, valores exactos para tres tonos: fondo, superficie, textos, borde, foco, «Agotado» y el tono claro del botón", () => {
    expect(dar("NOCHE", "#1f4e79")).toEqual({
      fondo: "#101a23",
      superficie: "#1c2936",
      texto: "#edf3f8",
      textoSuave: "#c3d2df",
      borde: "#8b9fb1",
      foco: "#edf3f8",
      agotado: "#fa9999",
      acento: "#a19cfc",
      primariaFondo: "#a19cfc",
      primariaTexto: "#101a23",
    });
    // Un verde: la superficie es más clara y «Agotado» tiene que subir de luminosidad para llegar a 7:1 sobre ella.
    expect(dar("NOCHE", "#000100")).toEqual({
      fondo: "#102310",
      superficie: "#1c361c",
      texto: "#edf8ed",
      textoSuave: "#c3dfc3",
      borde: "#8bb18b",
      foco: "#edf8ed",
      agotado: "#faa8a8",
      acento: "#9cfcd4",
      primariaFondo: "#9cfcd4",
      primariaTexto: "#102310",
    });
    expect(dar("NOCHE", "#7a1f2b")).toEqual({
      fondo: "#231012",
      superficie: "#361c1f",
      texto: "#f8edee",
      textoSuave: "#dfc3c7",
      borde: "#b18b90",
      foco: "#f8edee",
      agotado: "#f99494",
      acento: "#fcc79c",
      primariaFondo: "#fcc79c",
      primariaTexto: "#231012",
    });
  });

  it("DIA y BOLICHE con un color claro: la banda es el color ya oscurecido y el texto de encima, el que más contraste da", () => {
    expect(dar("BOLICHE", "#808080")).toEqual({
      fondo: "#f6f7f4",
      superficie: "#ffffff",
      texto: "#1b1f24",
      textoSuave: "#2b333c",
      borde: "#6b7585",
      foco: "#111827",
      agotado: "#8f1d16",
      acento: "#595959",
      primariaFondo: "#595959",
      primariaTexto: "#ffffff",
    });
    // Un amarillo ya tiene 7:1 con texto NEGRO: no se oscurece y el texto es negro.
    expect(dar("DIA", "#ffd400")).toMatchObject({
      primariaFondo: "#ffd400",
      primariaTexto: "#000000",
    });
  });

  it("un color claro se oscurece (el mismo ajuste de siempre) y el texto del botón pasa a blanco", () => {
    const t = dar("DIA", "#808080");
    expect(t.primariaFondo).not.toBe("#808080");
    expect(t.primariaTexto).toBe("#ffffff");
  });

  it("un color que no es `#rrggbb` es el error cerrado y no hay tema", () => {
    for (const malo of ["#12345", "rojo", "<script>", "", null, undefined, 5, {}])
      expect(temaDeLaCarta("DIA", malo)).toEqual({
        ok: false,
        error: { codigo: "COLOR_DE_CARTA_INVALIDO" },
      });
  });
});

describe("cssDelTemaDeLaCarta", () => {
  it("escribe un token por color, en el orden de la tabla, dentro de :root", () => {
    const css = cssDelTemaDeLaCarta(dar("DIA", "#1f4e79"));
    expect(css).toBe(
      ":root{--color-fondo:#ffffff;--color-superficie:#f3f5f7;--color-texto:#1b1f24;--color-texto-suave:#2b333c;--color-borde:#6b7585;--color-foco:#111827;--color-agotado:#8f1d16;--acento:#1f4e79;--accion-primaria-fondo:#1f4e79;--accion-primaria-texto:#ffffff}",
    );
    expect(Object.values(TOKEN_DE_CADA_COLOR_DEL_TEMA)).toHaveLength(10);
  });

  it("un valor que no es `#rrggbb` (un tema armado a mano) no se escribe: vacío, nunca un CSS a medias", () => {
    const malo = { ...dar("DIA", "#1f4e79"), fondo: "red;}body{display:none" } as TemaDeLaCarta;
    expect(cssDelTemaDeLaCarta(malo)).toBe("");
    expect(cssDelTemaDeLaCarta({ ...dar("DIA", "#1f4e79"), texto: "#FFF" })).toBe("");
    expect(
      cssDelTemaDeLaCarta({ ...dar("DIA", "#1f4e79"), foco: 3 } as unknown as TemaDeLaCarta),
    ).toBe("");
  });
});
