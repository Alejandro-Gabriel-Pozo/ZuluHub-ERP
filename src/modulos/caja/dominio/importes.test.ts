import { describe, expect, it } from "vitest";
import { importeDesdeTexto } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import {
  TOPE_DE_IMPORTE_EN_CENTAVOS,
  importeConRegla,
  importeDeEntrada,
  negarImporte,
  sumarImportes,
  type ReglaDeImporte,
} from "./importes";

const ars = (monto: string) => ({ moneda: "ARS", monto });
const valor = (texto: string) => importeDesdeTexto(ARS, texto);

describe("importes de caja: el parser", () => {
  it("el tope es 999.999.999,99 en centavos", () => {
    expect(TOPE_DE_IMPORTE_EN_CENTAVOS).toBe(99_999_999_999n);
  });

  it.each([
    "10.001",
    "-0",
    "-0.00",
    "1e3",
    "5400abc",
    "",
    " 5",
    "5 ",
    "+5",
    ".5",
    "5.",
    "05",
    "1,5",
    "NaN",
    "0x10",
  ])("rechaza %j", (monto) => {
    for (const regla of ["POSITIVO", "NO_NEGATIVO", "CON_SIGNO_NO_CERO"] as const) {
      expect(importeDeEntrada(ars(monto), regla)).toEqual({ ok: false, error: "IMPORTE_INVALIDO" });
    }
  });

  it("rechaza otra moneda con MONEDA_NO_SOPORTADA y un texto que no es moneda también", () => {
    expect(importeDeEntrada({ moneda: "USD", monto: "5" }, "POSITIVO")).toEqual({
      ok: false,
      error: "MONEDA_NO_SOPORTADA",
    });
    expect(importeDeEntrada({ moneda: "", monto: "5" }, "POSITIVO")).toEqual({
      ok: false,
      error: "MONEDA_NO_SOPORTADA",
    });
  });

  it("un monto que no es texto es IMPORTE_INVALIDO; un valor que no es un importe se propaga como falla", () => {
    expect(importeDeEntrada({ moneda: "ARS", monto: 5 as unknown as string }, "POSITIVO")).toEqual({
      ok: false,
      error: "IMPORTE_INVALIDO",
    });
    expect(() =>
      importeDeEntrada(null as unknown as { moneda: string; monto: string }, "POSITIVO"),
    ).toThrow(TypeError);
  });

  it("acepta hasta dos decimales y el tope exacto, y rechaza un centavo más (en ambos signos)", () => {
    expect(importeDeEntrada(ars("999999999.99"), "POSITIVO")).toEqual({
      ok: true,
      valor: valor("999999999.99"),
    });
    expect(importeDeEntrada(ars("1000000000"), "POSITIVO")).toEqual({
      ok: false,
      error: "IMPORTE_INVALIDO",
    });
    expect(importeDeEntrada(ars("999999999.99"), "NO_NEGATIVO").ok).toBe(true);
    expect(importeDeEntrada(ars("-999999999.99"), "CON_SIGNO_NO_CERO")).toEqual({
      ok: true,
      valor: valor("-999999999.99"),
    });
    expect(importeDeEntrada(ars("-1000000000"), "CON_SIGNO_NO_CERO")).toEqual({
      ok: false,
      error: "IMPORTE_INVALIDO",
    });
    expect(importeDeEntrada(ars("0.01"), "POSITIVO")).toEqual({ ok: true, valor: valor("0.01") });
  });

  it("un importe más allá del rango de un numeric(18,2) es inválido, no una falla", () => {
    expect(importeDeEntrada(ars("99999999999999999999"), "NO_NEGATIVO")).toEqual({
      ok: false,
      error: "IMPORTE_INVALIDO",
    });
  });

  const casos: readonly (readonly [ReglaDeImporte, string, boolean])[] = [
    ["POSITIVO", "5", true],
    ["POSITIVO", "0", false],
    ["POSITIVO", "-5", false],
    ["NO_NEGATIVO", "5", true],
    ["NO_NEGATIVO", "0", true],
    ["NO_NEGATIVO", "-0.01", false],
    ["CON_SIGNO_NO_CERO", "5", true],
    ["CON_SIGNO_NO_CERO", "-5", true],
    ["CON_SIGNO_NO_CERO", "0", false],
  ];
  it.each(casos)("regla %s con %s → %s", (regla, monto, admite) => {
    expect(importeDeEntrada(ars(monto), regla).ok).toBe(admite);
  });
});

describe("importes de caja: sumar y negar", () => {
  it("suma exacta y la suma vacía es cero", () => {
    expect(sumarImportes([valor("0.10"), valor("0.20"), valor("-0.05")])).toEqual(valor("0.25"));
    expect(sumarImportes([])).toEqual(valor("0"));
  });
  it("negar da el opuesto y cero queda cero", () => {
    expect(negarImporte(valor("12.34"))).toEqual(valor("-12.34"));
    expect(negarImporte(valor("-12.34"))).toEqual(valor("12.34"));
    expect(negarImporte(valor("0")).unidades).toBe(0n);
  });
});

describe("importeConRegla: un importe ya construido contra el tope y el signo", () => {
  it("cada regla admite lo suyo y rechaza el resto, en los bordes", () => {
    const tope = TOPE_DE_IMPORTE_EN_CENTAVOS;
    const casos: Readonly<Record<ReglaDeImporte, readonly [string, boolean][]>> = {
      POSITIVO: [
        ["0.00", false],
        ["0.01", true],
        ["-0.01", false],
        ["999999999.99", true],
        ["1000000000.00", false],
      ],
      NO_NEGATIVO: [
        ["0.00", true],
        ["-0.01", false],
        ["999999999.99", true],
        ["1000000000.00", false],
      ],
      CON_SIGNO_NO_CERO: [
        ["0.00", false],
        ["-0.01", true],
        ["0.01", true],
        ["-999999999.99", true],
        ["-1000000000.00", false],
        ["1000000000.00", false],
      ],
    };
    expect(tope).toBe(99_999_999_999n);
    for (const [regla, filas] of Object.entries(casos) as [ReglaDeImporte, [string, boolean][]][]) {
      for (const [monto, admite] of filas) {
        expect(importeConRegla(valor(monto), regla).ok, `${regla} ${monto}`).toBe(admite);
      }
    }
    expect(importeConRegla(valor("0.00"), "POSITIVO")).toEqual({
      ok: false,
      error: "IMPORTE_INVALIDO",
    });
    expect(importeConRegla(valor("5.00"), "POSITIVO")).toEqual({ ok: true, valor: valor("5.00") });
  });
});
