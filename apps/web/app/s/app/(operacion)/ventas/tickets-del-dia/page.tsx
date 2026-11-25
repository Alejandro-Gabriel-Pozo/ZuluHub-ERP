import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import { ticketsDelDiaDeLaPagina } from "../../../../../../servidor/tickets-del-dia";
import { ErrorDelDetalle } from "../../../../../../ui/patrones/ErrorDelDetalle";
import { ListaDeTickets } from "../../../../../../ui/plantillas/tickets-del-dia/ListaDeTickets";
import { textosDeTicketsDelDia } from "../../../../../../ui/plantillas/tickets-del-dia/textos-de-tickets-del-dia";

// `/ventas/tickets-del-dia`: los tickets de la jornada de la sucursal elegida en este dispositivo (maqueta `tickets-del-dia.html`; el dueño, 18/11/2026). La sucursal la fija el servidor y
// la lectura exige `ventas.ver`; lo que no se puede mostrar (más de 1000 tickets, sin sucursal, sin permiso) sale como el genérico: nunca una lista que parezca completa.
export default async function PaginaDeTicketsDelDia() {
  return pantallaDeOperacion({ titulo: "ventas.tickets.titulo" }, async ({ contexto }) => {
    const lista = await ticketsDelDiaDeLaPagina(contexto);
    if (!lista.ok) return <ErrorDelDetalle error={lista.error} />;
    return <ListaDeTickets lista={lista.dato} textos={textosDeTicketsDelDia()} />;
  });
}
