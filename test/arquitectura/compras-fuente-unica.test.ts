import { describe, expect, it } from "vitest";
import { CODIGO_DE_TIPO_DE_COMPROBANTE } from "../../src/modulos/fiscal/dominio/codigos-de-arca";
import { CODIGOS_DE_ALICUOTA } from "../../src/modulos/fiscal/dominio/alicuota";
import { TIPOS_DE_COMPROBANTE } from "../../src/modulos/fiscal/dominio/comprobante-emitido";
import {
  ALICUOTAS_DE_COMPRA,
  FICHA_DE_TIPO_DE_COMPROBANTE,
  TIPOS_DE_COMPROBANTE_DE_PROVEEDOR,
} from "../../src/modulos/compras/dominio/comprobante";

/**
 * D-E9-9: compras no importa `fiscal` (la regla de módulos lo prohíbe), así que copia los nueve tipos de comprobante con su código de ARCA y las ocho
 * alícuotas. Esta prueba, que SÍ puede importar los dos lados, falla si la copia y el original difieren: una sola fuente de verdad con un
 * chequeo mecánico (E9 §6, H-9). Previene: una letra o una alícuota nueva en el facturador que compras no reconozca, o un código de ARCA distinto.
 */
describe("compras copia de fiscal los tipos de comprobante y las alícuotas, y la prueba las compara", () => {
  it("los nueve tipos, en el mismo orden", () => {
    expect([...TIPOS_DE_COMPROBANTE_DE_PROVEEDOR]).toEqual([...TIPOS_DE_COMPROBANTE]);
  });
  it("el código de ARCA de cada tipo", () => {
    for (const tipo of TIPOS_DE_COMPROBANTE) {
      expect(FICHA_DE_TIPO_DE_COMPROBANTE[tipo].codigo, tipo).toBe(
        CODIGO_DE_TIPO_DE_COMPROBANTE[tipo],
      );
    }
  });
  it("la letra de cada tipo sale del final de su nombre", () => {
    for (const tipo of TIPOS_DE_COMPROBANTE) {
      expect(FICHA_DE_TIPO_DE_COMPROBANTE[tipo].letra).toBe(tipo.slice(-1));
    }
  });
  it("las ocho alícuotas, en el mismo orden", () => {
    expect([...ALICUOTAS_DE_COMPRA]).toEqual([...CODIGOS_DE_ALICUOTA]);
  });
});
