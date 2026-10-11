import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { importeCero, importesIguales, sumar } from "../../src/primitivas/dinero/importe";
import { ARS } from "../../src/primitivas/dinero/moneda";
import { POLITICA_VIGENTE } from "../../src/primitivas/dinero/redondeo";
import {
  calcularComprobante,
  porcentajeDeAlicuota,
  type LineaDeComprobante,
} from "../../src/modulos/fiscal/publico";
import { lineaRazonable } from "./generadores";
import "./configuracion";

const lineas = fc.array(lineaRazonable, { minLength: 1, maxLength: 10 });

/** Oráculo: todas las líneas comparten denominador 10^16, así que el total exacto es un entero. */
const DENOMINADOR = 10n ** 16n;
function totalDeReferencia(ls: readonly LineaDeComprobante[]): bigint {
  const suma = ls.reduce((acumulado, l) => {
    const descuento = l.descuento?.unidades ?? 0n;
    return (
      acumulado + l.precioUnitario.unidades * l.cantidad.unidades * 100n * (10n ** 6n - descuento)
    );
  }, 0n);
  return (suma * 2n + DENOMINADOR) / (2n * DENOMINADOR); // la mitad sube (suma ≥ 0)
}

describe("P-D3 y P-D4: el total se redondea una sola vez y las líneas lo suman", () => {
  it("total = redondear(Σ líneas exactas) y Σ líneas = total", () => {
    fc.assert(
      fc.property(lineas, (ls) => {
        const c = calcularComprobante(ARS, ls, POLITICA_VIGENTE);
        expect(c.total.unidades).toBe(totalDeReferencia(ls));
        const suma = c.lineas.reduce(sumar, importeCero(ARS));
        expect(importesIguales(suma, c.total)).toBe(true);
        expect(c.lineas).toHaveLength(ls.length);
      }),
    );
  });

  it("el total no depende del orden de las líneas", () => {
    fc.assert(
      fc.property(lineas, (ls) => {
        const alReves = [...ls].reverse();
        const a = calcularComprobante(ARS, ls, POLITICA_VIGENTE).total;
        const b = calcularComprobante(ARS, alReves, POLITICA_VIGENTE).total;
        expect(importesIguales(a, b)).toBe(true);
      }),
    );
  });
});

describe("P-D7: IVA por alícuota", () => {
  it("neto + IVA = total, ambos ≥ 0 y el IVA dentro del margen de ARCA", () => {
    fc.assert(
      fc.property(lineas, (ls) => {
        const c = calcularComprobante(ARS, ls, POLITICA_VIGENTE);
        for (const d of c.desglose) {
          expect(d.neto.unidades + d.iva.unidades).toBe(d.total.unidades);
          expect(d.neto.unidades).toBeGreaterThanOrEqual(0n);
          expect(d.iva.unidades).toBeGreaterThanOrEqual(0n);
          const porcentaje = porcentajeDeAlicuota(d.alicuota);
          if (porcentaje === null) {
            expect(d.iva.unidades).toBe(0n);
            expect(d.neto.unidades).toBe(d.total.unidades);
          } else {
            const desvio = d.iva.unidades * 10n ** 6n - d.neto.unidades * porcentaje.unidades;
            expect(desvio < 0n ? -desvio : desvio).toBeLessThanOrEqual(10n ** 6n);
            // neto de referencia: la mitad sube sobre total / (1 + a)
            const base = 10n ** 6n + porcentaje.unidades;
            const esperado = (d.total.unidades * 10n ** 6n * 2n + base) / (2n * base);
            expect(d.neto.unidades).toBe(esperado);
          }
        }
        const sumaTotales = c.desglose.reduce((a, d) => a + d.total.unidades, 0n);
        expect(sumaTotales).toBe(c.total.unidades);
        expect(c.neto.unidades + c.iva.unidades).toBe(c.total.unidades);
      }),
    );
  });
});

describe("P-D8: la nota de crédito se informa en positivo", () => {
  it("calcular las mismas líneas da los mismos importes, todos no negativos", () => {
    fc.assert(
      fc.property(lineas, (ls) => {
        const factura = calcularComprobante(ARS, ls, POLITICA_VIGENTE);
        const nota = calcularComprobante(ARS, ls, POLITICA_VIGENTE);
        expect(nota).toEqual(factura);
        const todos = [nota.total, nota.neto, nota.iva, ...nota.lineas];
        for (const importe of todos) expect(importe.unidades).toBeGreaterThanOrEqual(0n);
      }),
    );
  });
});
