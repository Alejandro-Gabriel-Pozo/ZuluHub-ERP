import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import {
  TIPOS_DE_COMPROBANTE,
  claseDeComprobante,
  letraDeComprobante,
  type ClaseDeComprobante,
} from "./comprobante-emitido";
import { CONDICIONES_DE_IVA_DEL_RECEPTOR } from "./condicion-iva-receptor";
import { CONDICIONES_DE_IVA } from "./emisor";
import { letraParaFactura, tipoDeComprobante } from "./letra-de-comprobante";

/** Receptores que admiten la clase A según WSFE v4.8 (l. 5718-5727), por su nombre. */
const RECEPTORES_DE_A = [
  "RESPONSABLE_INSCRIPTO",
  "MONOTRIBUTO",
  "MONOTRIBUTISTA_SOCIAL",
  "MONOTRIBUTO_TRABAJADOR_INDEPENDIENTE_PROMOVIDO",
];

describe("letraParaFactura (spec H7 facturación §B.3.1)", () => {
  it("un responsable inscripto factura A a quien admite A y B a todos los demás", () => {
    for (const receptor of CONDICIONES_DE_IVA_DEL_RECEPTOR) {
      expect(letraParaFactura("RESPONSABLE_INSCRIPTO", receptor)).toBe(
        RECEPTORES_DE_A.includes(receptor) ? "A" : "B",
      );
    }
  });

  it("un monotributista factura siempre C, a cualquiera de las once condiciones", () => {
    for (const receptor of CONDICIONES_DE_IVA_DEL_RECEPTOR) {
      expect(letraParaFactura("MONOTRIBUTO", receptor)).toBe("C");
    }
  });

  it("un emisor exento factura C (NO VERIFICADO: el manual no lo dice; pregunta C7 al contador)", () => {
    for (const receptor of CONDICIONES_DE_IVA_DEL_RECEPTOR) {
      expect(letraParaFactura("EXENTO", receptor)).toBe("C");
    }
  });

  it("casos concretos", () => {
    expect(letraParaFactura("RESPONSABLE_INSCRIPTO", "CONSUMIDOR_FINAL")).toBe("B");
    expect(letraParaFactura("RESPONSABLE_INSCRIPTO", "RESPONSABLE_INSCRIPTO")).toBe("A");
    expect(letraParaFactura("RESPONSABLE_INSCRIPTO", "EXENTO")).toBe("B");
    expect(letraParaFactura("RESPONSABLE_INSCRIPTO", "IVA_LIBERADO_LEY_19640")).toBe("B");
  });

  it("propiedad: la letra es siempre una de las tres y C solo si el emisor no es inscripto", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CONDICIONES_DE_IVA),
        fc.constantFrom(...CONDICIONES_DE_IVA_DEL_RECEPTOR),
        (emisor, receptor) => {
          const letra = letraParaFactura(emisor, receptor);
          expect(["A", "B", "C"]).toContain(letra);
          expect(letra === "C").toBe(emisor !== "RESPONSABLE_INSCRIPTO");
        },
      ),
    );
  });
});

describe("tipoDeComprobante", () => {
  it("compone clase y letra", () => {
    expect(tipoDeComprobante("FACTURA", "A")).toBe("FACTURA_A");
    expect(tipoDeComprobante("NOTA_CREDITO", "B")).toBe("NOTA_CREDITO_B");
    expect(tipoDeComprobante("NOTA_DEBITO", "C")).toBe("NOTA_DEBITO_C");
  });

  it("es la inversa de claseDeComprobante y letraDeComprobante en los nueve tipos", () => {
    for (const tipo of TIPOS_DE_COMPROBANTE) {
      expect(tipoDeComprobante(claseDeComprobante(tipo), letraDeComprobante(tipo))).toBe(tipo);
    }
    const clases: ClaseDeComprobante[] = ["FACTURA", "NOTA_CREDITO", "NOTA_DEBITO"];
    const compuestos = clases.flatMap((c) =>
      (["A", "B", "C"] as const).map((l) => tipoDeComprobante(c, l)),
    );
    expect(new Set(compuestos).size).toBe(9);
  });
});
