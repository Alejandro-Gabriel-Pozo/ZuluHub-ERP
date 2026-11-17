import { describe, expect, it } from "vitest";
import { motivoDeOrdenDeProduccionDesdeTexto } from "./motivo-de-orden-de-produccion";

/** El tope de la especificación y del CHECK de la base (`orden_motivo_ck`). */
const TOPE = 200;

describe("motivoDeOrdenDeProduccionDesdeTexto", () => {
  it("acepta una línea hasta el largo máximo, sin exigir una letra", () => {
    expect(motivoDeOrdenDeProduccionDesdeTexto("Se rompió el horno")).toEqual({
      ok: true,
      valor: "Se rompió el horno",
    });
    expect(motivoDeOrdenDeProduccionDesdeTexto("#12")).toEqual({ ok: true, valor: "#12" });
    const justo = "a".repeat(TOPE);
    expect(motivoDeOrdenDeProduccionDesdeTexto(justo)).toEqual({ ok: true, valor: justo });
  });

  it("rechaza el vacío, lo que pasa del largo máximo y lo que no está en la lista de permitidos", () => {
    expect(motivoDeOrdenDeProduccionDesdeTexto("")).toEqual({ ok: false, error: "VACIO" });
    expect(motivoDeOrdenDeProduccionDesdeTexto("a".repeat(TOPE + 1))).toEqual({
      ok: false,
      error: "DEMASIADO_LARGO",
    });
    for (const texto of ["Dos\nlíneas", "<b>x</b>", "=SUMA(A1)", "Con 🍕"]) {
      expect(motivoDeOrdenDeProduccionDesdeTexto(texto).ok, texto).toBe(false);
    }
  });
});
