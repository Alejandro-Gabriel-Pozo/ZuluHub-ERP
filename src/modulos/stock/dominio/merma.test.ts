import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import { MAXIMO_DE_UNIDADES } from "../../../primitivas/cantidad/decimal-fijo";
import { porcentajeDesdeTexto } from "../../../primitivas/cantidad/porcentaje";
import { brutoComoTexto, brutoDeNeto, fraccionDeBruto, SIN_MERMA } from "./merma";

const c = cantidadDesdeTexto;
const p = porcentajeDesdeTexto;

describe("merma: el bruto es el neto más la merma (P-1)", () => {
  it("1 kg neto con 20 % de merma son 1,2 kg brutos (no 1,25)", () => {
    expect(brutoComoTexto(c("1"), p("20"))).toBe("1.2000");
  });
  it("sin merma, o con merma cero, el bruto es el neto", () => {
    expect(brutoComoTexto(c("3.5"), null)).toBe("3.5000");
    expect(brutoComoTexto(c("3.5"), SIN_MERMA)).toBe("3.5000");
  });
  it("la fracción es exacta: neto × (100 + merma) ÷ 100, en unidades mínimas", () => {
    const f = fraccionDeBruto(10_000n, p("20"));
    expect(f.numerador / f.denominador).toBe(12_000n);
    expect(f.numerador % f.denominador).toBe(0n);
    expect(fraccionDeBruto(7n, null)).toEqual({
      numerador: 7n * 1_000_000n,
      denominador: 1_000_000n,
    });
  });
  it("redondea una sola vez, la mitad hacia arriba", () => {
    // 0,0003 × 1,5 = 0,00045 → 0,0005
    expect(brutoComoTexto(c("0.0003"), p("50"))).toBe("0.0005");
    // 0,0001 × 1,4 = 0,00014 → 0,0001
    expect(brutoComoTexto(c("0.0001"), p("40"))).toBe("0.0001");
  });
  it("fuera del rango de una cantidad devuelve null y no un número roto", () => {
    const maximo = cantidadDesdeTexto("99999999999999.9999");
    expect(maximo.unidades <= MAXIMO_DE_UNIDADES).toBe(true);
    expect(brutoDeNeto(maximo, p("10"))).toBeNull();
    expect(brutoComoTexto(maximo, p("10"))).toBeNull();
    // justo en el máximo todavía entra
    expect(brutoDeNeto(maximo, null)).toEqual(maximo);
  });
  it("propiedad: el bruto nunca es menor que el neto y es monótono en la merma", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10_000_000_000n }),
        fc.integer({ min: 0, max: 99 }),
        (unidades, puntos) => {
          const neto = cantidadDesdeTexto((Number(unidades) / 10_000).toFixed(4));
          const menor = brutoDeNeto(neto, p(String(puntos)));
          const mayor = brutoDeNeto(neto, p(String(puntos + 1)));
          expect(menor).not.toBeNull();
          expect(mayor).not.toBeNull();
          expect(menor!.unidades >= neto.unidades).toBe(true);
          expect(mayor!.unidades >= menor!.unidades).toBe(true);
        },
      ),
    );
  });
});
