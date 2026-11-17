import { describe, expect, it } from "vitest";
import { pasosDeRecetaDesdeTexto } from "./pasos-de-receta";

/** El tope de la especificación y del CHECK de la base (`composicion_pasos_ck`): una prueba de la migración lo cruza con este número. */
const LARGO_MAXIMO_DE_LOS_PASOS_DE_RECETA = 2000;

describe("pasosDeRecetaDesdeTexto", () => {
  it("acepta una línea hasta el largo máximo, sin exigir una letra", () => {
    expect(pasosDeRecetaDesdeTexto("Amasar 10 min. Descansar 1 h.")).toEqual({
      ok: true,
      valor: "Amasar 10 min. Descansar 1 h.",
    });
    expect(pasosDeRecetaDesdeTexto("1)")).toEqual({ ok: true, valor: "1)" });
    const justo = "a".repeat(LARGO_MAXIMO_DE_LOS_PASOS_DE_RECETA);
    expect(pasosDeRecetaDesdeTexto(justo)).toEqual({ ok: true, valor: justo });
  });

  it("rechaza el vacío, lo que pasa del largo máximo y lo que no está en la lista de permitidos", () => {
    expect(pasosDeRecetaDesdeTexto("")).toEqual({ ok: false, error: "VACIO" });
    expect(pasosDeRecetaDesdeTexto("a".repeat(LARGO_MAXIMO_DE_LOS_PASOS_DE_RECETA + 1))).toEqual({
      ok: false,
      error: "DEMASIADO_LARGO",
    });
    for (const texto of ["Dos\nlíneas", "<b>x</b>", "=SUMA(A1)", "Con 🍕"]) {
      expect(pasosDeRecetaDesdeTexto(texto).ok, texto).toBe(false);
    }
  });
});
