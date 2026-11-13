import { describe, expect, it } from "vitest";
import { CODIGOS_PUBLICOS } from "../capacidades/experiencia/respuesta";
import { traducirErrorDeCatalogo } from "./errores-de-catalogo";

describe("traducirErrorDeCatalogo", () => {
  it.each([
    ["PRODUCTO_DUPLICADO", "CATALOGO_NOMBRE_REPETIDO", "nombre"],
    ["CODIGO_DUPLICADO", "CATALOGO_CODIGO_REPETIDO", "codigo"],
    ["CODIGO_DE_BARRAS_INVALIDO", "CATALOGO_CODIGO_DE_BARRAS_INVALIDO", "codigoDeBarras"],
    ["ALICUOTA_REQUERIDA", "CATALOGO_ELEGI_LA_ALICUOTA", "alicuota"],
  ])("%s sale como %s, asociado al campo %s", (error, codigo, campo) => {
    expect(traducirErrorDeCatalogo(error)).toEqual({ codigo, campo });
  });

  it.each([
    "VERSION_DESACTUALIZADA",
    "PRODUCTO_NO_ENCONTRADO",
    "PRODUCTO_INACTIVO",
    "NOMBRE_DE_PRODUCTO_INVALIDO",
    "NOMBRE_DE_COCINA_INVALIDO",
    "DESCRIPCION_INVALIDA",
    "CODIGO_INVALIDO",
    "ALICUOTA_INVALIDA",
    "SECCION_NO_ENCONTRADA",
    "CODIGO_DE_BARRAS_DUPLICADO",
    "SUCURSAL_FUERA_DE_ALCANCE",
    "cualquier otro texto del módulo",
  ])("%s, y todo otro error de negocio del módulo, sale como el genérico", (error) => {
    expect(traducirErrorDeCatalogo(error)).toEqual({ codigo: "CATALOGO_ACCION_NO_PERMITIDA" });
  });

  it("un dato que la clase no admite (con forma de objeto) sale como el genérico, sin el campo", () => {
    expect(
      traducirErrorDeCatalogo({ error: "CAMPO_NO_ADMITIDO_POR_LA_CLASE", campo: "alicuota" }),
    ).toEqual({ codigo: "CATALOGO_ACCION_NO_PERMITIDA" });
  });

  it("un nombre heredado de Object.prototype no se confunde con un error conocido", () => {
    for (const error of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
      expect(traducirErrorDeCatalogo(error)).toEqual({ codigo: "CATALOGO_ACCION_NO_PERMITIDA" });
    }
  });

  it.each(Object.keys(CODIGOS_PUBLICOS))(
    "el código público %s (el guard, la sesión, otros módulos) pasa sin cambios",
    (codigo) => {
      expect(traducirErrorDeCatalogo(codigo)).toBe(codigo);
    },
  );

  it("el defecto de la base y lo que no es del módulo pasan sin cambios (salen como inesperados)", () => {
    for (const error of [
      "ERROR_DE_LA_BASE_NO_TRADUCIDO",
      { codigo: "EMPRESA_NO_OPERA", motivo: "EMPRESA_SUSPENDIDA" },
      { tipo: "Inesperado", mensaje: "boom" },
      7,
      null,
      undefined,
    ]) {
      expect(traducirErrorDeCatalogo(error)).toBe(error);
    }
  });
});
