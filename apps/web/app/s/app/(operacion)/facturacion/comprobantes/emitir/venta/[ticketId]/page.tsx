import { pantallaDeOperacion } from "../../../../../../../../../pantallas/operacion";
import {
  puntosDeVentaParaEmitirDe,
  discriminaIvaParaEmitir,
} from "../../../../../../../../../servidor/facturacion";
import { ticketParaEmitirDeLaPagina } from "../../../../../../../../../servidor/facturar-tickets";
import { ErrorDelDetalle } from "../../../../../../../../../ui/patrones/ErrorDelDetalle";
import { PantallaDeEmitirDesdeUnTicket } from "../../../../../../../../../ui/plantillas/facturacion/PantallaDeEmitirDesdeUnTicket.cliente";
import { emitirTicketAccion } from "../../../../../../acciones-de-facturar-tickets";

// Tope de la función para la página Y para las Server Actions que aloja (`emitirTicketAccion`): 90 s, el mismo que Emitir (`emitir/page.tsx`):
// es la misma emisión, con la misma espera a ARCA (peor caso 75 s más 15 s de margen). Next: «se fija a nivel de página para todas las
// Server Actions de esa página» (maxDuration.md). Chequeo: `test/web/max-duration.test.ts`.
export const maxDuration = 90;

type PropsDePagina = Readonly<{ params: Promise<{ ticketId: string }> }>;

const OPCIONES = { titulo: "fiscal.pantalla.emitir_titulo", actual: "comprobantes" } as const;

// `/facturacion/comprobantes/emitir/venta/[ticketId]`: emitir la factura de un ticket cobrado. Los renglones son los del ticket guardado (de solo
// lectura); la sucursal de los puntos de venta sale de ese ticket, que lee el servidor, nunca de la dirección ni de un campo. El servidor
// vuelve a validar todo (permisos, alcance, módulo, estado del ticket, total) dentro de la transacción de la acción.
export default async function PaginaDeEmitirDesdeUnTicket({ params }: PropsDePagina) {
  const { ticketId } = await params;
  return pantallaDeOperacion(OPCIONES, async ({ contexto }) => {
    const ticket = await ticketParaEmitirDeLaPagina(contexto, { ticketId });
    if (!ticket.ok) return <ErrorDelDetalle error={ticket.error} />;
    const discrimina = await discriminaIvaParaEmitir(contexto);
    if (!discrimina.ok) return <ErrorDelDetalle error={discrimina.error} />;
    const puntos = await puntosDeVentaParaEmitirDe(contexto, ticket.dato.sucursalId);
    if (!puntos.ok) return <ErrorDelDetalle error={puntos.error} />;
    return (
      <PantallaDeEmitirDesdeUnTicket
        ticket={ticket.dato}
        discriminaIva={discrimina.dato.discriminaIva}
        puntosDeVenta={puntos.dato.items}
        emitir={emitirTicketAccion}
      />
    );
  });
}
