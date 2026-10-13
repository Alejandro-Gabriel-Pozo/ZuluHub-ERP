import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import { importeDesdeTexto } from "../../primitivas/dinero/importe";
import { ARS } from "../../primitivas/dinero/moneda";
import { interpretarImporteTipeado, mostrarImporte } from "./importe-tipeado";

describe("interpretarImporteTipeado", () => {
  it.each([
    // [lo tipeado, lo que muestra el campo, el texto decimal canónico que entrega]
    ["", "", ""],
    ["   ", "", ""],
    ["abc", "", ""],
    ["$", "", ""],
    ["0", "0", "0.00"],
    ["7", "7", "7.00"],
    ["12", "12", "12.00"],
    ["1234", "1234", "1234.00"],
    ["12,5", "12,5", "12.50"],
    ["12,50", "12,50", "12.50"],
    ["12,", "12,", "12.00"],
    [",", "0,", "0.00"],
    [",5", "0,5", "0.50"],
    ["0,05", "0,05", "0.05"],
    ["007", "7", "7.00"],
    ["000", "0", "0.00"],
    ["0,", "0,", "0.00"],
    ["12,345", "12,34", "12.34"],
    ["12,3456789", "12,34", "12.34"],
    // Con coma, los puntos son miles.
    ["1.234,56", "1234,56", "1234.56"],
    ["12.345.678,9", "12345678,9", "12345678.90"],
    // Una segunda coma se descarta (no se parte el número en dos).
    ["1,2,3", "1,23", "1.23"],
    ["1,2,", "1,2", "1.20"],
    // Sin coma: puntos agrupados de a tres son miles...
    ["1.234", "1234", "1234.00"],
    ["12.345.678", "12345678", "12345678.00"],
    ["999.999", "999999", "999999.00"],
    // ...y si no agrupan de a tres, el último punto es el decimal (teclado con punto).
    ["12.5", "12,5", "12.50"],
    ["12.50", "12,50", "12.50"],
    ["12.", "12,", "12.00"],
    [".5", "0,5", "0.50"],
    ["1234.5", "1234,5", "1234.50"],
    ["1.2.3", "12,3", "12.30"],
    ["12.3456", "12,34", "12.34"],
    ["1234.567", "1234,56", "1234.56"],
    ["0.123", "0,12", "0.12"],
    ["12.34.567", "1234,56", "1234.56"],
    // Lo que no es dígito, coma ni punto se ignora: signo, símbolo de pesos, espacios, letras.
    ["$ 1.234,50", "1234,50", "1234.50"],
    ["-12,5", "12,5", "12.50"],
    [" 1 2 ,5 ", "12,5", "12.50"],
    ["1e3", "13", "13.00"],
    ["١٢", "", ""],
  ])("%j → campo %j, canónico %j", (tipeado, texto, canonico) => {
    expect(interpretarImporteTipeado(tipeado)).toEqual({ texto, canonico });
  });

  it("acota la parte entera a lo que entra en un numeric(18,2): 16 dígitos", () => {
    expect(interpretarImporteTipeado("1234567890123456")).toEqual({
      texto: "1234567890123456",
      canonico: "1234567890123456.00",
    });
    expect(interpretarImporteTipeado("12345678901234567,5")).toEqual({
      texto: "1234567890123456,5",
      canonico: "1234567890123456.50",
    });
    expect(interpretarImporteTipeado("99999999999999999999")).toEqual({
      texto: "9999999999999999",
      canonico: "9999999999999999.00",
    });
  });

  it("los ceros a la izquierda no se cuentan para el tope", () => {
    expect(interpretarImporteTipeado("00000000000000000001")).toEqual({
      texto: "1",
      canonico: "1.00",
    });
  });

  it("lo que entrega lo acepta la primitiva de dinero, para cualquier texto tipeado", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (crudo) => {
        const { canonico } = interpretarImporteTipeado(crudo);
        if (canonico !== "") expect(() => importeDesdeTexto(ARS, canonico)).not.toThrow();
      }),
    );
  });

  it("es idempotente: lo que muestra el campo se vuelve a interpretar igual", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (crudo) => {
        const una = interpretarImporteTipeado(crudo);
        expect(interpretarImporteTipeado(una.texto)).toEqual(una);
      }),
    );
  });

  it("un importe tipeado con coma y dos decimales se entrega exacto, sin pasar por number", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 16n - 1n }),
        fc.integer({ min: 0, max: 99 }),
        (entera, centavos) => {
          const fraccion = String(centavos).padStart(2, "0");
          const r = interpretarImporteTipeado(`${entera.toString()},${fraccion}`);
          expect(r.canonico).toBe(`${entera.toString()}.${fraccion}`);
          expect(r.texto).toBe(`${entera.toString()},${fraccion}`);
        },
      ),
    );
  });
});

describe("mostrarImporte", () => {
  it.each([
    ["", ""],
    ["0", "0,00"],
    ["0.00", "0,00"],
    ["5", "5,00"],
    ["5.5", "5,50"],
    ["5.05", "5,05"],
    ["12", "12,00"],
    ["123", "123,00"],
    ["999.99", "999,99"],
    ["1000", "1.000,00"],
    ["1234.5", "1.234,50"],
    ["12345.67", "12.345,67"],
    ["123456.78", "123.456,78"],
    ["1234567.89", "1.234.567,89"],
    ["9999999999999999.99", "9.999.999.999.999.999,99"],
    // Lo que no es un texto canónico de importe no se muestra: vacío, nunca un valor inventado.
    ["1.234,50", ""],
    ["1,5", ""],
    ["-5", ""],
    ["+5", ""],
    ["05", ""],
    ["5.", ""],
    [".5", ""],
    ["5.123", ""],
    ["abc", ""],
    [" 5", ""],
    ["5 ", ""],
    ["10000000000000000", ""],
    ["1e3", ""],
  ])("%j → %j", (canonico, esperado) => {
    expect(mostrarImporte(canonico)).toBe(esperado);
  });

  it("es el inverso de interpretar: mostrar y volver a interpretar conserva el importe", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (crudo) => {
        const { canonico } = interpretarImporteTipeado(crudo);
        expect(interpretarImporteTipeado(mostrarImporte(canonico)).canonico).toBe(canonico);
      }),
    );
  });
});
