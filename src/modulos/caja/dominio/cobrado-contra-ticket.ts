import { restar, type Importe } from "../../../primitivas/dinero/importe";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ReferenciaOpaca } from "./identidad-del-cobro";
import { sumarImportes } from "./importes";

/**
 * Cobrado contra el total del ticket (e3b §4.6, el hueco de la decisión 155): un ticket ya cobrado que se corrige a la baja deja lo
 * cobrado MAYOR que el ticket. Caja entrega un solo dato por origen (`cobrado` = Σ de los cobros del origen en la jornada, que no cambia
 * con una corrección de medio) y lo compara con el total vigente que informa ventas por un puerto (caja no importa ventas). Se muestran
 * los orígenes con diferencia distinta de cero: no bloquean. Puro: sin reloj ni azar.
 */
export const ORIGEN_DE_COBRANZA_DE_TICKET = "ventas.cobranza_de_ticket";

export type CobroDeUnOrigen = Readonly<{ origen: ReferenciaOpaca; importe: Importe }>;

/** Lo que ventas informa de una cobranza; la composición entrega `totalVigente = 0` si el ticket está anulado. */
export type TicketDeCobranza = Readonly<{
  cobranzaId: string;
  ticketId: string;
  totalVigente: Importe;
}>;

export type CobradoDeUnOrigen = Readonly<{ origen: ReferenciaOpaca; cobrado: Importe }>;

function llaveDelOrigen(origen: ReferenciaOpaca): string {
  return `${origen.tipo}\u0000${origen.id}`;
}

/** Σ de los cobros por origen (tipo + id), ordenado por origen. Lo que devuelve `cobrosPorOrigen.cobrado` y `cobradoPorOrigenDeLaJornada`. */
export function cobradoPorOrigen(cobros: readonly CobroDeUnOrigen[]): readonly CobradoDeUnOrigen[] {
  const grupos = new Map<string, CobroDeUnOrigen[]>();
  for (const cobro of cobros) {
    const llave = llaveDelOrigen(cobro.origen);
    grupos.set(llave, [...(grupos.get(llave) ?? []), cobro]);
  }
  return [...grupos.keys()].sort().map((llave) => {
    const delOrigen = grupos.get(llave) as CobroDeUnOrigen[];
    return {
      origen: (delOrigen[0] as CobroDeUnOrigen).origen,
      cobrado: sumarImportes(delOrigen.map((c) => c.importe)),
    };
  });
}

export type DiferenciaDeTicket = Readonly<{
  origen: ReferenciaOpaca;
  ticketId: string;
  cobrado: Importe;
  totalDelTicket: Importe;
  /** cobrado − total del ticket; nunca cero. */
  diferencia: Importe;
}>;

/**
 * Los orígenes `ventas.cobranza_de_ticket` cuyo cobrado difiere del total vigente del ticket (los demás orígenes no tienen un ticket
 * con quien compararse). Si ventas no informó la cobranza, la informó dos veces o con un total negativo, el dato no se puede leer:
 * `TICKETS_NO_DISPONIBLES` (el aporte da `APORTE_NO_DISPONIBLE` y el día no se cierra con un dato que no se pudo leer).
 */
export function compararContraTickets(
  cobros: readonly CobroDeUnOrigen[],
  tickets: readonly TicketDeCobranza[],
): Resultado<readonly DiferenciaDeTicket[], "TICKETS_NO_DISPONIBLES"> {
  const porCobranza = new Map<string, TicketDeCobranza>();
  for (const ticket of tickets) {
    if (porCobranza.has(ticket.cobranzaId) || ticket.totalVigente.unidades < 0n) {
      return err("TICKETS_NO_DISPONIBLES");
    }
    porCobranza.set(ticket.cobranzaId, ticket);
  }
  const diferencias: DiferenciaDeTicket[] = [];
  for (const { origen, cobrado } of cobradoPorOrigen(cobros)) {
    if (origen.tipo !== ORIGEN_DE_COBRANZA_DE_TICKET) continue;
    const ticket = porCobranza.get(origen.id);
    if (ticket === undefined) return err("TICKETS_NO_DISPONIBLES");
    const diferencia = restar(cobrado, ticket.totalVigente);
    if (diferencia.unidades !== 0n) {
      diferencias.push({
        origen,
        ticketId: ticket.ticketId,
        cobrado,
        totalDelTicket: ticket.totalVigente,
        diferencia,
      });
    }
  }
  return ok(diferencias);
}
