import { describe, expect, it } from "vitest";
import {
  LARGO_MAXIMO_DEL_NOMBRE_O_RAZON_SOCIAL,
  nombreODenominacionDesdeTexto,
} from "./nombre-o-razon-social";

describe("nombreODenominacionDesdeTexto", () => {
  it("acepta nombres y razones sociales reales, con números y signos", () => {
    for (const nombre of [
      "Distribuidora Sur SA",
      "Pérez & Hijos S.A.",
      "D'Angelo",
      "La 5ta. SRL",
      "Hotel 9 de Julio",
      "Estancia Los 3 Hermanos",
      "Juan 12345678",
      "a",
    ]) {
      expect(nombreODenominacionDesdeTexto(nombre), nombre).toEqual({ ok: true, valor: nombre });
    }
  });

  it("queda en su forma canónica", () => {
    expect(nombreODenominacionDesdeTexto("  Juan   Pérez ")).toEqual({
      ok: true,
      valor: "Juan Pérez",
    });
  });

  it("sin ninguna letra se rechaza: solo números, símbolos o un documento", () => {
    for (const nombre of ["12345678", "123 456", ".", "&&&", "9", "20-12345678-6", "30712345671"]) {
      expect(nombreODenominacionDesdeTexto(nombre), nombre).toEqual({
        ok: false,
        error: "SIN_LETRAS",
      });
    }
  });

  it("un CUIT válido escrito como nombre se rechaza, con o sin guiones", () => {
    for (const nombre of ["30712345671", "30-71234567-1"]) {
      expect(nombreODenominacionDesdeTexto(nombre)).toEqual({ ok: false, error: "SIN_LETRAS" });
    }
  });

  it("una letra latina con tilde, ñ o diéresis alcanza; º y ª no cuentan como letra", () => {
    for (const nombre of ["1 ñ", "123 ü", "9 É"]) {
      expect(nombreODenominacionDesdeTexto(nombre).ok, nombre).toBe(true);
    }
    for (const nombre of ["5º", "1ª"]) {
      expect(nombreODenominacionDesdeTexto(nombre), nombre).toEqual({
        ok: false,
        error: "SIN_LETRAS",
      });
    }
  });

  it("otros alfabetos y letras fuera de WinAnsi se rechazan (el PDF no las dibuja)", () => {
    for (const nombre of ["Łódź Importaciones", "小林商事", "בנק", "Иван"]) {
      expect(nombreODenominacionDesdeTexto(nombre), nombre).toEqual({
        ok: false,
        error: "CARACTER_PROHIBIDO",
      });
    }
  });

  it("razones sociales argentinas reales con tilde, ñ, comillas y signos", () => {
    for (const nombre of [
      "Ñandú S.R.L.",
      "Hnos. O'Higgins y Cía.",
      "Ferretería «La Esquina»",
      "Gómez y/o Sosa",
      "Coca-Cola® Argentina",
      "Nº 5 — Turismo (Mendoza)",
    ]) {
      expect(nombreODenominacionDesdeTexto(nombre), nombre).toEqual({ ok: true, valor: nombre });
    }
  });

  it("hereda las reglas de una línea: vacío, control, invisibles, etiquetas, emojis y largo", () => {
    expect(nombreODenominacionDesdeTexto("  ")).toEqual({ ok: false, error: "VACIO" });
    expect(nombreODenominacionDesdeTexto("Juan\nPérez")).toEqual({
      ok: false,
      error: "CARACTER_PROHIBIDO",
    });
    expect(nombreODenominacionDesdeTexto("Ju​an")).toEqual({
      ok: false,
      error: "CARACTER_PROHIBIDO",
    });
    expect(nombreODenominacionDesdeTexto("<b>Juan</b>")).toEqual({
      ok: false,
      error: "CARACTER_PROHIBIDO",
    });
    expect(nombreODenominacionDesdeTexto("Juan 😀")).toEqual({
      ok: false,
      error: "CARACTER_PROHIBIDO",
    });
    expect(
      nombreODenominacionDesdeTexto("n".repeat(LARGO_MAXIMO_DEL_NOMBRE_O_RAZON_SOCIAL)).ok,
    ).toBe(true);
    expect(
      nombreODenominacionDesdeTexto("n".repeat(LARGO_MAXIMO_DEL_NOMBRE_O_RAZON_SOCIAL + 1)),
    ).toEqual({ ok: false, error: "DEMASIADO_LARGO" });
  });

  it("no puede empezar con `+`, `-`, `=` ni `@`; con `-` o `+` adentro entra", () => {
    for (const nombre of ["=SUMA(A1)", "+Juan", "-Juan", "@Juan"]) {
      expect(nombreODenominacionDesdeTexto(nombre), nombre).toEqual({
        ok: false,
        error: "CARACTER_PROHIBIDO",
      });
    }
    expect(nombreODenominacionDesdeTexto("Coca-Cola Argentina").ok).toBe(true);
  });

  it("Q3: sin tope de dígitos seguidos mientras haya una letra", () => {
    expect(nombreODenominacionDesdeTexto("Juan 12345678").ok).toBe(true);
  });

  it("los saltos de línea y tabuladores en los extremos se recortan («Juan\\n» queda «Juan»)", () => {
    expect(nombreODenominacionDesdeTexto("Juan\n")).toEqual({ ok: true, valor: "Juan" });
    expect(nombreODenominacionDesdeTexto("Juan\t")).toEqual({ ok: true, valor: "Juan" });
  });

  it("el largo máximo es 200, el que el sistema ya tenía", () => {
    expect(LARGO_MAXIMO_DEL_NOMBRE_O_RAZON_SOCIAL).toBe(200);
  });
});
