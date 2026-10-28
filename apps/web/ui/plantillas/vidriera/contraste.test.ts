import { describe, expect, it } from "vitest";
import css from "../../tokens.css?raw";

/**
 * D4 (a): nombre, precio, descripción y «Agotado» de la carta llegan a 7:1 sobre los fondos donde se pintan.
 * Los pares son SEMÁNTICOS (del código): ningún texto de la carta toma un color de la marca, así que una marca
 * no puede bajar la legibilidad de lo que se decide al mirar.
 */
function token(nombre: string): string {
  const m = new RegExp(`${nombre}:\\s*(#[0-9a-f]{6});`).exec(css);
  if (m?.[1] === undefined) throw new Error(`falta ${nombre}`);
  return m[1];
}
function luminancia(hex: string): number {
  const canal = (i: number) => {
    const c = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(0) + 0.7152 * canal(1) + 0.0722 * canal(2);
}
function contraste(a: string, b: string): number {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return ((claro ?? 0) + 0.05) / ((oscuro ?? 0) + 0.05);
}

const FONDOS = ["--color-fondo", "--color-superficie", "--color-superficie-elevada"];
const TEXTOS = ["--color-texto", "--color-texto-suave", "--color-agotado"];

describe("contraste de la carta (D4 a)", () => {
  for (const t of TEXTOS) {
    for (const f of FONDOS) {
      it(`${t} sobre ${f} llega a 7:1`, () => {
        expect(contraste(token(t), token(f))).toBeGreaterThanOrEqual(7);
      });
    }
  }

  it("el texto invertido del botón flotante y del paso elegido de «Letra» llega a 7:1", () => {
    expect(contraste(token("--color-fondo"), token("--color-texto"))).toBeGreaterThanOrEqual(7);
  });

  it("el cálculo es el de WCAG: negro sobre blanco es 21:1", () => {
    expect(contraste("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });
});
