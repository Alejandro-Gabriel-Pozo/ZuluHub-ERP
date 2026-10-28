import { describe, expect, it } from "vitest";
import type { DetalleParaMostrar } from "../../apps/web/ui/plantillas/facturacion/modelo-del-detalle";
import { base, con, nota, pintar, visible } from "../utilidades/detalle-de-comprobante";

/**
 * Contrato de la pantalla 2 (detalle de un comprobante), en las dos direcciones: está todo lo que el contrato pide y no
 * aparece nada de lo que quedó afuera (acciones, origen, ambiente, «acreditad», reserva y folio, QR…).
 */

describe("prueba de contrato: lo que está y lo que no está", () => {
  const PROHIBIDOS = [
    /imprimir/i,
    /enviar/i,
    /mail/i,
    /exportar/i,
    /\bQR\b/,
    /anular/i,
    /descartar/i,
    /reintentar/i,
    /Resincronizar/,
    /reserva y folio/i,
    /acreditad/i,
    /origen/i,
    /ambiente/i,
    /homologaci/i,
    /volver/i,
    /corregir/i,
  ];
  const completo = con({
    acreditado: "4500.00",
    acreditacion: "PARCIAL",
    notasQueLoCitan: [nota("n1", "AUTORIZADO", "4500.00")],
    receptor: { nombre: "Panadería Sol SRL", documento: { tipo: "CUIT", numero: "30712345678" } },
  });

  it("la factura autorizada trae todo lo del contrato", () => {
    const texto = visible(completo);
    for (const esperado of [
      "Factura B 00001-00001234",
      "Autorizada",
      "Anulación parcial",
      "Número",
      "Fecha",
      "14/10/2026",
      "CAE",
      "74123456789012 · vence 24/10/2026",
      "Cliente",
      "Panadería Sol SRL",
      "CUIT 30-71234567-8",
      "Punto de venta",
      "0001",
      "Renglones",
      "Medialunas (docena)",
      "2 × $ 4.500,00",
      "IVA 21 %",
      "$ 9.000,00",
      "Total",
      "Ya anulado con notas de crédito",
      "Nota de crédito B 00001-00000045",
    ]) {
      expect(texto, esperado).toContain(esperado);
    }
  });

  it("en ningún estado ni tipo aparece algo de lo que quedó afuera, ni un botón o enlace", () => {
    const variantes: DetalleParaMostrar[] = [
      completo,
      base,
      con({ acreditacion: "TOTAL", acreditado: "9000.00" }),
      ...(
        ["PENDIENTE", "EN_VALIDACION", "RECHAZADO", "INCIERTO", "CONFLICTO", "DESCARTADO"] as const
      ).map((estado) =>
        con({
          estado,
          motivoDeDescarte: "Duplicada",
          ultimoIntento: { mensajes: [{ clave: "fiscal.arca.receptor_para_a" }] },
        }),
      ),
      con({
        tipo: "NOTA_CREDITO_B",
        asociado: { tipo: "FACTURA_B", numero: "00001-00000042", fecha: "2026-10-14" },
      }),
    ];
    for (const v of variantes) {
      const html = pintar(v);
      // «Pendiente de enviar» es el texto del estado (D-25), no la acción de enviar por mail.
      const texto = visible(v).replace("Pendiente de enviar", "");
      for (const prohibido of PROHIBIDOS)
        expect(texto, `${v.estado} ${prohibido}`).not.toMatch(prohibido);
      expect(html, v.estado).not.toMatch(/<(button|a|form|input|select|textarea)\b/);
      expect(html, v.estado).not.toMatch(/\sstyle=/);
    }
  });

  it("no autorizado: ni CAE ni su rótulo", () => {
    const texto = visible(con({ estado: "RECHAZADO", numero: null }));
    expect(texto).not.toMatch(/CAE|vence|74123456789012/);
  });
});
