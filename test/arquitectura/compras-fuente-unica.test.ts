import { describe, expect, it } from "vitest";
import { TIPOS_DE_MEDIO } from "../../src/modulos/caja/estados";
import { MEDIOS_DE_PAGO } from "../../src/modulos/compras/dominio/pago";
import { CODIGO_DE_TIPO_DE_COMPROBANTE } from "../../src/modulos/fiscal/dominio/codigos-de-arca";
import { CODIGOS_DE_ALICUOTA } from "../../src/modulos/fiscal/dominio/alicuota";
import { CONDICIONES_DE_IVA } from "../../src/modulos/fiscal/dominio/emisor";
import { TIPOS_DE_COMPROBANTE } from "../../src/modulos/fiscal/dominio/comprobante-emitido";
import {
  ALICUOTAS_DE_COMPRA,
  CONDICIONES_DE_IVA_DE_LA_EMPRESA,
  FICHA_DE_TIPO_DE_COMPROBANTE,
  TIPOS_DE_COMPROBANTE_DE_PROVEEDOR,
} from "../../src/modulos/compras/dominio/comprobante";

/**
 * D-E9-9: compras no importa `fiscal` (la regla de módulos lo prohíbe), así que copia los nueve tipos de comprobante con su código de ARCA y las ocho
 * alícuotas. Esta prueba, que SÍ puede importar los dos lados, falla si la copia y el original difieren: una sola fuente de verdad con un
 * chequeo mecánico (E9 §6, H-9). Previene: una letra o una alícuota nueva en el facturador que compras no reconozca, o un código de ARCA distinto.
 */
describe("compras copia de fiscal los tipos de comprobante y las alícuotas, y de caja los medios, y la prueba las compara", () => {
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
  it("los medios de pago son los tipos de medio de caja, en el mismo orden", () => {
    expect([...MEDIOS_DE_PAGO]).toEqual([...TIPOS_DE_MEDIO]);
  });
  it("las condiciones de la empresa frente al IVA son las del emisor de fiscal, en el mismo orden (DEC-0322)", () => {
    expect([...CONDICIONES_DE_IVA_DE_LA_EMPRESA]).toEqual([...CONDICIONES_DE_IVA]);
  });
});
