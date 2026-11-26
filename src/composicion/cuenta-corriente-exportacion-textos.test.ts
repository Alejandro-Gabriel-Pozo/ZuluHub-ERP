import { describe, expect, it } from "vitest";
import {
  COLUMNAS_DE_LA_EXPORTACION,
  ORIGENES_DE_LA_EXPORTACION,
  TRAMOS_DE_ANTIGUEDAD,
} from "../modulos/cuenta_corriente/publico";
import {
  nombreDelArchivoDeCuentaCorriente,
  rotulosDeLaExportacionDeCuentaCorriente,
} from "./cuenta-corriente-exportacion-textos";

/**
 * Los textos del archivo de la cuenta corriente: ninguno inventado. Todos salen del catálogo (los diez nuevos, de `DEC-CCL-006`). Previene: un encabezado escrito a mano que nadie aprobó.
 */
describe("los textos de la exportación de la cuenta corriente", () => {
  const r = rotulosDeLaExportacionDeCuentaCorriente();

  it("las columnas salen en el orden de la exportación, con su texto del catálogo", () => {
    expect(Object.keys(r.columnas)).toEqual([...COLUMNAS_DE_LA_EXPORTACION]);
    expect(r.columnas).toEqual({
      cliente: "Cliente",
      cuit: "CUIT",
      fecha_de_negocio: "Fecha de negocio",
      vence_el: "Vence",
      clase: "Movimiento",
      importe_con_signo: "Importe",
      pendiente: "Pendiente",
      moneda: "Moneda",
      antiguedad_en_dias: "Antigüedad (días)",
      tramo_de_antiguedad: "Tramo de antigüedad",
      vencida: "Vencida",
      origen: "Origen del movimiento",
      sucursal: "Sucursal",
      medio_de_pago: "Medio de pago",
      estado: "Estado",
    });
  });

  it("los valores: todos salen del catálogo", () => {
    expect(r.hoja).toBe("Cuenta corriente");
    expect(r.estados).toEqual({ VIGENTE: "Vigente", ANULADO: "Anulado" });
    expect(r.origenes).toEqual({ TICKET: "Ticket", COBRANZA: "Cobranza", OTRO: "Otro" });
    expect(Object.keys(r.origenes)).toEqual([...ORIGENES_DE_LA_EXPORTACION]);
    expect(r.clases).toEqual({ CARGO_DE_VENTA_A_CUENTA: "Venta a cuenta", COBRANZA: "Cobranza" });
    expect(r.tramos).toEqual({
      DE_0_A_30: "0 a 30 días",
      DE_31_A_60: "31 a 60 días",
      DE_61_A_90: "61 a 90 días",
      MAS_DE_90: "Más de 90 días",
    });
    expect(Object.keys(r.tramos)).toEqual([...TRAMOS_DE_ANTIGUEDAD]);
    expect([r.si, r.no]).toEqual(["Sí", "No"]);
  });

  it("los tipos de medio de caja salen con el texto que compras ya usa", () => {
    expect(r.tiposDeMedio).toMatchObject({
      EFECTIVO: "Efectivo",
      TARJETA_DEBITO: "Tarjeta de débito",
      TARJETA_CREDITO: "Tarjeta de crédito",
      TRANSFERENCIA: "Transferencia",
      QR: "QR",
      OTRO: "Otro",
    });
  });

  it("el nombre del archivo sale del texto de la entrada del menú y el día, sin espacios", () => {
    expect(nombreDelArchivoDeCuentaCorriente("2026-11-26")).toBe(
      "cuenta_corriente_2026-11-26.xlsx",
    );
  });
});
