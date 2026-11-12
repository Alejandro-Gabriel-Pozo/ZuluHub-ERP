import { describe, expect, it } from "vitest";
import { CATALOGO_DE_TEXTOS } from "../vocabulario/catalogo";
import { CODIGOS_PUBLICOS, errorDeCodigo } from "./respuesta";
import { CLAVES_DE_ERRORES_DE_CAJA } from "./respuesta-de-caja";

/**
 * Los dos códigos de la configuración de caja: cada uno con SU texto del catálogo (aprobado en la maqueta `medios.html`, 09/11/2026) y mostrado como un
 * aviso. Previene: que un código de caja salga con el texto de otro o sin texto.
 */
describe("códigos públicos de la configuración de caja", () => {
  it("son exactamente estos dos, con su texto exacto", () => {
    expect(CLAVES_DE_ERRORES_DE_CAJA).toEqual({
      CAJA_MEDIO_REPETIDO: "caja.error.medio_repetido",
      CAJA_ACCION_NO_PERMITIDA: "caja.error.accion_no_permitida",
    });
    expect(CATALOGO_DE_TEXTOS["caja.error.medio_repetido"].porDefecto).toBe(
      "Ya existe un medio con ese nombre",
    );
    expect(CATALOGO_DE_TEXTOS["caja.error.accion_no_permitida"].porDefecto).toBe(
      "Esta acción no está permitida",
    );
  });

  it.each(Object.entries(CLAVES_DE_ERRORES_DE_CAJA))(
    "%s está en la tabla pública, como aviso de estado 422 y con su clave",
    (codigo, clave) => {
      expect(CODIGOS_PUBLICOS[codigo as keyof typeof CLAVES_DE_ERRORES_DE_CAJA]).toEqual({
        clave,
        presentacion: "AVISO",
        estadoHttp: 422,
      });
      expect(errorDeCodigo(codigo as keyof typeof CLAVES_DE_ERRORES_DE_CAJA)).toEqual({
        codigo,
        clave,
        presentacion: "AVISO",
      });
    },
  );
});
