import { describe, expect, it } from "vitest";
import { esperaDelReintento } from "./primer-admin";

describe("espera entre reintentos del primer administrador", () => {
  it("el techo se duplica en cada intento y el azar lo reparte entre 0 y el techo", () => {
    expect(esperaDelReintento(0, () => 1)).toBe(40);
    expect(esperaDelReintento(1, () => 1)).toBe(80);
    expect(esperaDelReintento(2, () => 1)).toBe(160);
    expect(esperaDelReintento(3, () => 0.5)).toBe(160);
    expect(esperaDelReintento(4, () => 0)).toBe(0);
  });

  it("se corta en un segundo, por grande que sea el intento", () => {
    expect(esperaDelReintento(5, () => 1)).toBe(1000);
    expect(esperaDelReintento(11, () => 1)).toBe(1000);
    expect(esperaDelReintento(500, () => 1)).toBe(1000);
  });

  it("con el azar real queda siempre dentro de [0, techo]", () => {
    for (let intento = 0; intento < 14; intento++) {
      for (let i = 0; i < 50; i++) {
        const espera = esperaDelReintento(intento);
        expect(espera).toBeGreaterThanOrEqual(0);
        expect(espera).toBeLessThanOrEqual(Math.min(1000, 40 * 2 ** intento));
      }
    }
  });
});
