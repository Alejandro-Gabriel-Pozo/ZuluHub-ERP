import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DetalleParaMostrar } from "../../apps/web/ui/plantillas/facturacion/modelo-del-detalle";
import { PantallaDeDetalleDeComprobante } from "../../apps/web/ui/plantillas/facturacion/PantallaDeDetalleDeComprobante";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/** Apoyo de las pruebas del detalle de un comprobante: un detalle de ejemplo y cómo se pinta. No es una prueba. */

export const base: DetalleParaMostrar = {
  tipo: "FACTURA_B",
  estado: "AUTORIZADO",
  numero: "00001-00001234",
  fechaEmision: "2026-10-14",
  cae: "74123456789012",
  caeVence: "2026-10-24",
  importes: { total: "9000.00" },
  renglones: [
    {
      descripcion: "Medialunas (docena)",
      cantidad: "2.0000",
      precioUnitario: "4500.000000",
      alicuota: "21",
      importe: "9000.00",
    },
  ],
  emisor: { puntoDeVentaNumero: 1 },
  receptor: { nombre: null, documento: { tipo: "SIN_IDENTIFICAR" } },
  asociado: null,
  motivoDeDescarte: null,
  notasQueLoCitan: [],
  acreditado: "0.00",
  acreditacion: "NINGUNA",
  ultimoIntento: null,
};

export const con = (cambios: Partial<DetalleParaMostrar>): DetalleParaMostrar => ({
  ...base,
  ...cambios,
});
export const pintar = (d: DetalleParaMostrar): string =>
  renderToStaticMarkup(createElement(PantallaDeDetalleDeComprobante, { detalle: d }));
/** El texto visible: sin marcas ni entidades. */
export const visible = (d: DetalleParaMostrar): string =>
  pintar(d)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

export const nota = (
  id: string,
  estado: DetalleParaMostrar["estado"],
  total: string,
  tipo: DetalleParaMostrar["tipo"] = "NOTA_CREDITO_B",
  numero: string | null = "00001-00000045",
) => ({ id, tipo, numero, total, estado });
