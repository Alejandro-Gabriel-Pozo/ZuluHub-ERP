import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import { importeDesdeTexto } from "../../primitivas/dinero/importe";
import { ARS } from "../../primitivas/dinero/moneda";
import {
  filtrarImporteEscrito,
  interpretarImportePegado,
  interpretarImporteTipeado,
  mostrarImporte,
} from "./importe-tipeado";

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

describe("filtrarImporteEscrito (decisión 153: al escribir)", () => {
  it.each([
    // [lo escrito, lo que queda en el campo, el texto decimal canónico]
    ["", "", ""],
    ["abc", "", ""],
    ["$ -", "", ""],
    ["7", "7", "7.00"],
    ["1234", "1234", "1234.00"],
    ["12,5", "12,5", "12.50"],
    ["12,50", "12,50", "12.50"],
    ["12,", "12,", "12.00"],
    [",", "0,", "0.00"],
    [",5", "0,5", "0.50"],
    ["007", "7", "7.00"],
    // El punto escrito a mano no entra, ni como miles ni como decimal.
    ["1.5", "15", "15.00"],
    ["1.234", "1234", "1234.00"],
    ["12.50", "1250", "1250.00"],
    [".", "", ""],
    ["1.234,50", "1234,50", "1234.50"],
    // La tercera cifra decimal no entra; una segunda coma no parte el número.
    ["12,345", "12,34", "12.34"],
    ["1,2,3", "1,23", "1.23"],
    ["1,2,", "1,2", "1.20"],
    ["1e3", "13", "13.00"],
  ])("%j → campo %j, canónico %j", (escrito, texto, canonico) => {
    expect(filtrarImporteEscrito(escrito)).toEqual({ texto, canonico });
  });

  it("acota la parte entera a 16 dígitos", () => {
    expect(filtrarImporteEscrito("99999999999999999999")).toEqual({
      texto: "9999999999999999",
      canonico: "9999999999999999.00",
    });
  });

  it("para cualquier texto: nunca deja un punto, a lo sumo una coma y dos decimales, y es idempotente", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (crudo) => {
        const r = filtrarImporteEscrito(crudo);
        expect(r.texto).toMatch(/^(?:\d*(?:,\d{0,2})?)$/);
        expect(filtrarImporteEscrito(r.texto)).toEqual(r);
        if (r.canonico !== "") expect(() => importeDesdeTexto(ARS, r.canonico)).not.toThrow();
      }),
    );
  });

  it("un importe con coma y dos decimales se conserva exacto, sin pasar por number", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 16n - 1n }),
        fc.integer({ min: 0, max: 99 }),
        (entera, centavos) => {
          const fraccion = String(centavos).padStart(2, "0");
          const r = filtrarImporteEscrito(`${entera.toString()},${fraccion}`);
          expect(r).toEqual({
            texto: `${entera.toString()},${fraccion}`,
            canonico: `${entera.toString()}.${fraccion}`,
          });
        },
      ),
    );
  });
});

describe("interpretarImportePegado (decisión 153: al pegar)", () => {
  it.each([
    ["0", "0", "0.00"],
    ["0,5", "0,5", "0.50"],
    ["0,05", "0,05", "0.05"],
    ["7", "7", "7.00"],
    ["1234", "1234", "1234.00"],
    ["1234,5", "1234,5", "1234.50"],
    ["1.234", "1234", "1234.00"],
    ["14.000,50", "14000,50", "14000.50"],
    ["12.345.678,9", "12345678,9", "12345678.90"],
    ["  14.000,50\n", "14000,50", "14000.50"],
    ["9.999.999.999.999.999,99", "9999999999999999,99", "9999999999999999.99"],
  ])("%j se acepta → campo %j, canónico %j", (pegado, texto, canonico) => {
    expect(interpretarImportePegado(pegado)).toEqual({ ok: true, texto, canonico });
  });

  it.each([
    // Un punto que no separa miles bien.
    ["1234.50", "PUNTO_MAL_PUESTO"],
    ["1.5", "PUNTO_MAL_PUESTO"],
    ["12.34", "PUNTO_MAL_PUESTO"],
    ["1.23.456", "PUNTO_MAL_PUESTO"],
    ["1.2345,50", "PUNTO_MAL_PUESTO"],
    ["0.500", "PUNTO_MAL_PUESTO"],
    ["12,3.4", "PUNTO_MAL_PUESTO"],
    // Más de dos decimales: se rechaza, no se recorta (S-6).
    ["12,345", "DECIMALES_DE_MAS"],
    ["1.234,567", "DECIMALES_DE_MAS"],
    // Lo que no tiene forma de importe.
    ["", "FORMA_INVALIDA"],
    ["   ", "FORMA_INVALIDA"],
    ["abc", "FORMA_INVALIDA"],
    ["$ 1.234,50", "FORMA_INVALIDA"],
    ["-5", "FORMA_INVALIDA"],
    ["1e3", "FORMA_INVALIDA"],
    // Prefijo de importe válido y sufijo que no lo es: la forma se exige hasta el final del texto.
    ["12abc", "FORMA_INVALIDA"],
    ["1.234,50x", "FORMA_INVALIDA"],
    ["1,5x", "FORMA_INVALIDA"],
    ["12 34", "FORMA_INVALIDA"],
    [",5", "FORMA_INVALIDA"],
    ["12,", "FORMA_INVALIDA"],
    ["1,2,3", "FORMA_INVALIDA"],
    ["007", "FORMA_INVALIDA"],
    ["١٢", "FORMA_INVALIDA"],
    ["12 34", "FORMA_INVALIDA"],
    ["12345678901234567", "FORMA_INVALIDA"],
  ])("%j se rechaza: %s", (pegado, motivo) => {
    expect(interpretarImportePegado(pegado)).toEqual({ ok: false, motivo });
  });

  it("un importe bien formado (miles con punto o sin ellos) se acepta y es exacto, sin pasar por number", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 16n - 1n }),
        fc.integer({ min: 0, max: 99 }),
        fc.boolean(),
        (entera, centavos, conMiles) => {
          const crudo = entera.toString();
          const escrito = conMiles ? crudo.replace(/\B(?=(\d{3})+(?!\d))/g, ".") : crudo;
          const fraccion = String(centavos).padStart(2, "0");
          expect(interpretarImportePegado(`${escrito},${fraccion}`)).toEqual({
            ok: true,
            texto: `${crudo},${fraccion}`,
            canonico: `${crudo}.${fraccion}`,
          });
        },
      ),
    );
  });

  it("lo que muestra el sistema se puede volver a pegar (mostrar → pegar conserva el importe)", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (crudo) => {
        const { canonico } = filtrarImporteEscrito(crudo);
        if (canonico === "") return;
        const r = interpretarImportePegado(mostrarImporte(canonico));
        expect(r).toMatchObject({ ok: true, canonico });
      }),
    );
  });

  it("para cualquier texto: o se acepta con un canónico que la primitiva de dinero acepta, o se rechaza con motivo", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (crudo) => {
        const r = interpretarImportePegado(crudo);
        if (r.ok) expect(() => importeDesdeTexto(ARS, r.canonico)).not.toThrow();
        else expect(["PUNTO_MAL_PUESTO", "DECIMALES_DE_MAS", "FORMA_INVALIDA"]).toContain(r.motivo);
      }),
    );
  });
});
