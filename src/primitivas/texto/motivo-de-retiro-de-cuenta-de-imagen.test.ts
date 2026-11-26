import { describe, expect, it } from "vitest";
import { motivoDeRetiroDeCuentaDeImagenDesdeTexto } from "./motivo-de-retiro-de-cuenta-de-imagen";

/** El tope del CHECK de la base (`cuenta_de_imagen_motivo_ck`, 0102). */
const TOPE = 300;

describe("motivoDeRetiroDeCuentaDeImagenDesdeTexto", () => {
  it("acepta una línea hasta el largo máximo, sin exigir una letra", () => {
    expect(motivoDeRetiroDeCuentaDeImagenDesdeTexto("Cerramos la cuenta")).toEqual({
      ok: true,
      valor: "Cerramos la cuenta",
    });
    expect(motivoDeRetiroDeCuentaDeImagenDesdeTexto("#12")).toEqual({ ok: true, valor: "#12" });
    const justo = "a".repeat(TOPE);
    expect(motivoDeRetiroDeCuentaDeImagenDesdeTexto(justo)).toEqual({ ok: true, valor: justo });
  });

  it("rechaza el vacío, lo que pasa del largo máximo y lo que no está en la lista de permitidos", () => {
    expect(motivoDeRetiroDeCuentaDeImagenDesdeTexto("")).toEqual({ ok: false, error: "VACIO" });
    expect(motivoDeRetiroDeCuentaDeImagenDesdeTexto("a".repeat(TOPE + 1))).toEqual({
      ok: false,
      error: "DEMASIADO_LARGO",
    });
    for (const texto of ["Dos\nlíneas", "<b>x</b>", "=SUMA(A1)", "Con 🍕"]) {
      expect(motivoDeRetiroDeCuentaDeImagenDesdeTexto(texto).ok, texto).toBe(false);
    }
  });
});
