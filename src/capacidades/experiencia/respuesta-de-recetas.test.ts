import { describe, expect, it } from "vitest";
import { CATALOGO_DE_TEXTOS } from "../vocabulario/catalogo";
import { CODIGOS_PUBLICOS, errorDeCodigo } from "./respuesta";
import { CLAVES_DE_ERRORES_DE_RECETAS } from "./respuesta-de-recetas";

/**
 * El código público de la pantalla de Recetas: uno solo, el genérico, con SU clave del catálogo (texto ya aprobado) y mostrado como un aviso. Previene: que el rechazo de una receta salga
 * con el texto de otro módulo, sin texto o como un fallo inesperado.
 */
describe("códigos públicos de la pantalla de Recetas", () => {
  it("es exactamente este, con su texto exacto", () => {
    expect(CLAVES_DE_ERRORES_DE_RECETAS).toEqual({
      RECETA_ACCION_NO_PERMITIDA: "receta.error.accion_no_permitida",
    });
    expect(CATALOGO_DE_TEXTOS["receta.error.accion_no_permitida"].porDefecto).toBe(
      "Esta acción no está permitida",
    );
  });

  it("figura en la tabla de códigos públicos como un aviso", () => {
    expect(CODIGOS_PUBLICOS.RECETA_ACCION_NO_PERMITIDA).toEqual({
      clave: "receta.error.accion_no_permitida",
      presentacion: "AVISO",
      estadoHttp: 422,
    });
  });

  it("errorDeCodigo lo arma sin campo ni parámetros", () => {
    expect(errorDeCodigo("RECETA_ACCION_NO_PERMITIDA")).toMatchObject({
      codigo: "RECETA_ACCION_NO_PERMITIDA",
      clave: "receta.error.accion_no_permitida",
    });
  });
});
