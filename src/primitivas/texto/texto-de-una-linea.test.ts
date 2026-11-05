import { describe, expect, it } from "vitest";
import { textoDeUnaLineaDesdeTexto } from "./texto-de-una-linea";

const valido = (texto: string, esperado: string) =>
  expect(textoDeUnaLineaDesdeTexto(texto, 200), JSON.stringify(texto)).toEqual({
    ok: true,
    valor: esperado,
  });
const invalido = (texto: string, motivo: string, maximo = 200) =>
  expect(textoDeUnaLineaDesdeTexto(texto, maximo), JSON.stringify(texto)).toEqual({
    ok: false,
    error: motivo,
  });

describe("textoDeUnaLineaDesdeTexto: lo que acepta", () => {
  it("texto común: acentos, ñ, signos de razón social y números; conserva las mayúsculas", () => {
    for (const texto of [
      "Distribuidora Sur SA",
      "Pérez & Hijos S.A.",
      "D'Angelo",
      "La 5ta. SRL",
      "Cía. Ñandú (Mendoza)",
      "Gómez y/o Sosa",
      'Nº 5 — "El Gaucho"',
      "Coca-Cola® Argentina",
      "PEREZ E HIJOS",
    ]) {
      valido(texto, texto);
    }
  });

  it("recorta los extremos y colapsa los blancos repetidos, también el espacio de no corte", () => {
    valido("  Juan   Pérez  ", "Juan Pérez");
    valido("Juan  Pérez", "Juan Pérez");
  });

  it("pasa a NFC: «é» de una o de dos piezas es el mismo texto", () => {
    valido("José", "José");
  });

  it("el largo cuenta caracteres, no unidades de UTF-16, y el tope exacto entra", () => {
    valido("a".repeat(200), "a".repeat(200));
    invalido("a".repeat(201), "DEMASIADO_LARGO");
    expect(textoDeUnaLineaDesdeTexto("ñ".repeat(5), 5).ok).toBe(true);
    // Mil caracteres de 2 unidades de UTF-16 no son mil caracteres de más: se cuentan por carácter.
    expect(textoDeUnaLineaDesdeTexto("𠀀".repeat(3), 3).ok).toBe(true);
    invalido("𠀀".repeat(4), "DEMASIADO_LARGO", 3);
  });

  it("el largo se mide después de normalizar y colapsar", () => {
    expect(textoDeUnaLineaDesdeTexto("a    b", 3).ok).toBe(true);
  });
});

describe("textoDeUnaLineaDesdeTexto: lo que rechaza", () => {
  it("vacío o solo blancos", () => {
    for (const texto of ["", "   ", "  "]) invalido(texto, "VACIO");
  });

  it("saltos de línea, tabuladores y otros caracteres de control", () => {
    for (const texto of ["a\nb", "a\rb", "a\tb", "a\u0000b", "a\u007fb", "a\u0085b", "a\u009fb"]) {
      invalido(texto, "CARACTER_PROHIBIDO");
    }
  });

  it("separadores de línea y de párrafo de Unicode", () => {
    for (const texto of ["a b", "a b"]) invalido(texto, "CARACTER_PROHIBIDO");
  });

  it("invisibles y marcas de dirección de texto (bidi): ancho cero, guion blando, RLO, LRI, BOM interno", () => {
    for (const texto of ["a​b", "a‍b", "a­b", "a‮b", "a⁦b", "a‏b", "a﻿b", "a⁠b"]) {
      invalido(texto, "CARACTER_PROHIBIDO");
    }
  });

  it("un invisible en el borde no se pierde con el recorte: se rechaza igual", () => {
    invalido("​Juan", "CARACTER_PROHIBIDO");
    invalido("Juan‮", "CARACTER_PROHIBIDO");
  });

  it("etiquetas: `<` y `>`", () => {
    for (const texto of ["<b>Juan</b>", "a<b", "a>b", "<script>x</script>"]) {
      invalido(texto, "CARACTER_PROHIBIDO");
    }
  });

  it("emojis, solos o con selector de emoji o unidos", () => {
    for (const texto of ["Juan 😀", "☎️", "👨‍👩", "🏨 Hotel"]) {
      invalido(texto, "CARACTER_PROHIBIDO");
    }
  });

  it("sustitutos sueltos (texto que la base no guarda)", () => {
    invalido("a\ud800b", "CARACTER_PROHIBIDO");
  });

  it("devuelve el motivo de lo prohibido antes que el del largo", () => {
    invalido("a\n".repeat(300), "CARACTER_PROHIBIDO");
  });
});
