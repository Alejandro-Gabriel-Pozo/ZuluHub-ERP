import { describe, expect, it } from "vitest";
import { importeParaMostrar } from "./importe-para-mostrar";

describe("importeParaMostrar", () => {
  it.each([
    ["0.00", "0,00"],
    ["5", "5,00"],
    ["1500.5", "1.500,50"],
    ["3000.00", "3.000,00"],
    ["999", "999,00"],
    ["1000", "1.000,00"],
    ["1234567.89", "1.234.567,89"],
    ["999999999.99", "999.999.999,99"],
  ])("«%s» se muestra «%s»", (entrada, esperado) => {
    expect(importeParaMostrar(entrada)).toEqual({ ok: true, valor: esperado });
  });

  it.each([
    "",
    "1.234",
    "-5.00",
    "1,50",
    "abc",
    " 5",
    "5 ",
    "1.234.567",
    "5.",
    ".5",
    "1000000000.00",
    "5.005",
    "٣",
  ])("«%s» no se puede mostrar (falla cerrada)", (entrada) => {
    expect(importeParaMostrar(entrada)).toEqual({ ok: false, error: "IMPORTE_NO_MOSTRABLE" });
  });
});
