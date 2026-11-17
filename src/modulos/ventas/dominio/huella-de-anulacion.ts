import { createHash } from "node:crypto";

/**
 * La huella de una anulación de ticket (E4 §3.8): sha256 (hex) de lo que pidió quien anula (el ticket, el ejemplar que vio, el id del
 * ejemplar nuevo y el motivo ya canónico). La clave de idempotencia con la misma huella devuelve lo hecho; con otra huella es
 * `CLAVE_REUTILIZADA`. Determinista y sin depender del orden de los campos. Puro: sin reloj ni azar.
 */
export type PedidoDeAnulacion = Readonly<{
  ticketId: string;
  ejemplarBaseId: string;
  ejemplarNuevoId: string;
  motivo: string;
}>;

export function huellaDeAnulacion(pedido: PedidoDeAnulacion): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        pedido.ticketId,
        pedido.ejemplarBaseId,
        pedido.ejemplarNuevoId,
        pedido.motivo,
      ]),
    )
    .digest("hex");
}
