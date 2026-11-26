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
 * Los textos del archivo de la cuenta corriente: ninguno inventado. Lo que compras ya tiene aprobado se reutiliza; lo demás sale con su código estable. Previene: un encabezado escrito a mano que
 * nadie aprobó y una columna que cambia de nombre entre exportaciones.
 */
describe("los textos de la exportación de la cuenta corriente", () => {
  const r = rotulosDeLaExportacionDeCuentaCorriente();

  it("las cinco columnas que compras ya tiene aprobadas salen con su texto y las demás con su código", () => {
    expect(r.columnas.fecha_de_negocio).toBe("Fecha de negocio");
    expect(r.columnas.moneda).toBe("Moneda");
    expect(r.columnas.sucursal).toBe("Sucursal");
    expect(r.columnas.medio_de_pago).toBe("Medio de pago");
    expect(r.columnas.estado).toBe("Estado");
    const conTexto = new Set(["fecha_de_negocio", "moneda", "sucursal", "medio_de_pago", "estado"]);
    for (const c of COLUMNAS_DE_LA_EXPORTACION) {
      if (!conTexto.has(c)) expect(r.columnas[c]).toBe(c);
    }
    expect(Object.keys(r.columnas)).toEqual([...COLUMNAS_DE_LA_EXPORTACION]);
  });

  it("los tramos y los orígenes salen con su código; el estado anulado con el texto aprobado y el vigente con su código", () => {
    for (const t of TRAMOS_DE_ANTIGUEDAD) expect(r.tramos[t]).toBe(t);
    for (const o of ORIGENES_DE_LA_EXPORTACION) expect(r.origenes[o]).toBe(o);
    expect(r.estados).toEqual({ VIGENTE: "VIGENTE", ANULADO: "Anulado" });
    expect([r.si, r.no]).toEqual(["SI", "NO"]);
    expect(r.clases).toEqual({});
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

  it("el nombre del archivo lleva el código y el día", () => {
    expect(r.hoja).toBe("cuenta_corriente");
    expect(nombreDelArchivoDeCuentaCorriente("2026-11-26")).toBe(
      "cuenta_corriente_2026-11-26.xlsx",
    );
  });
});
