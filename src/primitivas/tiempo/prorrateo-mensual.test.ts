import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import { dividirRedondeando } from "../cantidad/redondeo-entero";
import { importeATexto, importeDesdeTexto, type Importe } from "../dinero/importe";
import { ARS } from "../dinero/moneda";
import { prorratearMensual } from "./prorrateo-mensual";

const ars = (t: string): Importe => importeDesdeTexto(ARS, t);
const texto = (r: ReturnType<typeof prorratearMensual>) =>
  r.ok ? importeATexto(r.valor) : r.error;

describe("prorrateo mensual", () => {
  it("900 en un mes de 30 días con 10 ocupados = 300", () => {
    expect(texto(prorratearMensual(ars("900.00"), 10, 30))).toBe("300.00");
  });

  it("mes completo = el importe; un día = importe ÷ días al centavo", () => {
    expect(texto(prorratearMensual(ars("1000.00"), 31, 31))).toBe("1000.00");
    expect(texto(prorratearMensual(ars("1000.00"), 1, 31))).toBe("32.26");
    expect(texto(prorratearMensual(ars("1000.00"), 1, 28))).toBe("35.71");
  });

  it("la mitad exacta sube", () => {
    // 0,01 × 15 ÷ 30 = 0,005 → 0,01; 0,01 × 14 ÷ 30 = 0,0046 → 0,00; 0,01 × 16 ÷ 30 → 0,01.
    expect(texto(prorratearMensual(ars("0.01"), 15, 30))).toBe("0.01");
    expect(texto(prorratearMensual(ars("0.01"), 14, 30))).toBe("0.00");
    expect(texto(prorratearMensual(ars("0.01"), 16, 30))).toBe("0.01");
    expect(texto(prorratearMensual(ars("10.01"), 1, 2 * 14))).toBe("0.36");
  });

  it("rechaza días ocupados en cero, de más, fraccionarios o no finitos", () => {
    for (const ocupados of [0, 31, -1, 1.5, Number.NaN]) {
      expect(texto(prorratearMensual(ars("900.00"), ocupados, 30))).toBe("DIAS_OCUPADOS_INVALIDOS");
    }
  });

  it("rechaza días del mes que no sean 28 a 31", () => {
    for (const dias of [0, 27, 32, 30.5, Number.NaN]) {
      expect(texto(prorratearMensual(ars("900.00"), 1, dias))).toBe("DIAS_DEL_MES_INVALIDOS");
    }
  });

  it("rechaza importe negativo y acepta cero", () => {
    expect(texto(prorratearMensual(ars("-1.00"), 1, 30))).toBe("IMPORTE_DEL_MES_NEGATIVO");
    expect(texto(prorratearMensual(ars("0.00"), 1, 30))).toBe("0.00");
  });

  it("coincide con importe × ocupados ÷ días redondeado mitad sube (oráculo bigint)", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 12n }),
        fc.constantFrom(28, 29, 30, 31),
        fc.integer({ min: 1, max: 31 }),
        (centavos, dias, ocupadosBruto) => {
          const ocupados = ((ocupadosBruto - 1) % dias) + 1;
          const r = prorratearMensual(
            ars(`${centavos / 100n}.${String(centavos % 100n).padStart(2, "0")}`),
            ocupados,
            dias,
          );
          expect(r.ok && r.valor.unidades).toBe(
            dividirRedondeando(centavos * BigInt(ocupados), BigInt(dias), "MITAD_SUBE_SIMETRICA"),
          );
        },
      ),
    );
  });

  it("es pura: repetida da lo mismo", () => {
    const a = prorratearMensual(ars("1234.56"), 7, 31);
    expect(prorratearMensual(ars("1234.56"), 7, 31)).toEqual(a);
  });
});
