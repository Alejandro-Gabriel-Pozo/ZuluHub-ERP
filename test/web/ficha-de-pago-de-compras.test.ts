import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { PERMISOS_DE_COMPRAS } from "../../src/capacidades/permisos/permisos-de-compras";
import {
  FICHA_DE_PAGO_DE_COMPRAS,
  type FichaDePagoDeCompras,
} from "../../src/capacidades/pantallas/ficha-de-pago-de-compras";
import { CATALOGO_DE_TEXTOS } from "../../src/capacidades/vocabulario/catalogo";

/**
 * La ficha de «Declarar pago» y de anular el pago de una factura no se desfasa de la realidad: sus archivos existen, sus textos están en el catálogo con usos y fuente de dueño, las acciones de sus botones existen en
 * el módulo y son de gerente y administrador. Previene: un botón o un texto que nadie aprobó y un permiso que se mueve sin que la ficha lo note.
 */
const FICHA: FichaDePagoDeCompras = FICHA_DE_PAGO_DE_COMPRAS;

describe("ficha de «Declarar pago» y anular el pago de una factura", () => {
  it("sus archivos existen", () => {
    for (const archivo of FICHA.archivos) expect(() => readFileSync(archivo)).not.toThrow();
  });

  it("todo texto de un botón está declarado con usos y fuente de dueño, y cada clave existe en el catálogo", () => {
    for (const b of FICHA.botones) expect(Object.keys(FICHA.textos)).toContain(b.texto);
    for (const [clave, t] of Object.entries(FICHA.textos)) {
      expect(Object.keys(CATALOGO_DE_TEXTOS)).toContain(clave);
      expect(t.usos.length).toBeGreaterThan(0);
      expect(t.fuente.decidio).toMatch(/dueño/);
      expect(t.fuente.donde).toMatch(/Pedernal-docs/);
    }
  });

  it("el único texto nuevo es «Declarar pago», el que eligió el dueño, con su decisión", () => {
    expect(CATALOGO_DE_TEXTOS["compras.pago.declarar"].porDefecto).toBe("Declarar pago");
    expect(CATALOGO_DE_TEXTOS["compras.pago.declarar"].fuente).toEqual({ decision: "DEC-0891" });
  });

  it("las acciones que envían existen en el módulo y son de gerente y administrador, nunca de quien opera; sin permiso ningún botón se dibuja", () => {
    const todas = Object.values(CATALOGO_DE_MODULOS).flatMap((m) => Object.keys(m.acciones));
    for (const accion of FICHA.acciones) expect(todas).toContain(accion);
    expect(PERMISOS_DE_COMPRAS["comprobantes_de_proveedor.pagar"]).toEqual([
      "GERENTE",
      "ADMINISTRADOR",
    ]);
    expect(PERMISOS_DE_COMPRAS["comprobantes_de_proveedor.anular_pago"]).toEqual([
      "GERENTE",
      "ADMINISTRADOR",
    ]);
    const enviadas = FICHA.botones.flatMap((b) => ("envia" in b.hace ? [b.hace.envia] : []));
    expect(enviadas.sort()).toEqual([
      "comprobantes_de_proveedor.anular_pago",
      "comprobantes_de_proveedor.pagar",
    ]);
    for (const b of FICHA.botones) expect(b.sinPermiso).toBe("AUSENTE");
  });

  it("los dos estados de error son el mensaje genérico", () => {
    expect(FICHA.estados).toEqual({ ERROR: "GENERICO", SIN_PERMISO: "GENERICO" });
  });
});
