import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import { importeDesdeTexto } from "../../../primitivas/dinero/importe";
import { precioUnitarioDesdeTexto } from "../../../primitivas/dinero/precio-unitario";
import { ARS } from "../../../primitivas/dinero/moneda";
import { repartirPrecioDelConjunto } from "./reparto-de-conjunto";

/**
 * Propiedades de `repartirPrecioDelConjunto` para cualquier historia de pesos: la suma de las partes es EXACTAMENTE el importe, ninguna parte es negativa, las
 * partes por alícuota suman el importe, y cada parte es el piso o el techo de su parte exacta (el oráculo es aritmética `bigint` escrita aparte).
 */
const ALICUOTAS = ["0", "10.5", "21", "27"];

const componentes = fc.array(
  fc.record({
    precio: fc.oneof(
      fc.constant(0n),
      fc.bigInt({ min: 1n, max: 12n }),
      fc.bigInt({ min: 0n, max: 10n ** 12n }),
    ),
    alicuota: fc.constantFrom(...ALICUOTAS),
  }),
  { minLength: 1, maxLength: 12 },
);
const importes = fc.oneof(
  fc.bigInt({ min: 0n, max: 1000n }),
  fc.bigInt({ min: 0n, max: 10n ** 12n }),
);

const suma = (xs: readonly bigint[]) => xs.reduce((a, b) => a + b, 0n);

/** Los valores se arman desde texto validado (ADR-006): centavos enteros y micro-pesos enteros a su texto decimal. */
const aImporte = (centavos: bigint) =>
  importeDesdeTexto(ARS, `${centavos / 100n}.${(centavos % 100n).toString().padStart(2, "0")}`);
const aPrecio = (micro: bigint) =>
  precioUnitarioDesdeTexto(
    `${micro / 1_000_000n}.${(micro % 1_000_000n).toString().padStart(6, "0")}`,
  );

describe("repartirPrecioDelConjunto (propiedades)", () => {
  it("las partes suman el importe, no hay negativas y cada una es el piso o el techo de su parte exacta", () => {
    fc.assert(
      fc.property(importes, componentes, (centavos, lista) => {
        const r = repartirPrecioDelConjunto(
          aImporte(centavos),
          lista.map((c) => ({
            precioDeLista: aPrecio(c.precio),
            alicuota: c.alicuota,
          })),
        );
        const pesos = lista.map((c) => c.precio);
        const total = suma(pesos);
        if (total === 0n && centavos !== 0n) {
          expect(r).toEqual({ ok: false, error: "CONJUNTO_SIN_PRECIOS_DE_REFERENCIA" });
          return;
        }
        if (!r.ok) throw new Error(`se esperaba un reparto, vino ${r.error}`);
        const partes = r.valor.partes.map((p) => p.unidades);
        expect(suma(partes)).toBe(centavos);
        for (const [i, parte] of partes.entries()) {
          expect(parte >= 0n).toBe(true);
          if (total > 0n) {
            const piso = (centavos * (pesos[i] as bigint)) / total;
            expect(parte === piso || parte === piso + 1n).toBe(true);
          } else {
            expect(parte).toBe(0n);
          }
        }
        // Por alícuota: suman el importe y cada una es la suma de sus partes.
        expect(suma(r.valor.porAlicuota.map((a) => a.importe.unidades))).toBe(centavos);
        for (const a of r.valor.porAlicuota) {
          const esperado = suma(partes.filter((_, i) => lista[i]?.alicuota === a.alicuota));
          expect(a.importe.unidades).toBe(esperado);
        }
        expect(new Set(r.valor.porAlicuota.map((a) => a.alicuota)).size).toBe(
          r.valor.porAlicuota.length,
        );
      }),
    );
  });

  it("es una función de (importe, precios): repetirla da lo mismo", () => {
    fc.assert(
      fc.property(importes, componentes, (centavos, lista) => {
        const entrada = lista.map((c) => ({
          precioDeLista: aPrecio(c.precio),
          alicuota: c.alicuota,
        }));
        expect(repartirPrecioDelConjunto(aImporte(centavos), entrada)).toEqual(
          repartirPrecioDelConjunto(aImporte(centavos), entrada),
        );
      }),
    );
  });
});
