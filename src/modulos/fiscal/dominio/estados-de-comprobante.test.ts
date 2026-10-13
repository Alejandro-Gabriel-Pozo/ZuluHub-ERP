import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import { fecha } from "../../../../test/utilidades/facturacion";
import {
  ESTADOS_DE_COMPROBANTE_ARCA,
  TRANSICIONES_DE_COMPROBANTE,
  esComprobanteVigente,
  estadoTrasAutorizacion,
  transicionDeComprobanteValida,
  type EstadoDeComprobanteArca,
  type ResultadoDeAutorizacionArca,
} from "./estados-de-comprobante";

type Par = `${EstadoDeComprobanteArca}->${EstadoDeComprobanteArca}`;

/** Oráculo: las filas de la tabla de transiciones de la spec (§B.2.2), una por par permitido. */
const PERMITIDAS: readonly Par[] = [
  "PENDIENTE->EN_VALIDACION", // trabajo de validación
  "EN_VALIDACION->AUTORIZADO", // respuesta A
  "EN_VALIDACION->RECHAZADO", // respuesta R
  "EN_VALIDACION->INCIERTO", // sin respuesta clara
  "EN_VALIDACION->PENDIENTE", // el pedido seguro no salió
  "INCIERTO->AUTORIZADO", // reconciliación: encontrado y coincide
  "INCIERTO->PENDIENTE", // reconciliación: no existe
  "EN_VALIDACION->CONFLICTO", // reconciliación: existe con otros datos
  "INCIERTO->CONFLICTO",
  "PENDIENTE->DESCARTADO", // descartar
  "CONFLICTO->DESCARTADO",
  "CONFLICTO->PENDIENTE", // reintentar con la serie resincronizada
];

describe("estados del comprobante (spec H7 facturación §B.2)", () => {
  it("son siete", () => {
    expect(ESTADOS_DE_COMPROBANTE_ARCA).toEqual([
      "PENDIENTE",
      "EN_VALIDACION",
      "AUTORIZADO",
      "RECHAZADO",
      "INCIERTO",
      "CONFLICTO",
      "DESCARTADO",
    ]);
  });

  it("de los 49 pares, se permiten exactamente los de la tabla de la spec", () => {
    for (const de of ESTADOS_DE_COMPROBANTE_ARCA) {
      for (const a of ESTADOS_DE_COMPROBANTE_ARCA) {
        expect(transicionDeComprobanteValida(de, a), `${de} -> ${a}`).toBe(
          PERMITIDAS.includes(`${de}->${a}`),
        );
      }
    }
    const total = Object.values(TRANSICIONES_DE_COMPROBANTE).reduce((n, a) => n + a.length, 0);
    expect(total).toBe(PERMITIDAS.length);
  });

  it("AUTORIZADO, RECHAZADO y DESCARTADO no salen", () => {
    for (const terminal of ["AUTORIZADO", "RECHAZADO", "DESCARTADO"] as const) {
      expect(TRANSICIONES_DE_COMPROBANTE[terminal]).toEqual([]);
    }
  });

  it("un rechazado no vuelve a pendiente: corregir es un comprobante nuevo", () => {
    expect(transicionDeComprobanteValida("RECHAZADO", "PENDIENTE")).toBe(false);
  });

  it("vigente es todo menos RECHAZADO y DESCARTADO (el índice de identidad)", () => {
    for (const estado of ESTADOS_DE_COMPROBANTE_ARCA) {
      expect(esComprobanteVigente(estado), estado).toBe(
        estado !== "RECHAZADO" && estado !== "DESCARTADO",
      );
    }
  });

  it("propiedad: ningún camino de transiciones sale de un estado terminal", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...ESTADOS_DE_COMPROBANTE_ARCA), { maxLength: 12 }),
        (secuencia) => {
          let actual: EstadoDeComprobanteArca = "PENDIENTE";
          for (const siguiente of secuencia) {
            if (!transicionDeComprobanteValida(actual, siguiente)) continue;
            expect(["AUTORIZADO", "RECHAZADO", "DESCARTADO"]).not.toContain(actual);
            actual = siguiente;
          }
        },
      ),
    );
  });
});

describe("estadoTrasAutorizacion", () => {
  const vence = fecha("2026-10-23");
  const casos: readonly [ResultadoDeAutorizacionArca, EstadoDeComprobanteArca][] = [
    [
      { tipo: "AUTORIZADO", codigo: "70417054367476", vence, fecha: vence, observaciones: [] },
      "AUTORIZADO",
    ],
    [
      { tipo: "RECHAZADO", errores: [{ codigo: 10016, texto: "x" }], observaciones: [] },
      "RECHAZADO",
    ],
    [{ tipo: "INCIERTO", motivo: "tiempo agotado" }, "INCIERTO"],
    [{ tipo: "NO_ENVIADO", motivo: "sin conexión" }, "PENDIENTE"],
  ];

  it.each(casos)("%j deja el comprobante %s", (resultado, esperado) => {
    expect(estadoTrasAutorizacion(resultado)).toBe(esperado);
  });

  it("cada desenlace es una transición válida desde EN_VALIDACION", () => {
    for (const [resultado] of casos) {
      expect(
        transicionDeComprobanteValida("EN_VALIDACION", estadoTrasAutorizacion(resultado)),
      ).toBe(true);
    }
  });
});
