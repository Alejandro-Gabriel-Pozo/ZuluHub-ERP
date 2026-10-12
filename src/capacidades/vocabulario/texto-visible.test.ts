import { describe, expect, it } from "vitest";
import { validarTextoVisible } from "./texto-visible";

describe("validarTextoVisible", () => {
  it("deja pasar un texto común y lo devuelve igual", () => {
    expect(validarTextoVisible("Mi Calendario", 60)).toEqual({ ok: true, valor: "Mi Calendario" });
    expect(validarTextoVisible("Ñandú — café ¿sí?", 60)).toEqual({
      ok: true,
      valor: "Ñandú — café ¿sí?",
    });
  });

  it("recorta los blancos de los extremos (no los del medio)", () => {
    expect(validarTextoVisible("  hola  mundo  ", 60)).toEqual({
      ok: true,
      valor: "hola  mundo",
    });
  });

  it("devuelve el texto en NFC", () => {
    const descompuesto = "café";
    const resultado = validarTextoVisible(descompuesto, 60);
    expect(resultado).toEqual({ ok: true, valor: "café" });
    expect(resultado.ok && resultado.valor === "café").toBe(true);
  });

  it("rechaza lo vacío o en blanco", () => {
    expect(validarTextoVisible("", 60)).toEqual({ ok: false, error: "VACIO" });
    expect(validarTextoVisible("   ", 60)).toEqual({ ok: false, error: "VACIO" });
    expect(validarTextoVisible("  ", 60)).toEqual({ ok: false, error: "VACIO" });
  });

  it("el largo máximo se mide en caracteres (puntos de código): justo en el tope pasa, uno más no", () => {
    expect(validarTextoVisible("abc", 3).ok).toBe(true);
    expect(validarTextoVisible("abcd", 3)).toEqual({ ok: false, error: "DEMASIADO_LARGO" });
    // Un emoji es un solo carácter para el que mira (y para la base), aunque ocupe dos unidades.
    expect(validarTextoVisible("😀😀😀", 3).ok).toBe(true);
    expect(validarTextoVisible("😀😀😀😀", 3)).toEqual({ ok: false, error: "DEMASIADO_LARGO" });
  });

  it("el largo se mide después de normalizar y de recortar", () => {
    expect(validarTextoVisible("ééé", 3)).toEqual({ ok: true, valor: "ééé" });
    expect(validarTextoVisible("  abc  ", 3)).toEqual({ ok: true, valor: "abc" });
  });

  it.each([
    ["salto de línea", "hola\nmundo"],
    ["tabulación", "hola\tmundo"],
    ["nulo", "hola\u0000mundo"],
    ["control C1", "hola\u0085mundo"],
    ["ancho cero", "hola​mundo"],
    ["unión de ancho cero", "ho‍la"],
    ["marca de dirección de derecha a izquierda", "hola‮mundo"],
    ["aislamiento bidireccional", "hola⁦mundo"],
    ["marca de orden de bytes", "﻿hola"],
    ["guion blando", "ho­la"],
    ["menor", "a<b"],
    ["mayor", "a>b"],
    ["etiqueta", "<script>"],
    ["sustituto suelto", "hola\ud800"],
  ])("rechaza %s", (_nombre, texto) => {
    expect(validarTextoVisible(texto, 60)).toEqual({ ok: false, error: "CARACTER_PROHIBIDO" });
  });

  it("un salto de línea al final no se perdona recortando", () => {
    expect(validarTextoVisible("hola\n", 60)).toEqual({ ok: false, error: "CARACTER_PROHIBIDO" });
    expect(validarTextoVisible("\nhola", 60)).toEqual({ ok: false, error: "CARACTER_PROHIBIDO" });
  });

  it("un carácter prohibido gana a un texto vacío o demasiado largo", () => {
    expect(validarTextoVisible("\n", 60)).toEqual({ ok: false, error: "CARACTER_PROHIBIDO" });
    expect(validarTextoVisible("<<<<<", 3)).toEqual({ ok: false, error: "CARACTER_PROHIBIDO" });
  });

  it("lo vacío gana a lo largo (el máximo cero deja todo demasiado largo salvo lo vacío)", () => {
    expect(validarTextoVisible("   ", 0)).toEqual({ ok: false, error: "VACIO" });
    expect(validarTextoVisible("a", 0)).toEqual({ ok: false, error: "DEMASIADO_LARGO" });
  });
});
