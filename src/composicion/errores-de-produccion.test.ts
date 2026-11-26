import { describe, expect, it } from "vitest";
import { CODIGOS_PUBLICOS } from "../capacidades/experiencia/respuesta";
import { traducirErrorDeProduccion } from "./errores-de-produccion";

const GENERICO = { codigo: "PRODUCCION_ACCION_NO_PERMITIDA" };

describe("traducirErrorDeProduccion", () => {
  it.each([
    "ORDEN_NO_ENCONTRADA",
    "ORDEN_CANCELADA",
    "ORDEN_ANULADA",
    "ORDEN_YA_CERRADA",
    "ORDEN_NO_CERRADA",
    "PRODUCTO_YA_USADO",
    "MOTIVO_REQUERIDO",
    "DEPOSITO_NO_ENCONTRADO",
    "SUCURSAL_FUERA_DE_ALCANCE",
    "cualquier otro texto del módulo",
  ])("%s, y todo otro error de negocio del módulo, sale como el genérico", (error) => {
    expect(traducirErrorDeProduccion(error)).toEqual(GENERICO);
  });

  it("un error de negocio con forma de objeto (el control de stock, la perilla del plan) sale como el genérico, sin el detalle", () => {
    expect(traducirErrorDeProduccion({ error: "CONTROL_BLOQUEA", detalle: [{ x: 1 }] })).toEqual(
      GENERICO,
    );
    expect(
      traducirErrorDeProduccion({ error: "FUNCION_NO_INCLUIDA", perilla: "produccion" }),
    ).toEqual(GENERICO);
  });

  it("abrir con faltante en el nivel AVISAR sale como el aviso de stock (no como fallo), sin el detalle", () => {
    expect(
      traducirErrorDeProduccion({
        error: "CONTROL_REQUIERE_CONFIRMACION",
        control: "stock.existencia_negativa",
        detalle: [{ productoId: "p", depositoId: "d", existenciaResultante: "-1.0000" }],
      }),
    ).toBe("STOCK_CONTROL_AVISA");
    // Cualquier otra cosa con forma de objeto sigue siendo el genérico.
    expect(traducirErrorDeProduccion({ error: "CONTROL_REQUIERE_CONFIRMACIONES" })).toEqual(
      GENERICO,
    );
  });

  it("un nombre heredado de Object.prototype no se confunde con un código conocido", () => {
    for (const error of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
      expect(traducirErrorDeProduccion(error)).toEqual(GENERICO);
    }
  });

  it.each(Object.keys(CODIGOS_PUBLICOS))(
    "el código público %s (el guard, la sesión, otros módulos) pasa sin cambios",
    (codigo) => {
      expect(traducirErrorDeProduccion(codigo)).toBe(codigo);
    },
  );

  it("el código genérico de producción es un código público", () => {
    expect(Object.hasOwn(CODIGOS_PUBLICOS, GENERICO.codigo)).toBe(true);
  });

  it("un defecto de la base sin traducir pasa tal cual: sale como inesperado, con referencia", () => {
    expect(traducirErrorDeProduccion("ERROR_DE_LA_BASE_NO_TRADUCIDO")).toBe(
      "ERROR_DE_LA_BASE_NO_TRADUCIDO",
    );
  });

  it("los errores de la base (con `tipo`) y la empresa que no opera (con `codigo`) pasan sin cambios", () => {
    const base = { tipo: "RESTRICCION", restriccion: "x" };
    expect(traducirErrorDeProduccion(base)).toBe(base);
    const noOpera = { codigo: "EMPRESA_NO_OPERA", motivo: "EMPRESA_SUSPENDIDA" };
    expect(traducirErrorDeProduccion(noOpera)).toBe(noOpera);
  });

  it("lo que no es ni texto ni objeto no se toca", () => {
    expect(traducirErrorDeProduccion(null)).toBeNull();
    expect(traducirErrorDeProduccion(undefined)).toBeUndefined();
    expect(traducirErrorDeProduccion(7)).toBe(7);
  });
});
