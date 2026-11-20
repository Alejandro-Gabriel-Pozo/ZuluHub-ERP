import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import { razonDeContraste } from "../../../primitivas/color/contraste";
import { CONTRASTE_MINIMO_DE_LA_CARTA, colorDeLaCarta } from "./color-de-la-carta";

/**
 * Propiedades del color de la carta (CARAS línea 168: «ningún par bajo 7 a 1»). La TOLERANCIA DEL TONO
 * (elegida por el ingeniero): 8 grados de matiz, en colores con saturación ≥ 25 % y luminosidad ≥ 5 %; abajo de eso el
 * matiz casi no existe (grises) y un canal de 8 bits lo mueve más que eso.
 */
const TOLERANCIA_DE_TONO = 8;

const colores = fc
  .tuple(
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
  )
  .map(([r, g, b]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`);

const dar = (c: string) => {
  const r = colorDeLaCarta(c);
  if (!r.ok) throw new Error("válido esperado");
  return r.valor;
};

const matizYSaturacion = (hex: string): { h: number; s: number; l: number } => {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return { h: (h * 60 + 360) % 360, s: s * 100, l: l * 100 };
};

describe("colorDeLaCarta: propiedades", () => {
  it("para cualquier color: contraste ≥ 7 con el texto elegido, medido con la razón del tema", () => {
    fc.assert(
      fc.property(colores, (c) => {
        const r = dar(c);
        const texto = r.textoSobreColor === "BLANCO" ? "#ffffff" : "#000000";
        expect(razonDeContraste(r.hex, texto)).toBeGreaterThanOrEqual(CONTRASTE_MINIMO_DE_LA_CARTA);
        expect(r.contraste).toBeGreaterThanOrEqual(CONTRASTE_MINIMO_DE_LA_CARTA);
        expect(r.contraste).toBeLessThanOrEqual(razonDeContraste(r.hex, texto));
      }),
      { numRuns: 5000 },
    );
  });

  it("el color que ya cumple no cambia; el ajustado solo oscurece", () => {
    fc.assert(
      fc.property(colores, (c) => {
        const r = dar(c);
        if (!r.ajustado) expect(r.hex).toBe(c);
        else expect(matizYSaturacion(r.hex).l).toBeLessThan(matizYSaturacion(c).l);
      }),
      { numRuns: 5000 },
    );
  });

  it("idempotente: ajustar un color ya ajustado no lo cambia ni lo marca ajustado", () => {
    fc.assert(
      fc.property(colores, (c) => {
        const una = dar(c);
        const dos = dar(una.hex);
        expect(dos.hex).toBe(una.hex);
        expect(dos.ajustado).toBe(false);
        expect(dos.textoSobreColor).toBe(una.textoSobreColor);
      }),
      { numRuns: 5000 },
    );
  });

  it("conserva el tono dentro de la tolerancia declarada", () => {
    fc.assert(
      fc.property(colores, (c) => {
        const antes = matizYSaturacion(c);
        fc.pre(antes.s >= 25);
        const r = dar(c);
        const despues = matizYSaturacion(r.hex);
        fc.pre(despues.l >= 5);
        const dif = Math.abs(antes.h - despues.h);
        expect(Math.min(dif, 360 - dif)).toBeLessThanOrEqual(TOLERANCIA_DE_TONO);
      }),
      { numRuns: 5000 },
    );
  });

  it("mayúsculas y minúsculas dan el mismo resultado", () => {
    fc.assert(
      fc.property(colores, (c) => {
        expect(dar(c.toUpperCase())).toEqual(dar(c));
      }),
      { numRuns: 1000 },
    );
  });

  it("barrido de 9.261 colores de la grilla de 21 niveles por canal: ninguno bajo 7 a 1", () => {
    const niveles = Array.from({ length: 21 }, (_, i) => Math.round((i * 255) / 20));
    let n = 0;
    for (const r of niveles)
      for (const g of niveles)
        for (const b of niveles) {
          const c = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
          expect(dar(c).contraste).toBeGreaterThanOrEqual(7);
          n++;
        }
    expect(n).toBe(9261);
  });
});
