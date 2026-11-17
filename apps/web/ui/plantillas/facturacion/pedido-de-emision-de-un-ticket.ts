import type { ClienteEscrito } from "./eleccion-de-emision";
import { receptorDe, type PedidoDeEmision } from "./pedido-de-emision";

/**
 * El pedido de facturar un ticket: SOLO el ticket, el punto de venta y el receptor. Los renglones, los importes y la sucursal no viajan:
 * el servidor los toma del ticket guardado (el navegador no puede cambiarlos). La clave de idempotencia la pone el intento
 * (`useEnvioDeLaEmision`); la empresa y quién actúa los decide el servidor. Previene: mandar al servidor algo distinto de lo que la persona
 * vio en «Revisar». Chequeo: `test/web/emitir-ticket-modelo.test.ts`.
 */
export type PedidoDeEmisionDeUnTicket = Readonly<{
  ticketId: string;
  puntoDeVentaId: string;
  receptor: PedidoDeEmision["receptor"];
}>;

export function armarElPedidoDelTicket(
  cliente: ClienteEscrito,
  ticketId: string,
  puntoDeVentaId: string,
): PedidoDeEmisionDeUnTicket {
  return { ticketId, puntoDeVentaId, receptor: receptorDe(cliente) };
}
