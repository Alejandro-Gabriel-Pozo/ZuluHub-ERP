import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import { importeDesdeTexto } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { conciliarJornada } from "./conciliacion";

function textoDe(centavos: bigint): string {
  const negativo = centavos < 0n;
  const absoluto = (negativo ? -centavos : centavos).toString().padStart(3, "0");
  return `${negativo ? "-" : ""}${absoluto.slice(0, -2)}.${absoluto.slice(-2)}`;
}
const importe = (c: bigint) => importeDesdeTexto(ARS, textoDe(c));

const par = fc.record({
  medioDePagoId: fc.constantFrom("debito", "credito", "qr"),
  cuentaDeCobroId: fc.constantFrom<string | null>(null, "t1"),
});
const centavos = fc.bigInt({ min: 1n, max: 9_999_999_999n });

describe("propiedades de la conciliación", () => {
  it("las correcciones mueven plata entre pares pero no crean ni destruyen: suman cero; el registrado no cambia", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ centavos, antes: par, despues: par }), { maxLength: 15 }),
        fc.array(fc.record({ ...{ p: par }, centavos }), { maxLength: 10 }),
        (correcciones, movs) => {
          const lineas = conciliarJornada({
            efectivoId: "efectivo",
            movimientos: movs.map((m) => ({ ...m.p, importe: importe(m.centavos) })),
            correcciones: correcciones.map((c) => ({
              importe: importe(c.centavos),
              antes: c.antes,
              despues: c.despues,
            })),
            declaraciones: [],
            conformeGeneral: null,
            cierres: [],
          });
          expect(lineas.reduce((s, l) => s + l.correcciones.unidades, 0n)).toBe(0n);
          expect(lineas.reduce((s, l) => s + l.registrado.unidades, 0n)).toBe(
            movs.reduce((s, m) => s + m.centavos, 0n),
          );
        },
      ),
    );
  });

  it("la diferencia de una línea declarada es exactamente declarado − (registrado + correcciones), al centavo", () => {
    fc.assert(
      fc.property(
        par,
        centavos,
        centavos,
        fc.bigInt({ min: 0n, max: 9_999_999_999n }),
        (p, registrado, corregido, declarado) => {
          const lineas = conciliarJornada({
            efectivoId: "efectivo",
            movimientos: [{ ...p, importe: importe(registrado) }],
            correcciones: [
              {
                importe: importe(corregido),
                antes: { medioDePagoId: "otro", cuentaDeCobroId: null },
                despues: p,
              },
            ],
            declaraciones: [{ ...p, secuencia: 1, importe: importe(declarado) }],
            conformeGeneral: null,
            cierres: [],
          });
          const l = lineas.find(
            (x) => x.medioDePagoId === p.medioDePagoId && x.cuentaDeCobroId === p.cuentaDeCobroId,
          );
          expect(l?.diferencia?.unidades).toBe(declarado - (registrado + corregido));
        },
      ),
    );
  });
});
