import { describe, expect, it } from "vitest";
import { dividirRedondeando } from "./redondeo-entero";

describe("dividirRedondeando", () => {
  it.each([
    [10n, 4n, "MITAD_SUBE_SIMETRICA", 3n],
    [9n, 4n, "MITAD_SUBE_SIMETRICA", 2n],
    [11n, 4n, "MITAD_SUBE_SIMETRICA", 3n],
    [-10n, 4n, "MITAD_SUBE_SIMETRICA", -3n],
    [-9n, 4n, "MITAD_SUBE_SIMETRICA", -2n],
    [-11n, 4n, "MITAD_SUBE_SIMETRICA", -3n],
    [10n, 4n, "MITAD_PAR", 2n],
    [14n, 4n, "MITAD_PAR", 4n],
    [-10n, 4n, "MITAD_PAR", -2n],
    [-14n, 4n, "MITAD_PAR", -4n],
    [9n, 4n, "MITAD_PAR", 2n],
    [11n, 4n, "MITAD_PAR", 3n],
    [8n, 4n, "MITAD_PAR", 2n],
    [0n, 4n, "MITAD_PAR", 0n],
    [0n, 4n, "MITAD_SUBE_SIMETRICA", 0n],
    [1n, 1n, "MITAD_PAR", 1n],
  ] as const)("%s / %s con %s → %s", (n, d, politica, esperado) => {
    expect(dividirRedondeando(n, d, politica)).toBe(esperado);
  });
});
