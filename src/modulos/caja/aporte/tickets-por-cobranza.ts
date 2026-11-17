import type { Importe } from "../../../primitivas/dinero/importe";
import type { TxDeLecturaDeCaja } from "../cobrar/contrato";

/**
 * Lo que caja necesita de ventas para el control `caja.cobrado_contra_ticket` (e3b §4.6, el hueco de la decisión 155): por cada cobranza
 * (el `origen.id` de los cobros con origen `ventas.cobranza_de_ticket`), el ticket y su total VIGENTE. Caja DECLARA este puerto (no importa
 * ventas: regla `caja-sin-negocio-ajeno`) y la composición lo IMPLEMENTA con `ticketsPorCobranza` de ventas (e4 §3.15). Solo lectura, en la
 * transacción de quien llama. Lo que se entrega ya viene resuelto: con el ticket ANULADO la composición entrega `totalVigente = 0`; caja
 * no interpreta el estado del ticket ni mira el `totalCobrado` de ventas (compara con SU `cobrado`).
 * Previene: que caja conozca el modelo de ventas (ciclo) y que un total que ventas no pudo informar pase como «sin diferencia».
 */
export type TicketDeVentas = Readonly<{
  /** Un id de `cobranzaIds`. */
  cobranzaId: string;
  ticketId: string;
  /** El total vigente del ticket; cero si está anulado. */
  totalVigente: Importe;
}>;

export interface TicketsPorCobranza {
  /**
   * Los tickets de esas cobranzas. Una cobranza que no vuelve (o que vuelve dos veces) es un dato que no se pudo leer: el aporte de caja
   * da `APORTE_NO_DISPONIBLE` y el día no se cierra. Se llama solo si hay cobros con origen de ventas en la jornada.
   */
  ticketsPorCobranza(
    tx: TxDeLecturaDeCaja,
    cobranzaIds: readonly string[],
  ): Promise<readonly TicketDeVentas[]>;
}
