import { describe, expect, it } from "vitest";
import { cantidadDesdeTexto } from "../cantidad/cantidad";
import { importeATexto } from "./importe";
import { ARS } from "./moneda";
import { multiplicarPrecioPorCantidad } from "./monto-exacto";
import { precioUnitarioDesdeTexto } from "./precio-unitario";
import { POLITICA_VIGENTE, redondear, type Politica } from "./redondeo";

const exacto = (precio: string) =>
  multiplicarPrecioPorCantidad(ARS, precioUnitarioDesdeTexto(precio), cantidadDesdeTexto("1"));
const redondeado = (precio: string, politica: Politica) =>
  importeATexto(redondear(exacto(precio), politica));

describe("redondear", () => {
  it("la política vigente es la mitad sube, simétrica (supuesto a confirmar con el contador)", () => {
    expect(POLITICA_VIGENTE).toBe("MITAD_SUBE_SIMETRICA");
  });

  it("E5: 10,005 → 10,01 y 10,015 → 10,02 con la política vigente", () => {
    expect(redondeado("10.005", POLITICA_VIGENTE)).toBe("10.01");
    expect(redondeado("10.015", POLITICA_VIGENTE)).toBe("10.02");
  });

  it("con la mitad al par: 10,005 → 10,00 y 10,015 → 10,02", () => {
    expect(redondeado("10.005", "MITAD_PAR")).toBe("10.00");
    expect(redondeado("10.015", "MITAD_PAR")).toBe("10.02");
    expect(redondeado("10.025", "MITAD_PAR")).toBe("10.02");
    expect(redondeado("10.035", "MITAD_PAR")).toBe("10.04");
  });

  it("menos de la mitad baja y más de la mitad sube, en ambas políticas", () => {
    for (const politica of ["MITAD_SUBE_SIMETRICA", "MITAD_PAR"] as const) {
      expect(redondeado("10.004999", politica)).toBe("10.00");
      expect(redondeado("10.005001", politica)).toBe("10.01");
    }
  });

  it("un importe exacto no cambia", () => {
    expect(redondeado("10.01", "MITAD_SUBE_SIMETRICA")).toBe("10.01");
    expect(redondeado("0", "MITAD_PAR")).toBe("0.00");
  });
});
