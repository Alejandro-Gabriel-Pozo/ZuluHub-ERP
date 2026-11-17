import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import { importeATexto, importeDesdeTexto } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { TOPE_DE_IMPORTE_EN_CENTAVOS, importeDeEntrada, sumarImportes } from "./importes";

/** Texto decimal canónico escrito a mano (sin la primitiva) para unos centavos. */
function textoDe(centavos: bigint): string {
  const negativo = centavos < 0n;
  const absoluto = (negativo ? -centavos : centavos).toString().padStart(3, "0");
  return `${negativo ? "-" : ""}${absoluto.slice(0, -2)}.${absoluto.slice(-2)}`;
}

const centavos = fc.bigInt({ min: -TOPE_DE_IMPORTE_EN_CENTAVOS, max: TOPE_DE_IMPORTE_EN_CENTAVOS });

describe("propiedades de los importes de caja", () => {
  it("todo importe canónico dentro del tope con signo se acepta y vuelve al mismo texto", () => {
    fc.assert(
      fc.property(centavos, (c) => {
        const r = importeDeEntrada({ moneda: "ARS", monto: textoDe(c) }, "CON_SIGNO_NO_CERO");
        expect(r.ok).toBe(c !== 0n);
        if (r.ok) {
          expect(r.valor.unidades).toBe(c);
          expect(importeATexto(r.valor)).toBe(textoDe(c));
        }
      }),
    );
  });

  it("la suma en bigint es exacta: es la de los centavos, en cualquier orden", () => {
    fc.assert(
      fc.property(fc.array(centavos, { maxLength: 30 }), (lista) => {
        const importes = lista.map((c) => importeDesdeTexto(ARS, textoDe(c)));
        const esperada = lista.reduce((a, b) => a + b, 0n);
        expect(sumarImportes(importes).unidades).toBe(esperada);
        expect(sumarImportes([...importes].reverse()).unidades).toBe(esperada);
      }),
    );
  });

  it("un texto con tres decimales, con exponente o con letras nunca se acepta", () => {
    const basura = fc.oneof(
      fc
        .tuple(fc.nat(999_999), fc.nat(99), fc.integer({ min: 0, max: 9 }))
        .map(([e, d, x]) => `${e}.${String(d).padStart(2, "0")}${x}`),
      fc.nat(999).map((n) => `${n}e${n}`),
      fc.nat(999).map((n) => `${n}abc`),
    );
    fc.assert(
      fc.property(basura, (monto) => {
        expect(importeDeEntrada({ moneda: "ARS", monto }, "NO_NEGATIVO").ok).toBe(false);
      }),
    );
  });
});
