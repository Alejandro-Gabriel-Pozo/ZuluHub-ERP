import { describe, expect, it } from "vitest";
import { EMISOR_1, EMISOR_2, EMPRESA, OTRA_EMPRESA } from "../../../../test/utilidades/fiscal";
import {
  TIPOS_DE_COMPROBANTE,
  TIPOS_DE_ORIGEN,
  claseDeComprobante,
  claveDeIdempotenciaDeComprobante,
  esTipoDeComprobante,
  esTipoDeOrigen,
  letraDeComprobante,
  type OrigenDeComprobante,
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

describe("catálogo de orígenes", () => {
  it("es el cerrado del diseño, sin VENTA", () => {
    expect(TIPOS_DE_ORIGEN).toEqual([
      "MANUAL",
      "EJEMPLAR_DE_TICKET",
      "PROPINA_DE_TICKET",
      "CORRECCION_DE_TICKET",
      "SUSCRIPCION",
    ]);
  });

  it("se reconocen solo los exactos", () => {
    for (const tipo of TIPOS_DE_ORIGEN) expect(esTipoDeOrigen(tipo)).toBe(true);
    expect(esTipoDeOrigen("VENTA")).toBe(false);
    expect(esTipoDeOrigen("manual")).toBe(false);
    expect(esTipoDeOrigen("")).toBe(false);
  });
});

describe("clave de idempotencia del comprobante", () => {
  const origen = { tipo: "EJEMPLAR_DE_TICKET", id: origenId("ejemplar-1") } as const;

  it("es (empresa, origen tipo, origen id, emisor, clase)", () => {
    expect(claveDeIdempotenciaDeComprobante(EMPRESA, origen, EMISOR_1, "FACTURA_B")).toEqual({
      empresaId: EMPRESA,
      origenTipo: "EJEMPLAR_DE_TICKET",
      origenId: origenId("ejemplar-1"),
      emisorId: EMISOR_1,
      clase: "FACTURA",
    });
  });

  it("la letra no cuenta: una factura A y una B del mismo origen y emisor son la misma clave", () => {
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

  it("otro id de origen del mismo tipo es otra clave", () => {
    const otro = { tipo: "EJEMPLAR_DE_TICKET", id: origenId("ejemplar-2") } as const;
    expect(claveDeIdempotenciaDeComprobante(EMPRESA, otro, EMISOR_1, "FACTURA_B")).not.toEqual(
      claveDeIdempotenciaDeComprobante(EMPRESA, origen, EMISOR_1, "FACTURA_B"),
    );
  });

  it("el mismo origen (tipo e id), emisor y clase repite la misma clave, para todo tipo del catálogo", () => {
    for (const tipo of TIPOS_DE_ORIGEN) {
      const a: OrigenDeComprobante = { tipo, id: origenId("x-1") };
      const b: OrigenDeComprobante = { tipo, id: origenId("x-1") };
      expect(claveDeIdempotenciaDeComprobante(EMPRESA, a, EMISOR_1, "FACTURA_B")).toEqual(
        claveDeIdempotenciaDeComprobante(EMPRESA, b, EMISOR_1, "FACTURA_B"),
      );
    }
  });

  it("el mismo id con otro tipo de origen NO colisiona, para cada par del catálogo", () => {
    for (const tipoA of TIPOS_DE_ORIGEN) {
      for (const tipoB of TIPOS_DE_ORIGEN) {
        if (tipoA === tipoB) continue;
        const a: OrigenDeComprobante = { tipo: tipoA, id: origenId("x-1") };
        const b: OrigenDeComprobante = { tipo: tipoB, id: origenId("x-1") };
        expect(claveDeIdempotenciaDeComprobante(EMPRESA, a, EMISOR_1, "FACTURA_B")).not.toEqual(
          claveDeIdempotenciaDeComprobante(EMPRESA, b, EMISOR_1, "FACTURA_B"),
        );
      }
    }
  });

  it("un origen MANUAL arma su clave igual que uno de ticket, sin ramificar por el tipo", () => {
    const manual: OrigenDeComprobante = { tipo: "MANUAL", id: origenId("clave-del-cliente") };
    const clave = claveDeIdempotenciaDeComprobante(EMPRESA, manual, EMISOR_1, "FACTURA_C");
    expect(clave).toEqual({
      empresaId: EMPRESA,
      origenTipo: "MANUAL",
      origenId: origenId("clave-del-cliente"),
      emisorId: EMISOR_1,
      clase: "FACTURA",
    });
    expect(Object.keys(clave).sort()).toEqual(
      Object.keys(claveDeIdempotenciaDeComprobante(EMPRESA, origen, EMISOR_1, "FACTURA_C")).sort(),
    );
  });
});
