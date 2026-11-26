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

// Los espacios de nombres son fijos: cambiar uno reescribiría la identidad de lo ya asentado.
const ESPACIO_DEL_CARGO = "c3a1f5e2-6b94-4d07-8e1a-72f0b9d4a815";
const ESPACIO_DE_LA_ANULACION_DEL_CARGO = "9d27e6b0-41c3-4a8f-b5d6-0e8a13c7f492";

export const claveDelCargoDeVenta = (ticketId: string): string =>
  uuidV5DeLista(ESPACIO_DEL_CARGO, [ticketId]);

export const claveDeLaAnulacionDelCargoDeVenta = (ticketId: string): string =>
  uuidV5DeLista(ESPACIO_DE_LA_ANULACION_DEL_CARGO, [ticketId]);

/**
 * ¿El cargo deja al cliente por encima de su límite? `exceso` es cuánto lo supera (`saldo + total − límite`) o `null` si no lo supera: el saldo IGUAL al límite pasa, un centavo más pide
 * aprobación. El saldo es el del libro (positivo = debe; negativo = saldo a favor, que suma al margen). Centavos enteros, sin redondeo.
 */
export function excesoDelLimite(limite: Importe, saldo: Importe, total: Importe): Importe | null {
  const exceso = restar(sumar(saldo, total), limite);
  return exceso.unidades > 0n ? exceso : null;
}
