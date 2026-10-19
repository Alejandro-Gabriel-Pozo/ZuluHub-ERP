import { describe, expect, it } from "vitest";
import { estadoDeSesionDePantalla } from "./estado-de-sesion";

const MINUTO = 60_000;

describe("estadoDeSesionDePantalla: la misma regla que el servidor (12 y 15 minutos)", () => {
  it.each([
    [0, "activa"],
    [12 * MINUTO - 1, "activa"],
    [12 * MINUTO, "por-vencer"],
    [15 * MINUTO - 1, "por-vencer"],
    [15 * MINUTO, "vencida"],
    [8 * 60 * MINUTO, "vencida"],
  ])("%d ms sin uso: %s", (ms, esperado) => {
    expect(estadoDeSesionDePantalla(ms)).toBe(esperado);
  });

  it("un valor que no es un número cuenta como vencida (falla cerrado)", () => {
    expect(estadoDeSesionDePantalla(Number.NaN)).toBe("vencida");
  });
});
