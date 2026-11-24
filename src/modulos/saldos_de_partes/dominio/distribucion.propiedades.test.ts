import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import {
  importeDesdeTexto,
  sumar,
  importeCero,
  type Importe,
} from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import {
  compararCentros,
  conSigno,
  distribucionDelEspejo,
  distribucionValida,
  distribuirPorCentroDeCosto,
} from "./distribucion";

/** Centavos enteros → importe, sin tocar `number` con decimales. */
const importeDe = (centavos: bigint): Importe => {
  const negativo = centavos < 0n;
  const abs = negativo ? -centavos : centavos;
  const texto = `${negativo ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
  return importeDesdeTexto(ARS, texto);
};

const centro = fc
  .constantFrom<string | null>("a", "b", "c", "d", null)
  .map((c) => (c === null ? null : `00000000-0000-4000-8000-0000000000${c}0`));
const centavos = fc.bigInt({ min: 1n, max: 99_999_999_999n });
const pendiente = fc.record({
  centroDeCosto: centro,
  pendiente: fc.bigInt({ min: -1000n, max: 100_000n }).map(importeDe),
});

describe("distribuirPorCentroDeCosto (propiedades)", () => {
  it("siempre suma EXACTO el importe, sin renglones en cero ni centros repetidos, en orden fijo (1 a 5 centros, centavos que no dividen parejo)", () => {
    fc.assert(
      fc.property(
        centavos,
        fc.array(fc.record({ centroDeCosto: centro, parte: fc.bigInt({ min: 1n, max: 1000n }) }), {
          maxLength: 3,
        }),
        fc.array(pendiente, { maxLength: 5 }),
        (total, imputados, pendientes) => {
          // Las imputaciones nunca pasan el total: se acotan a él.
          let restante = total;
          const imputaciones = imputados.flatMap((i) => {
            const toma = i.parte < restante ? i.parte : restante;
            restante -= toma;
            return toma > 0n ? [{ centroDeCosto: i.centroDeCosto, importe: importeDe(toma) }] : [];
          });
          const r = distribuirPorCentroDeCosto({
            importe: importeDe(total),
            imputaciones,
            pendientePorCentro: pendientes,
          });
          expect(r.ok).toBe(true);
          if (!r.ok) return;
          expect(distribucionValida(importeDe(total), r.valor)).toBe(true);
          const suma = r.valor.reduce((a, x) => sumar(a, x.importe), importeCero(ARS));
          expect(suma.unidades).toBe(total);
          expect(new Set(r.valor.map((x) => x.centroDeCosto)).size).toBe(r.valor.length);
          expect(r.valor.every((x) => x.importe.unidades > 0n)).toBe(true);
          const centros = r.valor.map((x) => x.centroDeCosto);
          expect([...centros].sort(compararCentros)).toEqual(centros);
        },
      ),
    );
  });

  it("con signo negativo (un pago, una nota de crédito) también suma exacto, y el espejo es su negativo exacto", () => {
    fc.assert(
      fc.property(centavos, fc.array(pendiente, { maxLength: 5 }), (total, pendientes) => {
        const r = distribuirPorCentroDeCosto({
          importe: importeDe(total),
          imputaciones: [],
          pendientePorCentro: pendientes,
        });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const negativa = conSigno(r.valor, "-");
        expect(distribucionValida(importeDe(-total), negativa)).toBe(true);
        const espejo = distribucionDelEspejo(negativa);
        expect(distribucionValida(importeDe(total), espejo)).toBe(true);
        expect(espejo).toEqual(r.valor);
      }),
    );
  });
});
