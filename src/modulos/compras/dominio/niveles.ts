import type { ClaseDeComprobante, TipoDeComprobanteDeProveedor } from "./comprobante";
import { claseDeTipoDeComprobante } from "./comprobante";

/**
 * Los niveles de operación de las compras (E9 §3.3; D141, S-1): N1 `COMPRA_SIMPLE` (sin factura), N2 `CON_COMPROBANTE`, N3 `RECEPCION_SEPARADA` y N4
 * `TRES_VIAS`. N1 y N2 son el estándar; N3 y N4 se construyen apagados por perilla (T13 y T14). El nivel inicial es N1. Los códigos son los del
 * CHECK de `configuracion_de_compras` (0037).
 */
export const NIVELES_DE_COMPRA = [
  "COMPRA_SIMPLE",
  "CON_COMPROBANTE",
  "RECEPCION_SEPARADA",
  "TRES_VIAS",
] as const;
export type NivelDeCompra = (typeof NIVELES_DE_COMPRA)[number];

export const NIVEL_INICIAL_DE_COMPRA: NivelDeCompra = "COMPRA_SIMPLE";

export function esNivelDeCompra(texto: string): texto is NivelDeCompra {
  return (NIVELES_DE_COMPRA as readonly string[]).includes(texto);
}

/** Los niveles que piden una perilla encendida (la pide el caso de uso con `exigirPerilla`). */
export const PERILLA_DEL_NIVEL: Readonly<Record<NivelDeCompra, string | null>> = {
  COMPRA_SIMPLE: null,
  CON_COMPROBANTE: null,
  RECEPCION_SEPARADA: "recepcion_separada",
  TRES_VIAS: "conciliacion_de_tres_vias",
};

export const CLASES_DE_COMPROBANTE_DE_PROVEEDOR = [
  "SIN_COMPROBANTE",
  "FACTURA",
  "NOTA_DE_DEBITO",
  "NOTA_DE_CREDITO",
] as const;
export type ClaseDeComprobanteDeProveedor = (typeof CLASES_DE_COMPROBANTE_DE_PROVEEDOR)[number];

/** La clase que se guarda: sin tipo no hay comprobante (`SIN_COMPROBANTE`); con tipo, la del tipo. */
export function claseDeComprobante(
  tipo: TipoDeComprobanteDeProveedor | null,
): ClaseDeComprobanteDeProveedor {
  return tipo === null
    ? "SIN_COMPROBANTE"
    : (claseDeTipoDeComprobante(tipo) satisfies ClaseDeComprobante);
}

/**
 * El estado DERIVADO de una compra en N1 y N2 (S-12: la compra no guarda estado). Una compra anulada es `ANULADA`; confirmada con un comprobante
 * registrado, `RECIBIDA_Y_FACTURADA`; en cualquier otro caso (sin comprobante o con el comprobante anulado), `RECIBIDA_SIN_FACTURAR` («Recibida sin facturar»).
 */
export type EstadoDeCompra = "ANULADA" | "RECIBIDA_SIN_FACTURAR" | "RECIBIDA_Y_FACTURADA";

export function estadoDerivadoDeCompra(
  recepcion: "CONFIRMADA" | "ANULADA",
  comprobante: "REGISTRADO" | "ANULADO" | null,
): EstadoDeCompra {
  if (recepcion === "ANULADA") return "ANULADA";
  return comprobante === "REGISTRADO" ? "RECIBIDA_Y_FACTURADA" : "RECIBIDA_SIN_FACTURAR";
}
