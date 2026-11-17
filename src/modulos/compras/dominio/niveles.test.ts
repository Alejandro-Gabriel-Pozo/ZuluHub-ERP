import { describe, expect, it } from "vitest";
import {
  CLASES_DE_COMPROBANTE_DE_PROVEEDOR,
  NIVEL_INICIAL_DE_COMPRA,
  NIVELES_DE_COMPRA,
  PERILLA_DEL_NIVEL,
  claseDeComprobante,
  esNivelDeCompra,
  estadoDerivadoDeCompra,
} from "./niveles";

describe("niveles de compra", () => {
  it("los cuatro, el inicial es N1 y solo N3 y N4 piden perilla", () => {
    expect([...NIVELES_DE_COMPRA]).toEqual([
      "COMPRA_SIMPLE",
      "CON_COMPROBANTE",
      "RECEPCION_SEPARADA",
      "TRES_VIAS",
    ]);
    expect(NIVEL_INICIAL_DE_COMPRA).toBe("COMPRA_SIMPLE");
    expect(PERILLA_DEL_NIVEL).toEqual({
      COMPRA_SIMPLE: null,
      CON_COMPROBANTE: null,
      RECEPCION_SEPARADA: "recepcion_separada",
      TRES_VIAS: "conciliacion_de_tres_vias",
    });
    for (const n of NIVELES_DE_COMPRA) expect(esNivelDeCompra(n)).toBe(true);
    for (const n of ["N1", "", "compra_simple"]) expect(esNivelDeCompra(n)).toBe(false);
  });
});

describe("clase de comprobante", () => {
  it("sin tipo es SIN_COMPROBANTE; con tipo, la del tipo", () => {
    expect([...CLASES_DE_COMPROBANTE_DE_PROVEEDOR]).toEqual([
      "SIN_COMPROBANTE",
      "FACTURA",
      "NOTA_DE_DEBITO",
      "NOTA_DE_CREDITO",
    ]);
    expect(claseDeComprobante(null)).toBe("SIN_COMPROBANTE");
    expect(claseDeComprobante("FACTURA_C")).toBe("FACTURA");
    expect(claseDeComprobante("NOTA_DEBITO_A")).toBe("NOTA_DE_DEBITO");
    expect(claseDeComprobante("NOTA_CREDITO_B")).toBe("NOTA_DE_CREDITO");
  });
});

describe("estadoDerivadoDeCompra (S-12)", () => {
  it("anulada, recibida sin facturar y recibida y facturada", () => {
    expect(estadoDerivadoDeCompra("ANULADA", "REGISTRADO")).toBe("ANULADA");
    expect(estadoDerivadoDeCompra("ANULADA", null)).toBe("ANULADA");
    expect(estadoDerivadoDeCompra("CONFIRMADA", null)).toBe("RECIBIDA_SIN_FACTURAR");
    expect(estadoDerivadoDeCompra("CONFIRMADA", "ANULADO")).toBe("RECIBIDA_SIN_FACTURAR");
    expect(estadoDerivadoDeCompra("CONFIRMADA", "REGISTRADO")).toBe("RECIBIDA_Y_FACTURADA");
  });
});
