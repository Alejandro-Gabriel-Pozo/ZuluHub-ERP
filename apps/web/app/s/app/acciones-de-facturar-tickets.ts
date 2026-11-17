"use server";

import { emitirElTicket } from "../../../servidor/facturar-tickets";

// La acción de servidor de facturar un ticket cobrado (E1 §3.6), aparte de `acciones-de-facturacion.ts`. Fina a propósito (ADR-015, punto 2): la
// directiva `"use server"` va primero y lo que hace vive en `servidor/facturar-tickets.ts`. Recibe el pedido tal como lo arma la pantalla (sin
// tipo: se lee y se valida en el servidor) y devuelve la respuesta ya traducida (ADR-016). Del pedido solo valen el ticket, el punto de venta,
// la clave y el receptor: la empresa, la sucursal y quién actúa no viajan, los decide el servidor.

export async function emitirTicketAccion(entrada: unknown) {
  return emitirElTicket(entrada);
}
