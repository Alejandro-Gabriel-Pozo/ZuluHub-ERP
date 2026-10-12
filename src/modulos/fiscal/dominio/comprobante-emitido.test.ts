import { describe, expect, it } from "vitest";
import { EMISOR_1, EMISOR_2, EMPRESA, OTRA_EMPRESA } from "../../../../test/utilidades/fiscal";
import {
  TIPOS_DE_COMPROBANTE,
  claseDeComprobante,
  claveDeIdempotenciaDeComprobante,
  esTipoDeComprobante,
  letraDeComprobante,
  type TipoDeComprobante,
} from "./comprobante-emitido";
import { origenId } from "./identificadores";

describe("tipos de comprobante", () => {
  it("son los nueve del diseño (códigos de ARCA no verificados, no figuran acá)", () => {
    expect(TIPOS_DE_COMPROBANTE).toEqual([
      "FACTURA_A",
      "FACTURA_B",
      "FACTURA_C",
      "NOTA_DEBITO_A",
      "NOTA_DEBITO_B",
      "NOTA_DEBITO_C",
      "NOTA_CREDITO_A",
      "NOTA_CREDITO_B",
      "NOTA_CREDITO_C",
    ]);
  });

  it("se reconocen solo los exactos", () => {
    for (const tipo of TIPOS_DE_COMPROBANTE) expect(esTipoDeComprobante(tipo)).toBe(true);
    expect(esTipoDeComprobante("FACTURA_D")).toBe(false);
    expect(esTipoDeComprobante("factura_a")).toBe(false);
    expect(esTipoDeComprobante("")).toBe(false);
  });

  it("cada tipo tiene su clase y su letra", () => {
    const esperados: [TipoDeComprobante, string, string][] = [
      ["FACTURA_A", "FACTURA", "A"],
      ["FACTURA_B", "FACTURA", "B"],
      ["FACTURA_C", "FACTURA", "C"],
      ["NOTA_DEBITO_A", "NOTA_DEBITO", "A"],
      ["NOTA_DEBITO_B", "NOTA_DEBITO", "B"],
      ["NOTA_DEBITO_C", "NOTA_DEBITO", "C"],
      ["NOTA_CREDITO_A", "NOTA_CREDITO", "A"],
      ["NOTA_CREDITO_B", "NOTA_CREDITO", "B"],
      ["NOTA_CREDITO_C", "NOTA_CREDITO", "C"],
    ];
    for (const [tipo, clase, letra] of esperados) {
      expect(claseDeComprobante(tipo)).toBe(clase);
      expect(letraDeComprobante(tipo)).toBe(letra);
    }
  });
});

describe("clave de idempotencia del comprobante", () => {
  const origen = { tipo: "VENTA", id: origenId("venta-1") } as const;

  it("es (empresa, origen, emisor, clase)", () => {
    expect(claveDeIdempotenciaDeComprobante(EMPRESA, origen, EMISOR_1, "FACTURA_B")).toEqual({
      empresaId: EMPRESA,
      origenId: origenId("venta-1"),
      emisorId: EMISOR_1,
      clase: "FACTURA",
    });
  });

  it("la letra no cuenta: una factura A y una B de la misma venta y emisor son la misma clave", () => {
    expect(claveDeIdempotenciaDeComprobante(EMPRESA, origen, EMISOR_1, "FACTURA_A")).toEqual(
      claveDeIdempotenciaDeComprobante(EMPRESA, origen, EMISOR_1, "FACTURA_C"),
    );
  });

  it("otro emisor, otra clase u otra empresa son otras claves", () => {
    const base = claveDeIdempotenciaDeComprobante(EMPRESA, origen, EMISOR_1, "FACTURA_B");
    expect(claveDeIdempotenciaDeComprobante(EMPRESA, origen, EMISOR_2, "FACTURA_B")).not.toEqual(
      base,
    );
    expect(
      claveDeIdempotenciaDeComprobante(EMPRESA, origen, EMISOR_1, "NOTA_CREDITO_B"),
    ).not.toEqual(base);
    expect(
      claveDeIdempotenciaDeComprobante(OTRA_EMPRESA, origen, EMISOR_1, "FACTURA_B"),
    ).not.toEqual(base);
  });
});
