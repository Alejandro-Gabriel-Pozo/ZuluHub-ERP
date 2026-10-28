import { describe, expect, it } from "vitest";
import {
  formatearAlicuota,
  formatearCantidad,
  formatearFecha,
  formatearImporte,
  formatearNumeroDeDocumento,
  formatearPuntoDeVenta,
} from "../../apps/web/ui/plantillas/facturacion/formato-fiscal";

/** Formato de importes, fechas y documentos del detalle de un comprobante: solo cadenas, nunca `Number` ni `Date`. */

describe("formato de importes, fechas y documentos (solo cadenas)", () => {
  it.each([
    ["9000.00", "$ 9.000,00"],
    ["0.00", "$ 0,00"],
    ["0", "$ 0,00"],
    ["12.5", "$ 12,50"],
    ["999.99", "$ 999,99"],
    ["1000.00", "$ 1.000,00"],
    ["1234567.89", "$ 1.234.567,89"],
    ["4500.000000", "$ 4.500,00"],
    ["12.345000", "$ 12,345"],
    ["-1500.00", "-$ 1.500,00"],
    // Más dígitos de los que aguanta un `number` (2^53): ninguno se pierde.
    ["12345678901234567890.12", "$ 12.345.678.901.234.567.890,12"],
  ])("el importe %s se ve %s", (entrada, salida) => {
    expect(formatearImporte(entrada)).toBe(salida);
  });

  it("un texto que no es un decimal se devuelve tal cual", () => {
    expect(formatearImporte("abc")).toBe("$ abc");
  });

  it.each([
    ["2.0000", "2"],
    ["1.5000", "1,5"],
    ["0.2500", "0,25"],
    ["1000.0000", "1.000"],
  ])("la cantidad %s se ve %s", (entrada, salida) => {
    expect(formatearCantidad(entrada)).toBe(salida);
  });

  it("las fechas se dan vuelta como texto, sin correr el día", () => {
    expect(formatearFecha("2026-10-14")).toBe("14/10/2026");
    expect(formatearFecha("2026-01-01")).toBe("01/01/2026");
    expect(formatearFecha("2026-12-31")).toBe("31/12/2026");
    expect(formatearFecha("no es fecha")).toBe("no es fecha");
  });

  it("documentos: CUIT con guiones, DNI con puntos, el resto tal cual", () => {
    expect(formatearNumeroDeDocumento("CUIT", "20123456789")).toBe("20-12345678-9");
    expect(formatearNumeroDeDocumento("CUIL", "27123456784")).toBe("27-12345678-4");
    expect(formatearNumeroDeDocumento("DNI", "12345678")).toBe("12.345.678");
    expect(formatearNumeroDeDocumento("DNI", "123456")).toBe("123.456");
    expect(formatearNumeroDeDocumento("PASAPORTE", "123456789")).toBe("123456789");
  });

  it("punto de venta en cuatro dígitos y alícuotas con coma", () => {
    expect(formatearPuntoDeVenta(1)).toBe("0001");
    expect(formatearPuntoDeVenta(12)).toBe("0012");
    expect(formatearPuntoDeVenta(12345)).toBe("12345");
    expect(formatearAlicuota("21")).toBe("21");
    expect(formatearAlicuota("10.5")).toBe("10,5");
    expect(formatearAlicuota("EXENTO")).toBeNull();
    expect(formatearAlicuota("NO_GRAVADO")).toBeNull();
  });
});
