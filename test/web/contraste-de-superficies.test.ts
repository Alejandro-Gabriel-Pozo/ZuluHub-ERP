import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contraste } from "../../apps/web/ui/pruebas/contraste";
import { COLORES_DE_SUPERFICIE, razonDeContraste } from "../../src/modulos/marcas/publico";

/**
 * La web y el dominio de marcas miden el contraste cada uno con su cuenta, y las superficies del aspecto viven
 * en dos lugares (los valores de `COLORES_DE_SUPERFICIE` y los de `tokens.css`). Acá no pueden separarse:
 *  - la cuenta de contraste de la web (`ui/pruebas/contraste.ts`) da lo mismo que `razonDeContraste` de marcas,
 *    que es la que decide al confirmar una marca si sus colores se leen sobre cada superficie;
 *  - el fondo y la superficie de cada superficie del aspecto son EXACTAMENTE los de `tokens.css`.
 * (`tokens.test.ts` mide después el contraste de cada combinación; corre en Chromium, no en `npm test`.)
 */

const TOKENS = readFileSync(new URL("../../apps/web/ui/tokens.css", import.meta.url), "utf8");

function colorEn(bloque: string, token: string): string {
  const valor = new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(bloque)?.[1];
  if (valor === undefined) throw new Error(`falta ${token} en el bloque`);
  return valor.toLowerCase();
}

const bloqueBase = /^:root\s*\{([\s\S]*?)\n\}/m.exec(TOKENS)?.[1] ?? "";
const bloqueDe = (atributo: string): string =>
  new RegExp(`:root\\[data-superficie="${atributo}"\\]\\s*\\{([^}]*)\\}`).exec(TOKENS)?.[1] ?? "";

describe("la cuenta de contraste de la web es la de marcas", () => {
  const colores = [
    "#000000",
    "#ffffff",
    "#1f4e79",
    "#9a3412",
    "#166534",
    "#0e7490",
    "#4b5563",
    "#fbf7f1",
    "#f3eadc",
    "#f5f8fc",
    "#e6edf6",
    "#f3f5f7",
    "#767676",
    "#777777",
    "#0b0b0b",
    "#0a0a0a",
    "#0c0c0c",
  ];

  it("da lo mismo en todos los pares (incluidos los cercanos al corte de la curva sRGB)", () => {
    for (const a of colores) {
      for (const b of colores) {
        expect(contraste(a, b), `${a} / ${b}`).toBeCloseTo(razonDeContraste(a, b), 10);
      }
    }
  });
});

describe("las superficies del aspecto son las de tokens.css", () => {
  it("NEUTRA es la base del archivo", () => {
    expect(colorEn(bloqueBase, "--color-fondo")).toBe(COLORES_DE_SUPERFICIE.NEUTRA.fondo);
    expect(colorEn(bloqueBase, "--color-superficie")).toBe(COLORES_DE_SUPERFICIE.NEUTRA.superficie);
  });

  it.each([
    ["calida", "CALIDA"],
    ["fria", "FRIA"],
  ] as const)("%s pisa el fondo y la superficie con los valores de %s", (atributo, clave) => {
    const bloque = bloqueDe(atributo);
    expect(bloque, atributo).not.toBe("");
    expect(colorEn(bloque, "--color-fondo")).toBe(COLORES_DE_SUPERFICIE[clave].fondo);
    expect(colorEn(bloque, "--color-superficie")).toBe(COLORES_DE_SUPERFICIE[clave].superficie);
  });

  it("no hay más superficies en el CSS que las de la lista cerrada del aspecto", () => {
    const enElCss = [...TOKENS.matchAll(/:root\[data-superficie="([a-z]+)"\]/g)].map((m) => m[1]);
    expect(enElCss.sort()).toEqual(["calida", "fria"]);
    expect(Object.keys(COLORES_DE_SUPERFICIE).sort()).toEqual(["CALIDA", "FRIA", "NEUTRA"]);
  });
});
