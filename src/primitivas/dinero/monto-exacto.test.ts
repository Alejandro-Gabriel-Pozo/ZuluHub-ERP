import { describe, expect, it } from "vitest";
import { cantidadDesdeTexto } from "../cantidad/cantidad";
import { ErrorDeValor } from "../cantidad/errores";
import { porcentajeDesdeTexto } from "../cantidad/porcentaje";
import { importeATexto, importeDesdeTexto } from "./importe";
import { ARS } from "./moneda";
import {
  exactoDeImporte,
  multiplicarPrecioPorCantidad,
  porcentajeDe,
  porcentajeDeImporte,
  quitarPorcentajeIncluido,
  restarExactos,
  sumarExactos,
} from "./monto-exacto";
import { precioUnitarioATexto, precioUnitarioDesdeTexto } from "./precio-unitario";
import { redondear } from "./redondeo";

const ars = (t: string) => importeDesdeTexto(ARS, t);
const texto = (m: ReturnType<typeof exactoDeImporte>) =>
  importeATexto(redondear(m, "MITAD_SUBE_SIMETRICA"));

describe("MontoExacto", () => {
  it("precio × cantidad es exacto: 9,95 × 3 = 29,85 y 10,005 × 1 = 10,005", () => {
    const m = multiplicarPrecioPorCantidad(
      ARS,
      precioUnitarioDesdeTexto("9.95"),
      cantidadDesdeTexto("3"),
    );
    expect([m.numerador, m.denominador]).toEqual([2985n, 1n]);
    const m2 = multiplicarPrecioPorCantidad(
      ARS,
      precioUnitarioDesdeTexto("10.005"),
      cantidadDesdeTexto("1"),
    );
    expect([m2.numerador, m2.denominador]).toEqual([2001n, 2n]);
  });

  it("guarda la fracción reducida y con denominador positivo", () => {
    const m = multiplicarPrecioPorCantidad(
      ARS,
      precioUnitarioDesdeTexto("0"),
      cantidadDesdeTexto("7"),
    );
    expect([m.numerador, m.denominador]).toEqual([0n, 1n]);
  });

  it("suma y resta sin perder fracciones", () => {
    const uno = quitarPorcentajeIncluido(exactoDeImporte(ars("1.00")), porcentajeDesdeTexto("0"));
    const medio = porcentajeDeImporte(ars("1.00"), porcentajeDesdeTexto("50"));
    expect(texto(sumarExactos(uno, medio))).toBe("1.50");
    expect(texto(restarExactos(uno, medio))).toBe("0.50");
  });

  it("porcentaje de un monto y base de un monto con porcentaje incluido", () => {
    expect(texto(porcentajeDeImporte(ars("200.00"), porcentajeDesdeTexto("10.5")))).toBe("21.00");
    expect(texto(porcentajeDe(exactoDeImporte(ars("200.00")), porcentajeDesdeTexto("0")))).toBe(
      "0.00",
    );
    expect(
      texto(quitarPorcentajeIncluido(exactoDeImporte(ars("1210.00")), porcentajeDesdeTexto("21"))),
    ).toBe("1000.00");
  });

  it("no se puede serializar: JSON.stringify falla", () => {
    expect(() => JSON.stringify(exactoDeImporte(ars("1.00")))).toThrow(TypeError);
  });

  it("monedas distintas no se mezclan (el tipo ya lo impide; se prueba el control en ejecución)", () => {
    const otra = { ...exactoDeImporte(ars("1.00")), moneda: "USD" } as unknown as ReturnType<
      typeof exactoDeImporte
    >;
    expect(() => sumarExactos(exactoDeImporte(ars("1.00")), otra)).toThrow(
      "MONEDA_DISTINTA: no se puede combinar ARS con USD",
    );
    expect(() => restarExactos(exactoDeImporte(ars("1.00")), otra)).toThrow(ErrorDeValor);
  });
});

describe("PrecioUnitario", () => {
  it("escala 6, no negativo, ida y vuelta", () => {
    expect(precioUnitarioATexto(precioUnitarioDesdeTexto("9.95"))).toBe("9.950000");
    expect(() => precioUnitarioDesdeTexto("-1")).toThrow(/precio unitario:/);
    expect(() => precioUnitarioDesdeTexto("x")).toThrow(/precio unitario:/);
    expect(() => precioUnitarioDesdeTexto("1.0000001")).toThrow(ErrorDeValor);
  });
});
