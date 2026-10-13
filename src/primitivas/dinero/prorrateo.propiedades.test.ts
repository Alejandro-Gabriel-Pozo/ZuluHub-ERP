import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import { crearImporte, crearMontoExacto, crearPrecioUnitario } from "./interno";
import { ARS } from "./moneda";
import { prorratear, repartirPrecioUnitario } from "./prorrateo";

/**
 * Propiedades de `repartirPrecioUnitario` y de su núcleo compartido con `prorratear`. El oráculo es
 * aritmética `bigint` escrita aparte: ordena por resto mayor y reparte el sobrante, en vez de ir
 * eligiendo de a uno como la implementación.
 */

const MAXIMO = 10n ** 18n - 1n;

/** Pesos enteros no negativos, con ceros y repetidos para provocar empates. */
const pesosEnteros = fc.array(
  fc.oneof(fc.bigInt({ min: 0n, max: 12n }), fc.bigInt({ min: 0n, max: 10n ** 9n })),
  {
    minLength: 1,
    maxLength: 10,
  },
);
const totales = fc.oneof(
  fc.bigInt({ min: 0n, max: 1000n }),
  fc.bigInt({ min: 0n, max: 10n ** 12n }),
  fc.bigInt({ min: MAXIMO - 1000n, max: MAXIMO }),
);

const exacto = (n: bigint, d = 1n) => crearMontoExacto(ARS, n, d);
const reparto = (total: bigint, pesos: bigint[]) =>
  repartirPrecioUnitario(
    crearPrecioUnitario(total),
    pesos.map((p) => exacto(p)),
  ).map((p) => p.unidades);

const suma = (xs: readonly bigint[]) => xs.reduce((a, b) => a + b, 0n);

/** Restos mayores por ordenamiento: piso para todos y +1 a los primeros `faltan` por (resto desc, posición asc). */
function oraculo(total: bigint, pesos: readonly bigint[]): bigint[] {
  const s = suma(pesos);
  const piso = pesos.map((p) => (total * p) / s);
  const faltan = total - suma(piso);
  const orden = pesos
    .map((p, i) => ({ i, resto: (total * p) % s }))
    .sort((a, b) => (a.resto === b.resto ? a.i - b.i : a.resto > b.resto ? -1 : 1));
  const extra = new Set(orden.filter((_, rango) => BigInt(rango) < faltan).map((o) => o.i));
  return piso.map((x, i) => x + (extra.has(i) ? 1n : 0n));
}

describe("repartirPrecioUnitario: propiedades", () => {
  it("las partes suman exactamente el total (con pesos que suman algo)", () => {
    fc.assert(
      fc.property(totales, pesosEnteros, (total, pesos) => {
        fc.pre(suma(pesos) > 0n);
        expect(suma(reparto(total, pesos))).toBe(total);
      }),
    );
  });

  it("coincide con el oráculo de restos mayores, parte por parte", () => {
    fc.assert(
      fc.property(totales, pesosEnteros, (total, pesos) => {
        fc.pre(suma(pesos) > 0n);
        expect(reparto(total, pesos)).toEqual(oraculo(total, pesos));
      }),
    );
  });

  it("cada parte es el piso o el techo de su parte exacta", () => {
    fc.assert(
      fc.property(totales, pesosEnteros, (total, pesos) => {
        fc.pre(suma(pesos) > 0n);
        const s = suma(pesos);
        const partes = reparto(total, pesos);
        partes.forEach((parte, i) => {
          const exactoPorS = total * (pesos[i] ?? 0n);
          const diferencia = parte * s - exactoPorS;
          expect(diferencia > -s && diferencia < s).toBe(true);
        });
      }),
    );
  });

  it("restos mayores: quien recibió el sobrante tiene mayor resto que quien no, o igual y va antes", () => {
    fc.assert(
      fc.property(totales, pesosEnteros, (total, pesos) => {
        fc.pre(suma(pesos) > 0n);
        const s = suma(pesos);
        const partes = reparto(total, pesos);
        const subio = (i: number) => (partes[i] ?? 0n) > (total * (pesos[i] ?? 0n)) / s;
        const resto = (i: number) => (total * (pesos[i] ?? 0n)) % s;
        for (let i = 0; i < pesos.length; i++) {
          for (let j = 0; j < pesos.length; j++) {
            if (subio(i) && !subio(j)) {
              expect(resto(i) > resto(j) || (resto(i) === resto(j) && i < j)).toBe(true);
            }
          }
        }
      }),
    );
  });

  it("empate al primero: con pesos iguales el sobrante va a los primeros", () => {
    fc.assert(
      fc.property(
        totales,
        fc.integer({ min: 1, max: 12 }),
        fc.bigInt({ min: 1n, max: 1000n }),
        (total, n, peso) => {
          const partes = reparto(total, Array<bigint>(n).fill(peso));
          const base = total / BigInt(n);
          const sobrante = total % BigInt(n);
          expect(partes).toEqual(
            Array.from({ length: n }, (_, i) => (BigInt(i) < sobrante ? base + 1n : base)),
          );
        },
      ),
    );
  });

  it("pesos cero: reciben cero mientras haya otros pesos, y no cambian el reparto de los demás", () => {
    fc.assert(
      fc.property(totales, pesosEnteros, (total, pesos) => {
        fc.pre(suma(pesos) > 0n);
        const partes = reparto(total, pesos);
        pesos.forEach((p, i) => {
          if (p === 0n) expect(partes[i]).toBe(0n);
        });
        const sinCeros = pesos.filter((p) => p !== 0n);
        const partesSinCeros = reparto(total, sinCeros);
        expect(partes.filter((_, i) => pesos[i] !== 0n)).toEqual(partesSinCeros);
      }),
    );
  });

  it("todos los pesos en cero: total cero da ceros y total distinto de cero es PESOS_INVALIDOS", () => {
    fc.assert(
      fc.property(totales, fc.integer({ min: 0, max: 6 }), (total, n) => {
        const ceros = Array<bigint>(n).fill(0n);
        if (total === 0n) expect(reparto(total, ceros)).toEqual(ceros);
        else expect(() => reparto(total, ceros)).toThrow(/PESOS_INVALIDOS/);
      }),
    );
  });

  it("es independiente de la escala de los pesos: multiplicar todos por k da lo mismo", () => {
    fc.assert(
      fc.property(
        totales,
        pesosEnteros,
        fc.bigInt({ min: 1n, max: 10n ** 6n }),
        (total, pesos, k) => {
          fc.pre(suma(pesos) > 0n);
          expect(
            reparto(
              total,
              pesos.map((p) => p * k),
            ),
          ).toEqual(reparto(total, pesos));
        },
      ),
    );
  });

  it("pesos fraccionarios: igual que sus enteros equivalentes con denominador común", () => {
    fc.assert(
      fc.property(
        totales,
        fc.array(fc.tuple(fc.bigInt({ min: 0n, max: 50n }), fc.bigInt({ min: 1n, max: 12n })), {
          minLength: 1,
          maxLength: 6,
        }),
        (total, fracciones) => {
          // Denominador común por producto (no por mínimo común múltiplo), a propósito distinto.
          const comun = fracciones.reduce((a, [, d]) => a * d, 1n);
          const enteros = fracciones.map(([n, d]) => n * (comun / d));
          fc.pre(suma(enteros) > 0n);
          const partes = repartirPrecioUnitario(
            crearPrecioUnitario(total),
            fracciones.map(([n, d]) => exacto(n, d)),
          ).map((p) => p.unidades);
          expect(partes).toEqual(oraculo(total, enteros));
        },
      ),
    );
  });
});

describe("repartirPrecioUnitario y prorratear comparten el núcleo", () => {
  it("con el mismo número entero de unidades y los mismos pesos dan las mismas partes", () => {
    fc.assert(
      fc.property(totales, pesosEnteros, (total, pesos) => {
        fc.pre(suma(pesos) > 0n);
        const centavos = prorratear(
          crearImporte(ARS, total),
          pesos.map((p) => exacto(p)),
        ).map((i) => i.unidades);
        expect(reparto(total, pesos)).toEqual(centavos);
      }),
    );
  });

  it("en un múltiplo de centavo cuyo reparto es exacto, el precio en micro-pesos es el de prorratear × 10⁴", () => {
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: 0n, max: 1000n }), { minLength: 1, maxLength: 8 }),
        fc.bigInt({ min: 0n, max: 100_000n }),
        (pesos, veces) => {
          fc.pre(suma(pesos) > 0n);
          // Total = veces × Σpesos centavos: cada parte exacta es un número entero de centavos.
          const centavos = veces * suma(pesos);
          const enCentavos = prorratear(
            crearImporte(ARS, centavos),
            pesos.map((p) => exacto(p)),
          ).map((i) => i.unidades);
          const enMicro = reparto(centavos * 10_000n, pesos);
          expect(enMicro).toEqual(enCentavos.map((c) => c * 10_000n));
        },
      ),
    );
  });

  it("en un múltiplo de centavo cualquiera, cada parte en micro-pesos queda a menos de un centavo de la de prorratear", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 9n }), pesosEnteros, (centavos, pesos) => {
        fc.pre(suma(pesos) > 0n);
        const enCentavos = prorratear(
          crearImporte(ARS, centavos),
          pesos.map((p) => exacto(p)),
        ).map((i) => i.unidades);
        const enMicro = reparto(centavos * 10_000n, pesos);
        enMicro.forEach((micro, i) => {
          const diferencia = micro - (enCentavos[i] ?? 0n) * 10_000n;
          expect(diferencia > -10_001n && diferencia < 10_001n).toBe(true);
        });
        expect(suma(enMicro)).toBe(suma(enCentavos) * 10_000n);
      }),
    );
  });
});
