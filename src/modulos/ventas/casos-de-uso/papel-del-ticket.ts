import type { ModeloDePapel, PapelEnMm } from "../../../primitivas/papel/modelo-de-papel";
import type { Resultado } from "../../../primitivas/resultado/resultado";
import { documentoDeTicket, type ErrorDelPapelDelTicket } from "../dominio/documento-del-ticket";
import type { FichaDeTicketLeida } from "../persistencia/repositorio-de-lecturas";

export type { ErrorDelPapelDelTicket };

/**
 * El papel de una ficha ya leída: lo comparten la consulta de ventas y la de comandas (una regla, un lugar). El total es el del ejemplar vigente. Vive en `casos-de-uso/`
 * (como `calculo.ts`) porque las consultas llegan al dominio por acá, no directo.
 */
export function papelDelTicket(
  ficha: FichaDeTicketLeida,
  ancho: PapelEnMm,
): Resultado<ModeloDePapel, ErrorDelPapelDelTicket> {
  return documentoDeTicket(
    {
      numero: ficha.ticket.numero,
      fechaNegocio: ficha.ticket.fechaNegocio,
      lineas: ficha.renglonesDelVigente.map((r) => ({
        cantidad: r.cantidad,
        unidadDeVenta: r.unidadDeVenta,
        descripcion: r.descripcion,
        varianteNombre: r.varianteNombre,
        opciones: r.opciones.map((o) => ({ nombre: o.nombre })),
        importe: r.importe,
      })),
      total: ficha.ejemplares[0]?.total ?? ficha.ticket.total,
    },
    { ancho },
  );
}
