import { redirect } from "next/navigation";
import { pantallaDeOperacion } from "../../../../../../../../pantallas/operacion";
import {
  leerElTicketACobrar,
  puedeCobrarTickets,
} from "../../../../../../../../servidor/cobrar-a-cuenta";
import { ErrorDelDetalle } from "../../../../../../../../ui/patrones/ErrorDelDetalle";
import { textosDeCobrar } from "../../../../../../../../ui/plantillas/cobrar/textos-de-cobrar";
import { PantallaDeCobrarACuenta } from "../../../../../../../../ui/plantillas/cuenta-corriente/PantallaDeCobrarACuenta.cliente";
import {
  rutaDeCobrarACuenta,
  rutaDeLaFichaDeCuenta,
} from "../../../../../../../../ui/plantillas/cuenta-corriente/rutas-de-cuenta-corriente";
import { textosDeCobrarACuenta } from "../../../../../../../../ui/plantillas/cuenta-corriente/textos-de-cobrar-a-cuenta";
import { cobrarElTicketACuentaAccion } from "../../../../../acciones-de-cobrar-a-cuenta";

type PropsDePagina = Readonly<{
  params: Promise<{ parteId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

// `/caja/cuenta-corriente/[parteId]/cobrar`: «Cobrar un ticket a cuenta» (CC-5 B2b; maqueta P4), desde el botón «Cobrar un ticket» de la ficha. Cobra el cargo pendiente MÁS ANTIGUO del cliente o, con
// `?ticket=`, ese ticket. Lo único que viene del navegador son esos dos ids: el servidor los valida contra la empresa y uno ajeno, inexistente o mal escrito sale como el genérico. Sin nada para cobrar vuelve a
// la ficha. «Cobrar» sale apagado sin `tickets.cobrar` o sin caja abierta hoy (ayuda: el servidor igual decide) y el importe nunca viaja: lo pone el servidor.
export default async function PaginaDeCobrarACuenta({ params, searchParams }: PropsDePagina) {
  const { parteId } = await params;
  const { ticket } = await searchParams;
  const textos = textosDeCobrarACuenta();
  return pantallaDeOperacion({ titulo: "cuenta_corriente.cobro.titulo" }, async ({ contexto }) => {
    const respuesta = await leerElTicketACobrar({
      clienteId: parteId,
      ...(typeof ticket === "string" ? { ticketId: ticket } : {}),
    });
    if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
    if (respuesta.dato === null) return redirect(rutaDeLaFichaDeCuenta(parteId));
    return (
      <PantallaDeCobrarACuenta
        // Cada ticket que se abre es un intento nuevo: la clave y el ejemplar de la pantalla no se arrastran de uno al siguiente.
        key={respuesta.dato.ticket.ticketId}
        hoja={respuesta.dato}
        textos={textos}
        textosDeCobrar={textosDeCobrar()}
        puedeCobrar={await puedeCobrarTickets(contexto)}
        cobrar={cobrarElTicketACuentaAccion}
        hrefDeLaFicha={rutaDeLaFichaDeCuenta(parteId)}
        hrefDeCobrarOtro={rutaDeCobrarACuenta(parteId)}
      />
    );
  });
}
