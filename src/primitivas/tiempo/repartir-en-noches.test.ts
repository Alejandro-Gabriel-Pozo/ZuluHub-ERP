import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import { importeATexto, importeDesdeTexto, type Importe } from "../dinero/importe";
import { ARS } from "../dinero/moneda";
import { repartirEnNoches } from "./repartir-en-noches";

const ars = (t: string): Importe => importeDesdeTexto(ARS, t);
const textos = (total: string, noches: number) => {
  const r = repartirEnNoches(ars(total), noches);
  return r.ok ? r.valor.map(importeATexto) : r.error;
};

describe("repartir en noches", () => {
  it("100,00 en 3 noches = 33,33 + 33,33 + 33,34", () => {
    expect(textos("100.00", 3)).toEqual(["33.33", "33.33", "33.34"]);
  });

  it("el resto de varios centavos va entero a la última", () => {
    expect(textos("100.02", 7)).toEqual([
      "14.28",
      "14.28",
      "14.28",
      "14.28",
      "14.28",
      "14.28",
      "14.34",
    ]);
    expect(textos("0.02", 3)).toEqual(["0.00", "0.00", "0.02"]);
  });

  it("una noche recibe todo; un reparto exacto no tiene resto; el total cero da ceros", () => {
    expect(textos("100.00", 1)).toEqual(["100.00"]);
    expect(textos("100.00", 4)).toEqual(["25.00", "25.00", "25.00", "25.00"]);
    expect(textos("0.00", 3)).toEqual(["0.00", "0.00", "0.00"]);
  });

  it("rechaza noches en cero, negativas o fraccionarias, y total negativo", () => {
    for (const n of [0, -1, 1.5, Number.NaN, 2 ** 53])
      expect(textos("100.00", n)).toBe("NOCHES_INVALIDAS");
    expect(textos("-1.00", 3)).toBe("TOTAL_NEGATIVO");
  });

  it("la suma es siempre el total, las primeras son iguales y la última es la mayor", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 12n }),
        fc.integer({ min: 1, max: 60 }),
        (centavos, noches) => {
          const total = ars(`${centavos / 100n}.${String(centavos % 100n).padStart(2, "0")}`);
          const r = repartirEnNoches(total, noches);
          if (!r.ok) throw new Error("no debía fallar");
          const unidades = r.valor.map((p) => p.unidades);
          expect(unidades).toHaveLength(noches);
          expect(unidades.reduce((a, b) => a + b, 0n)).toBe(centavos);
          const base = centavos / BigInt(noches);
          expect(unidades.slice(0, -1).every((u) => u === base)).toBe(true);
          expect(unidades[noches - 1]).toBe(centavos - base * BigInt(noches - 1));
        },
      ),
    );
  });

  it("es pura: repetida da lo mismo", () => {
    expect(repartirEnNoches(ars("100.00"), 3)).toEqual(repartirEnNoches(ars("100.00"), 3));
  });
});
