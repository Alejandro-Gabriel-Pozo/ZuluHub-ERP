import { describe, expect, it } from "vitest";
import { motivoDeSuspensionDeCuentaDesdeTexto } from "./motivo-de-suspension-de-cuenta";

/** El tope del brief PR-CC-1 y del CHECK de la base (`cuenta_cliente_motivo_ck`, migración 0106). */
const TOPE = 300;

describe("motivoDeSuspensionDeCuentaDesdeTexto", () => {
  it("acepta una línea hasta el largo máximo, sin exigir una letra", () => {
    expect(motivoDeSuspensionDeCuentaDesdeTexto("Pagos vencidos hace 90 días")).toEqual({
      ok: true,
      valor: "Pagos vencidos hace 90 días",
    });
    expect(motivoDeSuspensionDeCuentaDesdeTexto("#12")).toEqual({ ok: true, valor: "#12" });
    const justo = "a".repeat(TOPE);
    expect(motivoDeSuspensionDeCuentaDesdeTexto(justo)).toEqual({ ok: true, valor: justo });
  });

  it("rechaza el vacío, lo que pasa del largo máximo y lo que no está en la lista de permitidos", () => {
    expect(motivoDeSuspensionDeCuentaDesdeTexto("")).toEqual({ ok: false, error: "VACIO" });
    expect(motivoDeSuspensionDeCuentaDesdeTexto("a".repeat(TOPE + 1))).toEqual({
      ok: false,
      error: "DEMASIADO_LARGO",
    });
    for (const texto of ["Dos\nlíneas", "<b>x</b>", "=SUMA(A1)", "Con 🍕"]) {
      expect(motivoDeSuspensionDeCuentaDesdeTexto(texto).ok, texto).toBe(false);
    }
  });
});
