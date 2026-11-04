import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  accionDeImprimirDelDetalle,
  type DetalleParaMostrar,
} from "../../apps/web/ui/plantillas/facturacion/modelo-del-detalle";
import { PantallaDeDetalleDeComprobante } from "../../apps/web/ui/plantillas/facturacion/PantallaDeDetalleDeComprobante";
import { base, con, nota, pintar, visible } from "../utilidades/detalle-de-comprobante";

/**
 * Contrato de la pantalla 2 (detalle de un comprobante), en las dos direcciones: está todo lo que el contrato pide y no
 * aparece nada de lo que quedó afuera (acciones, origen, ambiente, «acreditad», reserva y folio, QR…).
 *
 * «Imprimir» entra en el Detalle por D-97 (el dueño, 2026-11-04; contratos de pantalla, Pedernal-docs): solo en un comprobante Autorizado,
 * como enlace a la vista previa. Sigue afuera todo lo demás que ofrecía otra acción: «Enviar por mail» (D-97), «Exportar» y el alta de
 * cliente. La página decide si ofrece «Imprimir» (`accionDeImprimirDelDetalle`); sin esa acción la pantalla no lleva ningún botón ni enlace.
 */

describe("prueba de contrato: lo que está y lo que no está", () => {
  const PROHIBIDOS = [
    /enviar/i,
    /mail/i,
    /exportar/i,
    // Sin la prop `imprimir` la página no lo ofrece: el texto no aparece (con la acción, solo en el bloque de D-97 de abajo).
    /imprimir/i,
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
      "Autorizada",
      "Anulación parcial",
      "Fecha",
      "14/10/2026",
      "CAE",
      "74123456789012 · vence 24/10/2026",
      "Cliente",
      "Panadería Sol SRL",
      "CUIT 30-71234567-8",
      "Punto de venta",
      "00001",
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

  it("el cuerpo no trae h1 propio: el único es el de la pantalla", () => {
    for (const v of [completo, base, con({ estado: "RECHAZADO", numero: null })])
      expect(pintar(v), v.estado).not.toMatch(/<h1\b/);
  });

  it("no autorizado: ni CAE ni su rótulo", () => {
    const texto = visible(con({ estado: "RECHAZADO", numero: null }));
    expect(texto).not.toMatch(/CAE|vence|74123456789012/);
  });
});

describe("«Imprimir» en el Detalle (D-97): solo en un comprobante Autorizado", () => {
  const ESTADOS = [
    "AUTORIZADO",
    "PENDIENTE",
    "EN_VALIDACION",
    "RECHAZADO",
    "INCIERTO",
    "CONFLICTO",
    "DESCARTADO",
  ] as const;
  const conLaAccion = (v: DetalleParaMostrar): string =>
    renderToStaticMarkup(
      createElement(PantallaDeDetalleDeComprobante, {
        detalle: v,
        imprimir: accionDeImprimirDelDetalle({}, { id: "c1", estado: v.estado }),
      }),
    );
  const ofrecido = (html: string): boolean => /<a\b[^>]*>Imprimir<\/a>/.test(html);

  it.each(ESTADOS)("%s: se ofrece solo si está Autorizado", (estado) => {
    const html = conLaAccion(con({ estado }));
    expect(ofrecido(html), estado).toBe(estado === "AUTORIZADO");
  });

  it("en un Autorizado es un enlace a la vista previa del comprobante, y sigue sin haber mail, exportar ni alta de cliente", () => {
    const html = conLaAccion(base);
    expect(html).toContain('href="/facturacion/comprobantes/c1/imprimir"');
    const texto = html.replace(/<[^>]+>/g, " ");
    for (const prohibido of [/mail/i, /enviar/i, /exportar/i, /nuevo cliente|alta de cliente/i])
      expect(texto).not.toMatch(prohibido);
    expect(html).not.toMatch(/<(button|form|input|select|textarea)\b/);
  });

  it("una nota de crédito Autorizada también se imprime", () => {
    expect(ofrecido(conLaAccion(con({ tipo: "NOTA_CREDITO_B" })))).toBe(true);
  });
});
