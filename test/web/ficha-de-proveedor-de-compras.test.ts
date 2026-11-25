import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { PERMISOS_DE_COMPRAS } from "../../src/capacidades/permisos/permisos-de-compras";
import {
  FICHA_DE_PROVEEDOR_DE_COMPRAS,
  type FichaDeProveedorDeCompras,
} from "../../src/capacidades/pantallas/ficha-de-proveedor-de-compras";
import { CATALOGO_DE_TEXTOS } from "../../src/capacidades/vocabulario/catalogo";

/**
 * La ficha de la pantalla «Proveedor» de compras no se desfasa de la realidad: sus archivos existen, sus textos están en el catálogo con usos y fuente de dueño, y la acción de cada botón existe en el
 * módulo y es de quien dice la maqueta (editar: gerente y administrador; pedir: los tres roles). Previene: un botón o un texto que nadie aprobó, y un permiso que se mueve sin que la ficha lo note.
 */
const FICHA: FichaDeProveedorDeCompras = FICHA_DE_PROVEEDOR_DE_COMPRAS;

describe("ficha de la pantalla «Proveedor» de compras", () => {
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

  it("las acciones de sus botones existen en el módulo, con los roles que dice la maqueta, y sin permiso ninguno se dibuja", () => {
    const todas = Object.values(CATALOGO_DE_MODULOS).flatMap((m) => Object.keys(m.acciones));
    for (const b of FICHA.botones) {
      expect(b.sinPermiso).toBe("AUSENTE");
      if ("envia" in b.hace) expect(todas).toContain(b.hace.envia);
    }
    expect(PERMISOS_DE_COMPRAS["proveedores.editar_ficha"]).toEqual(["GERENTE", "ADMINISTRADOR"]);
    expect(PERMISOS_DE_COMPRAS["proveedores.pedir_ficha"]).toEqual([
      "GERENTE",
      "ADMINISTRADOR",
      "OPERADOR",
    ]);
  });

  it("editar y pedir son botones distintos: ninguno envía la acción del otro", () => {
    const acciones = (ids: readonly string[]) =>
      FICHA.botones
        .filter((b) => ids.includes(b.id))
        .map((b) => ("envia" in b.hace ? b.hace.envia : null));
    expect(
      new Set(
        acciones([
          "agregar-punto-de-venta",
          "agregar-otro-comprobante",
          "dejar-de-usar",
          "aprobar",
          "rechazar",
        ]),
      ),
    ).toEqual(new Set(["proveedores.editar_ficha"]));
    expect(
      new Set(acciones(["pedir-punto-de-venta", "pedir-otro-comprobante", "enviar-pedido"])),
    ).toEqual(new Set(["proveedores.pedir_ficha"]));
  });

  it("los dos estados de error son el mensaje genérico", () => {
    expect(FICHA.estados).toEqual({ ERROR: "GENERICO", SIN_PERMISO: "GENERICO" });
  });
});
