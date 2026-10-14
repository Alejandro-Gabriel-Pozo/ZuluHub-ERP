import {
  CODIGO_DE_MONEDA,
  CODIGO_DE_TIPO_DE_COMPROBANTE,
  CODIGO_DE_TIPO_DE_DOCUMENTO,
  numeroDeDocumentoParaArca,
  type SolicitudDeAutorizacion,
} from "../../modulos/fiscal/publico";
import { importeATexto } from "../../primitivas/dinero/importe";
import { ID_DE_ALICUOTA, ID_DE_CONCEPTO, ID_DE_CONDICION_IVA } from "./codigos";
import type { SolicitudDeWsfe } from "./pedidos-de-wsfe";

/**
 * De un pedido de autorización del dominio a los valores que espera `FECAESolicitar` (spec H7 facturación
 * §B.3.4 y §B.5.1). Valor puro. Los códigos salen de las tablas del dominio de fiscal (tipo de comprobante,
 * tipo de documento, moneda) y de las del adaptador (concepto, condición del receptor, alícuota); los importes
 * y los números pasan a texto desde `bigint`: nunca por `number`.
 */

/** `2026-10-14` a `20261014`, como lo pide ARCA. */
export const fechaParaArca = (fecha: string): string => fecha.replaceAll("-", "");

export function aSolicitudDeWsfe(s: SolicitudDeAutorizacion): SolicitudDeWsfe {
  return {
    puntoDeVenta: s.puntoDeVenta.numero,
    tipoDeComprobante: CODIGO_DE_TIPO_DE_COMPROBANTE[s.tipo],
    concepto: ID_DE_CONCEPTO[s.concepto],
    tipoDeDocumento: CODIGO_DE_TIPO_DE_DOCUMENTO[s.receptor.documento.tipo],
    numeroDeDocumento: String(numeroDeDocumentoParaArca(s.receptor.documento)),
    numero: String(s.numero),
    fecha: fechaParaArca(s.fecha),
    total: importeATexto(s.importes.total),
    noGravado: importeATexto(s.importes.noGravado),
    neto: importeATexto(s.importes.neto),
    exento: importeATexto(s.importes.exento),
    tributos: importeATexto(s.importes.tributos),
    iva: importeATexto(s.importes.iva),
    servicio:
      s.servicio === null
        ? null
        : {
            desde: fechaParaArca(s.servicio.desde),
            hasta: fechaParaArca(s.servicio.hasta),
            vencimientoDePago: fechaParaArca(s.servicio.vencimientoDePago),
          },
    moneda: CODIGO_DE_MONEDA[s.importes.total.moneda],
    condicionIva: ID_DE_CONDICION_IVA[s.receptor.condicionIva],
    asociado:
      s.asociado === null
        ? null
        : {
            tipoDeComprobante: CODIGO_DE_TIPO_DE_COMPROBANTE[s.asociado.tipo],
            puntoDeVenta: s.asociado.puntoDeVenta,
            numero: String(s.asociado.numero),
            cuit: s.asociado.cuit,
            fecha: fechaParaArca(s.asociado.fecha),
          },
    alicuotas: s.importes.alicuotas.map((a) => {
      const id = ID_DE_ALICUOTA[a.alicuota];
      if (id === undefined) {
        // El exento y el no gravado no llevan alícuota en `Iva`: el dominio no las pasa. Si llegara una, es un
        // defecto de quien armó los importes, no algo que ARCA pueda recibir.
        throw new RangeError(`la alícuota ${a.alicuota} no se informa en Iva`);
      }
      return { id, base: importeATexto(a.base), importe: importeATexto(a.iva) };
    }),
  };
}
