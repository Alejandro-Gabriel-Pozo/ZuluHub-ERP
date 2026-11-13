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

describe("traducirErrorDeCatalogo: precios (A1, T3)", () => {
  it("PRECIO_INVALIDO sale con su texto propio, asociado al campo precio", () => {
    expect(traducirErrorDeCatalogo("PRECIO_INVALIDO")).toEqual({
      codigo: "CATALOGO_PRECIO_INVALIDO",
      campo: "precio",
    });
  });

  it("el precio que otra persona cambió antes sale con el importe vigente y nada más (ni el id de la fila)", () => {
    expect(
      traducirErrorDeCatalogo({
        error: "PRECIO_DESACTUALIZADO",
        vigente: { precioId: "00000000-0000-4000-8000-000000000001", precio: "13000.000000" },
      }),
    ).toEqual({
      codigo: "CATALOGO_PRECIO_DESACTUALIZADO",
      campo: "precio",
      parametros: { importe: "13000.000000" },
    });
  });

  it.each([
    ["sin precio vigente (la fila vigente era un precio abierto)", { precioId: "x", precio: null }],
    ["sin fila vigente", null],
    ["un vigente que no es un objeto", "13000"],
    ["un vigente ausente", undefined],
    ["un vigente numérico", 13000],
    // Algo que no es un objeto pero trae la propiedad `precio` (una función): no es la forma pedida, así que no se arriesga.
    [
      "un vigente que es una función con la propiedad precio",
      Object.assign(() => 0, { precio: "13000.000000" }),
    ],
  ])("PRECIO_DESACTUALIZADO %s sale como el genérico", (_caso, vigente) => {
    expect(traducirErrorDeCatalogo({ error: "PRECIO_DESACTUALIZADO", vigente })).toEqual({
      codigo: "CATALOGO_ACCION_NO_PERMITIDA",
    });
  });

  it("el nombre solo, como texto, también es el genérico; los demás errores del precio, igual", () => {
    for (const error of [
      "PRECIO_DESACTUALIZADO",
      "ID_REUTILIZADO",
      "PRECIO_DE_PRODUCTO_CON_VARIANTE",
      "PRODUCTO_NO_VENDIBLE",
      "SUCURSAL_FUERA_DE_ALCANCE",
    ]) {
      expect(traducirErrorDeCatalogo(error)).toEqual({ codigo: "CATALOGO_ACCION_NO_PERMITIDA" });
    }
  });

  it("un objeto con otro error de negocio y un vigente no filtra el precio", () => {
    expect(
      traducirErrorDeCatalogo({ error: "OTRO", vigente: { precioId: "x", precio: "1.000000" } }),
    ).toEqual({ codigo: "CATALOGO_ACCION_NO_PERMITIDA" });
  });
});
