import { describe, expect, it } from "vitest";
import { CATALOGO_DE_TEXTOS } from "../vocabulario/catalogo";
import { CODIGOS_PUBLICOS, errorDeCodigo } from "./respuesta";
import { CLAVES_DE_ERRORES_DE_VENTAS } from "./respuesta-de-ventas";

/**
 * Los códigos públicos de ventas: el genérico aprobado (30/10/2026, «Interfaz sobria») y «Primero acreditá la factura…» (DDD:171 c). Previene: que un código de ventas salga con el texto de otro, sin texto, o que alguien sume
 * un texto específico sin que el dueño lo haya aprobado (la lista exacta falla).
 */
describe("códigos públicos de ventas", () => {
  it("son exactamente estos, con su texto exacto", () => {
    expect(CLAVES_DE_ERRORES_DE_VENTAS).toEqual({
      VENTAS_ACCION_NO_PERMITIDA: "ventas.error.accion_no_permitida",
      VENTAS_TICKET_CON_FACTURA_VIGENTE: "ventas.error.ticket_con_factura_vigente",
      VENTAS_VENTA_A_CERO_A_CUENTA: "ventas.error.venta_a_cero_a_cuenta",
    });
    expect(CATALOGO_DE_TEXTOS["ventas.error.venta_a_cero_a_cuenta"].porDefecto).toBe(
      "No se puede cargar a cuenta una venta de $0.",
    );
    expect(CATALOGO_DE_TEXTOS["ventas.error.ticket_con_factura_vigente"].porDefecto).toBe(
      "Primero acreditá la factura con una nota de crédito",
    );
    expect(CATALOGO_DE_TEXTOS["ventas.error.accion_no_permitida"].porDefecto).toBe(
      "Esta acción no está permitida",
    );
  });

  it("el de la factura vigente está en la tabla pública como aviso con su clave", () => {
    expect(errorDeCodigo("VENTAS_TICKET_CON_FACTURA_VIGENTE")).toEqual({
      codigo: "VENTAS_TICKET_CON_FACTURA_VIGENTE",
      clave: "ventas.error.ticket_con_factura_vigente",
      presentacion: "AVISO",
    });
  });

  it("el genérico está en la tabla pública como aviso de estado 422 y con su clave", () => {
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
