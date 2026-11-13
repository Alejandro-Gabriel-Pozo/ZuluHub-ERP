import { describe, expect, it } from "vitest";
import { CATALOGO_DE_TEXTOS } from "../vocabulario/catalogo";
import { CODIGOS_PUBLICOS, errorDeCodigo } from "./respuesta";
import { CLAVES_DE_ERRORES_DE_CATALOGO } from "./respuesta-de-catalogo";

/**
 * Los códigos de la ficha de datos de un producto: cada uno con SU texto del catálogo (fila «Errores» de «Textos nuevos» de `productos.html`, 09/11/2026) y mostrado como un
 * aviso. Previene: que un código del catálogo salga con el texto de otro o sin texto.
 */
describe("códigos públicos de la ficha de un producto", () => {
  it("son exactamente estos, con su texto exacto", () => {
    expect(CLAVES_DE_ERRORES_DE_CATALOGO).toEqual({
      CATALOGO_NOMBRE_REPETIDO: "catalogo.error.nombre_repetido",
      CATALOGO_CODIGO_REPETIDO: "catalogo.error.codigo_repetido",
      CATALOGO_CODIGO_DE_BARRAS_INVALIDO: "catalogo.error.codigo_de_barras_invalido",
      CATALOGO_ELEGI_LA_ALICUOTA: "catalogo.error.elegi_la_alicuota",
      CATALOGO_FALTA_EL_NOMBRE: "catalogo.error.falta_el_nombre",
      CATALOGO_ACCION_NO_PERMITIDA: "catalogo.error.accion_no_permitida",
    });
    expect(CATALOGO_DE_TEXTOS["catalogo.error.nombre_repetido"].porDefecto).toBe(
      "Ya existe un producto con ese nombre",
    );
    expect(CATALOGO_DE_TEXTOS["catalogo.error.codigo_repetido"].porDefecto).toBe(
      "Ya existe un producto con ese código",
    );
    expect(CATALOGO_DE_TEXTOS["catalogo.error.codigo_de_barras_invalido"].porDefecto).toBe(
      "El código de barras debe tener de 8 a 14 dígitos",
    );
    expect(CATALOGO_DE_TEXTOS["catalogo.error.elegi_la_alicuota"].porDefecto).toBe(
      "Elegí la alícuota",
    );
    expect(CATALOGO_DE_TEXTOS["catalogo.error.falta_el_nombre"].porDefecto).toBe("Falta el nombre");
    expect(CATALOGO_DE_TEXTOS["catalogo.error.accion_no_permitida"].porDefecto).toBe(
      "Esta acción no está permitida",
    );
  });

  it.each(Object.entries(CLAVES_DE_ERRORES_DE_CATALOGO))(
    "%s está en la tabla pública, como aviso de estado 422 y con su clave",
    (codigo, clave) => {
      expect(CODIGOS_PUBLICOS[codigo as keyof typeof CLAVES_DE_ERRORES_DE_CATALOGO]).toEqual({
        clave,
        presentacion: "AVISO",
        estadoHttp: 422,
      });
      expect(errorDeCodigo(codigo as keyof typeof CLAVES_DE_ERRORES_DE_CATALOGO)).toEqual({
        codigo,
        clave,
        presentacion: "AVISO",
      });
    },
  );
});
