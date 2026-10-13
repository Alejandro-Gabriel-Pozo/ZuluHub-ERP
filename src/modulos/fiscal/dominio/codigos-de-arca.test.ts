import { describe, expect, it } from "vitest";
import { TIPOS_DE_COMPROBANTE, letraDeComprobante } from "./comprobante-emitido";
import {
  CODIGO_DE_MONEDA,
  CODIGO_DE_TIPO_DE_COMPROBANTE,
  CODIGO_DE_TIPO_DE_DOCUMENTO,
} from "./codigos-de-arca";
import { TIPOS_DE_DOCUMENTO } from "./receptor";

describe("códigos de ARCA", () => {
  it("tipos de comprobante: 1, 2, 3 = A; 6, 7, 8 = B; 11, 12, 13 = C (WSFE v4.8, error 10007)", () => {
    expect(CODIGO_DE_TIPO_DE_COMPROBANTE).toEqual({
      FACTURA_A: 1,
      NOTA_DEBITO_A: 2,
      NOTA_CREDITO_A: 3,
      FACTURA_B: 6,
      NOTA_DEBITO_B: 7,
      NOTA_CREDITO_B: 8,
      FACTURA_C: 11,
      NOTA_DEBITO_C: 12,
      NOTA_CREDITO_C: 13,
    });
  });

  it("cada tipo tiene un código y no se repiten", () => {
    const codigos = TIPOS_DE_COMPROBANTE.map((t) => CODIGO_DE_TIPO_DE_COMPROBANTE[t]);
    expect(new Set(codigos).size).toBe(TIPOS_DE_COMPROBANTE.length);
  });

  it("los tres códigos de cada letra son consecutivos desde su base (1, 6 y 11)", () => {
    const base = { A: 1, B: 6, C: 11 } as const;
    for (const tipo of TIPOS_DE_COMPROBANTE) {
      const codigo = CODIGO_DE_TIPO_DE_COMPROBANTE[tipo];
      const desde = base[letraDeComprobante(tipo)];
      expect(codigo).toBeGreaterThanOrEqual(desde);
      expect(codigo).toBeLessThan(desde + 3);
    }
  });

  it("documentos: CUIT 80 y sin identificar 99 los confirma el manual; los demás, no verificados", () => {
    expect(CODIGO_DE_TIPO_DE_DOCUMENTO).toEqual({
      CUIT: 80,
      CUIL: 86,
      CDI: 87,
      DNI: 96,
      PASAPORTE: 94,
      SIN_IDENTIFICAR: 99,
    });
    expect(Object.keys(CODIGO_DE_TIPO_DE_DOCUMENTO).sort()).toEqual(
      [...TIPOS_DE_DOCUMENTO, "SIN_IDENTIFICAR"].sort(),
    );
  });

  it("la moneda en pesos es PES", () => {
    expect(CODIGO_DE_MONEDA).toEqual({ ARS: "PES" });
  });
});
