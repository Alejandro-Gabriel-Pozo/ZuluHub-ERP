import { describe, expect, it } from "vitest";
import { CATALOGO_DE_TEXTOS } from "../vocabulario/catalogo";
import { CODIGOS_PUBLICOS, errorDeCodigo } from "./respuesta";
import { CLAVES_DE_ERRORES_DE_VENTAS } from "./respuesta-de-ventas";

/**
 * El código público de ventas: uno solo, el genérico aprobado (30/10/2026, «Interfaz sobria»). Previene: que un código de ventas salga con el texto de otro, sin texto, o que alguien sume
 * un texto específico sin que el dueño lo haya aprobado (la lista exacta falla).
 */
describe("códigos públicos de ventas", () => {
  it("son exactamente estos, con su texto exacto", () => {
    expect(CLAVES_DE_ERRORES_DE_VENTAS).toEqual({
      VENTAS_ACCION_NO_PERMITIDA: "ventas.error.accion_no_permitida",
    });
    expect(CATALOGO_DE_TEXTOS["ventas.error.accion_no_permitida"].porDefecto).toBe(
      "Esta acción no está permitida",
    );
  });

  it("está en la tabla pública como aviso de estado 422 y con su clave", () => {
    expect(CODIGOS_PUBLICOS.VENTAS_ACCION_NO_PERMITIDA).toEqual({
      clave: "ventas.error.accion_no_permitida",
      presentacion: "AVISO",
      estadoHttp: 422,
    });
    expect(errorDeCodigo("VENTAS_ACCION_NO_PERMITIDA")).toEqual({
      codigo: "VENTAS_ACCION_NO_PERMITIDA",
      clave: "ventas.error.accion_no_permitida",
      presentacion: "AVISO",
    });
  });
});
