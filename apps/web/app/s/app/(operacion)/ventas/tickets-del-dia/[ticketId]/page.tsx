import { pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { fichaDelTicketDeLaPagina } from "../../../../../../../servidor/tickets-del-dia";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import { textosDeCobrar } from "../../../../../../../ui/plantillas/cobrar/textos-de-cobrar";
import { FichaDelTicket } from "../../../../../../../ui/plantillas/tickets-del-dia/FichaDelTicket.cliente";
import { textosDeTicketsDelDia } from "../../../../../../../ui/plantillas/tickets-del-dia/textos-de-tickets-del-dia";
import { anularElTicketAccion, papelDelTicketAccion } from "../../../../acciones-de-cobrar";

// `/ventas/tickets-del-dia/[ticketId]`: la ficha de un ticket (renglones, cobros, quién y cuándo) con «Imprimir ticket» y «Anular». El id es lo único que viene de la URL: la empresa, la persona y el alcance de
// sucursal los decide el servidor. Un id mal escrito, de otra empresa o de otra sucursal sale igual que uno que no existe (el genérico): no se distingue. «Anular» reutiliza la acción del cobro (`acciones-de-cobrar.ts`).
export default async function PaginaDeLaFichaDelTicket({
  params,
}: {
  params: Promise<{ ticketId: string }>;
}) {
  const { ticketId } = await params;
  return pantallaDeOperacion({ titulo: "ventas.tickets.titulo" }, async ({ contexto }) => {
    const ficha = await fichaDelTicketDeLaPagina(contexto, ticketId);
    if (!ficha.ok) return <ErrorDelDetalle error={ficha.error} />;
    return (
      <FichaDelTicket
        ficha={ficha.dato}
        textos={textosDeTicketsDelDia()}
        textosDeCobrar={textosDeCobrar()}
        anular={anularElTicketAccion}
        imprimir={papelDelTicketAccion}
      />
    );
  });
}
