import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import { porcentajeDesdeTexto } from "../../../primitivas/cantidad/porcentaje";
import { netoComoTexto, netoDeBruto, SIN_MERMA } from "./merma";

const c = cantidadDesdeTexto;
const p = porcentajeDesdeTexto;

describe("merma: el neto es el bruto menos la merma (dueño, 13/11/2026)", () => {
  it("300 g brutos con 10 % de merma son 270 g netos (ejemplo del dueño)", () => {
    expect(netoComoTexto(c("0.3"), p("10"))).toBe("0.2700");
    expect(netoComoTexto(c("300"), p("10"))).toBe("270.0000");
  });
  it("1 kg bruto con 20 % de merma son 0,8 kg netos (no 1,2 ni 0,8333)", () => {
    expect(netoComoTexto(c("1"), p("20"))).toBe("0.8000");
  });
  it("sin merma, o con merma cero, el neto es el bruto", () => {
    expect(netoComoTexto(c("3.5"), null)).toBe("3.5000");
    expect(netoComoTexto(c("3.5"), SIN_MERMA)).toBe("3.5000");
  });
  it("redondea una sola vez, la mitad hacia arriba", () => {
    // 0,0003 × 0,5 = 0,00015 → 0,0002
    expect(netoComoTexto(c("0.0003"), p("50"))).toBe("0.0002");
    // 0,0001 × 0,6 = 0,00006 → 0,0001
    expect(netoComoTexto(c("0.0001"), p("40"))).toBe("0.0001");
    // 0,0001 × 0,4 = 0,00004 → 0
    expect(netoComoTexto(c("0.0001"), p("60"))).toBe("0.0000");
  });
  it("la merma de 100 % o más se rechaza con un error, no se acota", () => {
    expect(() => netoDeBruto(c("1"), p("100"))).toThrow("menor que 100");
    expect(netoComoTexto(c("1"), p("99.9999"))).toBe("0.0000");
  });
  it("propiedad: el neto nunca supera al bruto y baja al subir la merma", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10_000_000_000n }),
        fc.integer({ min: 0, max: 98 }),
        (unidades, puntos) => {
          const bruto = cantidadDesdeTexto((Number(unidades) / 10_000).toFixed(4));
          const menos = netoDeBruto(bruto, p(String(puntos)));
          const mas = netoDeBruto(bruto, p(String(puntos + 1)));
          expect(menos.unidades <= bruto.unidades).toBe(true);
          expect(mas.unidades <= menos.unidades).toBe(true);
        },
      ),
    );
  });
});
