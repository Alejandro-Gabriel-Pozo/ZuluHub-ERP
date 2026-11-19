import "server-only";
import { errorDeCodigo, type Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  fichaDelTicketParaLaPantalla,
  ticketsDelDiaParaLaPantalla,
  type DependenciasDeTicketsDelDiaWeb,
  type FichaDelTicketParaLaPantalla,
  type TicketsDelDiaParaLaPantalla,
} from "../../../src/composicion/tickets-del-dia-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { web } from "./composicion";
import { dependenciasDeSesion } from "./sesion";
import { sucursalDelPedido } from "./sucursal-elegida";

/**
 * Las lecturas de «Tickets del día» y la «Ficha del ticket» para las páginas (DDD:293). Finas, como `cobrar.ts`: resuelven DÓNDE se mira (la sucursal elegida en
 * este dispositivo, validada contra las que la persona puede elegir; nunca la que diga el navegador; sin ninguna, el genérico, nunca «todas») y llaman a
 * `src/composicion/tickets-del-dia-web.ts`, donde se prueba todo lo demás. El contexto (persona y empresa) lo resuelve la página. Ninguna decide permisos:
 * cada consulta exige `ventas.ver` adentro.
 */

export type { FichaDelTicketParaLaPantalla, TicketsDelDiaParaLaPantalla };

const dependencias: DependenciasDeTicketsDelDiaWeb = {
  consultas: web.consultasDeVentas,
  consultasDeIdentidad: web.consultasDeIdentidad,
  respuesta: dependenciasDeSesion.respuesta,
};

const SIN_SUCURSAL = { ok: false, error: errorDeCodigo("CAJA_ACCION_NO_PERMITIDA") } as const;

/** Los tickets de la jornada de la sucursal con la que trabaja la persona. */
export async function ticketsDelDiaDeLaPagina(
  contexto: ContextoOperativo,
): Promise<Respuesta<TicketsDelDiaParaLaPantalla>> {
  const sucursal = await sucursalDelPedido(contexto);
  if (!sucursal.ok) return sucursal;
  if (sucursal.dato.efectiva === "") return SIN_SUCURSAL;
  return ticketsDelDiaParaLaPantalla(dependencias, contexto, sucursal.dato.efectiva);
}

/** La ficha de un ticket; el alcance (la sucursal del ticket) lo valida la consulta. */
export function fichaDelTicketDeLaPagina(
  contexto: ContextoOperativo,
  ticketId: string,
): Promise<Respuesta<FichaDelTicketParaLaPantalla>> {
  return fichaDelTicketParaLaPantalla(dependencias, contexto, { ticketId });
}
