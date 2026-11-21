import { describe, expect, it } from "vitest";
import { CODIGOS_PUBLICOS } from "../capacidades/experiencia/respuesta";
import { traducirErrorDeReceta } from "./errores-de-recetas";

const GENERICO = { codigo: "RECETA_ACCION_NO_PERMITIDA" };

describe("traducirErrorDeReceta", () => {
  it.each([
    "COMPOSICION_DESACTUALIZADA",
    "PERDIDA_INVALIDA",
    "COMPONENTE_ES_INSUMO",
    "PRODUCTO_INACTIVO",
    "COMPONENTE_NO_CONTROLADO",
    "PRODUCTO_NO_LLEVA_RECETA",
    "PRODUCTO_NO_ENCONTRADO",
    "CICLO_EN_LA_RECETA",
    "RECETA_DEMASIADO_ANIDADA",
    "CANTIDAD_INVALIDA",
    "RINDE_INVALIDO",
    "COMPOSICION_VACIA",
    "COMPONENTE_REPETIDO",
    "DIMENSION_DISTINTA",
    "CONVERSION_NO_EXACTA",
    "IDENTIFICADOR_INVALIDO",
    "SUCURSAL_FUERA_DE_ALCANCE",
  ])("%s sale como el genérico", (error) => {
    expect(traducirErrorDeReceta(error)).toEqual(GENERICO);
  });

  it("la perilla del plan apagada (con forma de objeto) sale como el genérico, sin la perilla", () => {
    expect(
      traducirErrorDeReceta({ error: "FUNCION_NO_INCLUIDA", perilla: "composiciones_con_perdida" }),
    ).toEqual(GENERICO);
    expect(
      traducirErrorDeReceta({ error: "FUNCION_NO_INCLUIDA", perilla: "subcomposiciones" }),
    ).toEqual(GENERICO);
  });

  it.each(Object.keys(CODIGOS_PUBLICOS))(
    "el código público %s (el guard, la sesión, otros módulos) pasa sin cambios",
    (codigo) => {
      expect(traducirErrorDeReceta(codigo)).toBe(codigo);
    },
  );

  it("un nombre heredado de Object.prototype no se confunde con un error conocido", () => {
    for (const error of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
      expect(traducirErrorDeReceta(error)).toBe(error);
    }
  });

  it("un objeto que se convierte en el nombre de un error conocido no se confunde con él", () => {
    const falso = { toString: () => "PERDIDA_INVALIDA" };
    expect(traducirErrorDeReceta(falso)).toBe(falso);
  });

  it("lo que no es de la receta pasa sin cambios: la base, la empresa que no opera y los errores de otros módulos", () => {
    for (const error of [
      "ERROR_DE_LA_BASE_NO_TRADUCIDO",
      "DEPOSITO_NO_ENCONTRADO",
      { codigo: "EMPRESA_NO_OPERA", motivo: "EMPRESA_SUSPENDIDA" },
      { tipo: "Inesperado", mensaje: "boom" },
      { error: "OTRO_ERROR_CON_FORMA_DE_OBJETO" },
      { error: 7 },
      7,
      null,
      undefined,
    ]) {
      expect(traducirErrorDeReceta(error)).toBe(error);
    }
  });
});
