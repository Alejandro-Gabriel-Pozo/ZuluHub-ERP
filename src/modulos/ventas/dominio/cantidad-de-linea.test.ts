import { describe, expect, it } from "vitest";
import { cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import { comprobarCantidadDeLinea } from "./cantidad-de-linea";

const c = (t: string) => comprobarCantidadDeLinea(cantidadDesdeTexto(t));

describe("cantidad de una línea (cota 9999)", () => {
  it("acepta de la mínima a 9999 inclusive", () => {
    expect(c("0.0001").ok).toBe(true);
    expect(c("1").ok).toBe(true);
    expect(c("9999").ok).toBe(true);
  });
  it("rechaza 0 y lo que pasa de 9999", () => {
    expect(c("0")).toEqual({ ok: false, error: "CANTIDAD_INVALIDA" });
    expect(c("9999.0001")).toEqual({ ok: false, error: "CANTIDAD_INVALIDA" });
    expect(c("10000")).toEqual({ ok: false, error: "CANTIDAD_INVALIDA" });
  });
});
