import { describe, expect, it } from "vitest";
import { CATALOGO_DE_TEXTOS } from "../vocabulario/catalogo";
import { CODIGOS_PUBLICOS } from "./respuesta";
import { CLAVES_DE_ERRORES_DE_CIERRE } from "./respuesta-de-cierre";

/**
 * Los dos códigos públicos del cierre del día (DDD:123, 14/11/2026): el aviso propio «Cambió algo mientras mirabas…» y el genérico. Los demás errores del cierre salen por el genérico:
 * no hay un texto por regla. Previene: que alguien sume un código con un texto que el dueño no aprobó.
 */
describe("códigos públicos del cierre", () => {
  it("son exactamente dos, cada uno con su clave de texto", () => {
    expect(CLAVES_DE_ERRORES_DE_CIERRE).toEqual({
      CIERRE_CONTROLES_CAMBIARON: "cierre.error.controles_cambiaron",
      CIERRE_ACCION_NO_PERMITIDA: "cierre.error.accion_no_permitida",
    });
  });

  it("entran en la tabla de códigos como avisos, con el texto aprobado y el estado HTTP de un rechazo de negocio", () => {
    for (const [codigo, clave] of Object.entries(CLAVES_DE_ERRORES_DE_CIERRE)) {
      expect(CODIGOS_PUBLICOS[codigo as keyof typeof CLAVES_DE_ERRORES_DE_CIERRE]).toEqual({
        clave,
        presentacion: "AVISO",
        estadoHttp: 422,
      });
    }
    expect(CATALOGO_DE_TEXTOS["cierre.error.controles_cambiaron"].porDefecto).toBe(
      "Cambió algo mientras mirabas. Revisá y volvé a cerrar",
    );
    expect(CATALOGO_DE_TEXTOS["cierre.error.accion_no_permitida"].porDefecto).toBe(
      "Esta acción no está permitida",
    );
  });
});
