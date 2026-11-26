import { restar, sumar, type Importe } from "../../../primitivas/dinero/importe";
import { uuidV5DeLista } from "../../../primitivas/identificadores/uuid-determinista";

/**
 * El cargo de una venta a cuenta corriente en el libro de saldos (CC-2): cada ticket cerrado a nombre de un cliente deja UN asiento «cargo» (lo que el cliente debe) y, al anular el ticket, su espejo.
 * Puro: sin reloj ni azar. La clave y el origen salen del ticket (no del azar): un reintento repite la misma clave y el libro devuelve lo hecho.
 */
export const ORIGEN_DEL_CARGO_DE_VENTA = "ventas.ticket";
export const CLASE_DEL_CARGO_DE_VENTA = "CARGO_DE_VENTA_A_CUENTA";
/** El texto del espejo: un código, no un texto que vea el cliente (el motivo de la anulación queda en el ticket). */
export const DETALLE_DE_LA_ANULACION_DEL_CARGO_DE_VENTA = "ANULACION-DE-TICKET";

/**
 * La cobranza del ticket a cuenta (CC-3): el MISMO cobro de caja de hoy suma un asiento COBRANZA (−) por el total, imputado al cargo de ese ticket; al anular el ticket cobrado se anula primero la cobranza y después el
 * cargo. El origen es la cobranza de ventas (el libro y la caja guardan sus orígenes en tablas distintas: el mismo texto no choca). Las claves salen de la cobranza: un reintento repite la misma.
 */
export const ORIGEN_DE_LA_COBRANZA_DE_VENTA = "ventas.cobranza_de_ticket";
export const CLASE_DE_LA_COBRANZA_DE_VENTA = "COBRANZA";
export const DETALLE_DE_LA_ANULACION_DE_LA_COBRANZA = "ANULACION-DE-COBRANZA";

// Los espacios de nombres son fijos: cambiar uno reescribiría la identidad de lo ya asentado.
const ESPACIO_DE_LA_COBRANZA = "2f6a9c14-d3b8-4e71-a0c5-8b17e4d96f23";
const ESPACIO_DE_LA_IMPUTACION_DE_LA_COBRANZA = "a8e5013b-7c92-4d6a-9f48-31b0d7c2e5a9";
const ESPACIO_DE_LA_ANULACION_DE_LA_COBRANZA = "56d1e8f7-0a3c-4b92-8d65-c4f9a2b71e08";
const ESPACIO_DEL_CARGO = "c3a1f5e2-6b94-4d07-8e1a-72f0b9d4a815";
const ESPACIO_DE_LA_ANULACION_DEL_CARGO = "9d27e6b0-41c3-4a8f-b5d6-0e8a13c7f492";

export const claveDelCargoDeVenta = (ticketId: string): string =>
  uuidV5DeLista(ESPACIO_DEL_CARGO, [ticketId]);

export const claveDeLaAnulacionDelCargoDeVenta = (ticketId: string): string =>
  uuidV5DeLista(ESPACIO_DE_LA_ANULACION_DEL_CARGO, [ticketId]);

export const claveDeLaCobranzaDeVenta = (cobranzaId: string): string =>
  uuidV5DeLista(ESPACIO_DE_LA_COBRANZA, [cobranzaId]);

export const claveDeLaImputacionDeLaCobranza = (cobranzaId: string): string =>
  uuidV5DeLista(ESPACIO_DE_LA_IMPUTACION_DE_LA_COBRANZA, [cobranzaId]);

export const claveDeLaAnulacionDeLaCobranza = (cobranzaId: string): string =>
  uuidV5DeLista(ESPACIO_DE_LA_ANULACION_DE_LA_COBRANZA, [cobranzaId]);

/**
 * ¿El cargo deja al cliente por encima de su límite? `exceso` es cuánto lo supera (`saldo + total − límite`) o `null` si no lo supera: el saldo IGUAL al límite pasa, un centavo más pide
 * aprobación. El saldo es el del libro (positivo = debe; negativo = saldo a favor, que suma al margen). Centavos enteros, sin redondeo.
 */
export function excesoDelLimite(limite: Importe, saldo: Importe, total: Importe): Importe | null {
  const exceso = restar(sumar(saldo, total), limite);
  return exceso.unidades > 0n ? exceso : null;
}
