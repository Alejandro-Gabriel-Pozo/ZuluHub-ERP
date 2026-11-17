import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import { importeDesdeTexto } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import {
  DENOMINACIONES_DE_BILLETES,
  decidirArqueo,
  esperadoPorLinea,
  type MovimientoParaArqueo,
} from "./arqueo";
import { decidirAnulacion } from "./anulacion";
import { TOPE_DE_IMPORTE_EN_CENTAVOS } from "./importes";

/** Texto decimal canónico de unos centavos, escrito a mano (el oráculo no usa la primitiva). */
function textoDe(centavos: bigint): string {
  const negativo = centavos < 0n;
  const absoluto = (negativo ? -centavos : centavos).toString().padStart(3, "0");
  return `${negativo ? "-" : ""}${absoluto.slice(0, -2)}.${absoluto.slice(-2)}`;
}
const importe = (centavos: bigint) => importeDesdeTexto(ARS, textoDe(centavos));

const medio = fc.constantFrom("efectivo", "debito", "qr");
const cuenta = fc.constantFrom<string | null>(null, "t1", "t2");
const movimiento = fc.record({
  medioDePagoId: medio,
  cuentaDeCobroId: cuenta,
  centavos: fc.bigInt({ min: -9_999_999_999n, max: 9_999_999_999n }),
});

describe("propiedades del arqueo", () => {
  it("el esperado de cada línea es la Σ exacta en bigint de sus movimientos, y todo movimiento está en alguna línea", () => {
    fc.assert(
      fc.property(fc.array(movimiento, { maxLength: 40 }), (lista) => {
        const movimientos: MovimientoParaArqueo[] = lista.map((m) => ({
          ...m,
          importe: importe(m.centavos),
        }));
        const lineas = esperadoPorLinea(movimientos, "efectivo");
        for (const l of lineas) {
          const suma = lista
            .filter(
              (m) => m.medioDePagoId === l.medioDePagoId && m.cuentaDeCobroId === l.cuentaDeCobroId,
            )
            .reduce((s, m) => s + m.centavos, 0n);
          expect(l.esperado.unidades).toBe(suma);
        }
        expect(lineas.reduce((s, l) => s + l.esperado.unidades, 0n)).toBe(
          lista.reduce((s, m) => s + m.centavos, 0n),
        );
        // Una línea por par, y siempre la de efectivo.
        const llaves = lineas.map((l) => `${l.medioDePagoId}|${l.cuentaDeCobroId}`);
        expect(new Set(llaves).size).toBe(llaves.length);
        expect(llaves).toContain("efectivo|null");
      }),
    );
  });

  it("anular neutraliza: con el espejo agregado el esperado vuelve al de antes", () => {
    fc.assert(
      fc.property(
        fc.array(movimiento, { maxLength: 20 }),
        fc.bigInt({ min: 1n, max: TOPE_DE_IMPORTE_EN_CENTAVOS }),
        fc.boolean(),
        (lista, centavos, esEgreso) => {
          const base: MovimientoParaArqueo[] = lista.map((m) => ({
            ...m,
            importe: importe(m.centavos),
          }));
          const original = {
            medioDePagoId: "efectivo",
            cuentaDeCobroId: null,
            importe: importe(esEgreso ? -centavos : centavos),
          };
          const r = decidirAnulacion({
            movimiento: {
              clase: esEgreso ? "EGRESO_MANUAL" : "INGRESO_MANUAL",
              registradoPor: "p",
              ...original,
            },
            yaAnulado: false,
            sesion: "ABIERTA",
            actor: { personaId: "p", puedeAnularDeOtros: false },
            motivo: "Error de carga",
          });
          expect(r.ok).toBe(true);
          if (!r.ok) return;
          const antes = esperadoPorLinea(base, "efectivo");
          const despues = esperadoPorLinea(
            [
              ...base,
              original,
              { medioDePagoId: "efectivo", cuentaDeCobroId: null, importe: r.valor.importe },
            ],
            "efectivo",
          );
          expect(despues.map((l) => l.esperado.unidades)).toEqual(
            antes.map((l) => l.esperado.unidades),
          );
        },
      ),
    );
  });

  it("billetes + monedas con centavos: el contado es la suma exacta y la diferencia es contado − esperado", () => {
    const billetes = fc.tuple(
      ...DENOMINACIONES_DE_BILLETES.map(() => fc.integer({ min: 0, max: 99999 })),
    );
    fc.assert(
      fc.property(
        billetes,
        fc.bigInt({ min: 0n, max: TOPE_DE_IMPORTE_EN_CENTAVOS }),
        fc.bigInt({ min: -TOPE_DE_IMPORTE_EN_CENTAVOS, max: TOPE_DE_IMPORTE_EN_CENTAVOS }),
        (cantidades, monedas, esperadoEfectivo) => {
          const r = decidirArqueo({
            efectivoId: "efectivo",
            movimientos: [
              {
                medioDePagoId: "efectivo",
                cuentaDeCobroId: null,
                importe: importe(esperadoEfectivo),
              },
            ],
            conteo: {
              billetes: DENOMINACIONES_DE_BILLETES.map((denominacion, i) => ({
                denominacion,
                cantidad: cantidades[i] as number,
              })),
              monedas: { moneda: "ARS", monto: textoDe(monedas) },
            },
            otros: [],
            conformeGeneral: false,
            observacion: null,
            cierraPor: "p",
            cierraEn: new Date(0),
          });
          expect(r.ok).toBe(true);
          if (!r.ok) return;
          const enBilletes = DENOMINACIONES_DE_BILLETES.reduce(
            (s, d, i) => s + BigInt(d) * BigInt(cantidades[i] as number) * 100n,
            0n,
          );
          const [linea] = r.valor.lineas;
          expect(linea?.contado?.unidades).toBe(enBilletes + monedas);
          expect(linea?.contadoMonedas?.unidades).toBe(monedas);
          expect(linea?.esperado.unidades).toBe(esperadoEfectivo);
          expect(linea?.diferencia?.unidades).toBe(enBilletes + monedas - esperadoEfectivo);
        },
      ),
    );
  });

  it("repetir el mismo pedido da exactamente el mismo arqueo (sin reloj ni azar)", () => {
    fc.assert(
      fc.property(fc.array(movimiento, { maxLength: 15 }), (lista) => {
        const e = {
          efectivoId: "efectivo",
          movimientos: lista.map((m) => ({ ...m, importe: importe(m.centavos) })),
          conteo: {
            billetes: [{ denominacion: 100, cantidad: 1 }],
            monedas: { moneda: "ARS", monto: "0.00" },
          },
          otros: [],
          conformeGeneral: true,
          observacion: null,
          cierraPor: "p",
          cierraEn: new Date(0),
        };
        expect(decidirArqueo(e)).toEqual(decidirArqueo(e));
      }),
    );
  });
});
