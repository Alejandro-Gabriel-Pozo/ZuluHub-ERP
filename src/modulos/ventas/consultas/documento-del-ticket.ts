import { exigirSucursal, type ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { ContextoOperativo } from "../../../contexto/contexto";
import {
  PAPELES_EN_MM,
  type ModeloDePapel,
  type PapelEnMm,
} from "../../../primitivas/papel/modelo-de-papel";
import type { SucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { esUuid } from "../casos-de-uso/calculo";
import { documentoDeTicket, type ErrorDelPapelDelTicket } from "../dominio/documento-del-ticket";
import type { FichaDeTicketLeida } from "../persistencia/repositorio-de-lecturas";
import type { TxDeConsultasDeVentas } from "./contrato";

/**
 * «Imprimir ticket» (mostrador, K6): el papel del ticket como modelo (`documentoDeTicket`), sin depender del módulo `comandas` (que importa ventas: ciclo).
 * `ventas.ver` y el alcance de la sucursal del ticket los exige `consultas.ts`. SOLO LEE. Contenido: lo que ya tiene la ficha (ver `dominio/documento-del-ticket.ts`).
 * Un ticket ANULADO o de CORTESÍA no tiene papel para el cliente (el dueño: «anulado y cortesía no lo ofrecen»): `TICKET_NO_IMPRIMIBLE`, falla cerrada. El ancho es 58 u 80 mm,
 * 80 por defecto (como una sucursal sin impresora configurada: ventas no conoce impresoras). Aparte de `consultas.ts` por el tope de tamaño del archivo.
 */
export type EntradaDeDocumentoDelTicket = Readonly<{
  ticketId: string;
  ancho?: number | undefined;
}>;

export type ErrorDeDocumentoDelTicket =
  | ErrorDelPapelDelTicket
  | ErrorDeAlcance
  | "IDENTIFICADOR_INVALIDO"
  | "ANCHO_INVALIDO"
  | "TICKET_NO_ENCONTRADO"
  | "TICKET_NO_IMPRIMIBLE";

const ANCHO_POR_DEFECTO: PapelEnMm = 80;

/** El papel de una ficha ya leída: lo comparte la consulta de ventas y la de comandas (una regla, un lugar). El total es el del ejemplar vigente. */
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

export async function documentoDelTicket(
  tx: TxDeConsultasDeVentas,
  contexto: ContextoOperativo,
  alcance: "TODAS" | readonly SucursalId[],
  entrada: EntradaDeDocumentoDelTicket,
): Promise<Resultado<ModeloDePapel, ErrorDeDocumentoDelTicket>> {
  if (!esUuid(entrada.ticketId)) return err("IDENTIFICADOR_INVALIDO");
  const ancho =
    entrada.ancho === undefined
      ? ANCHO_POR_DEFECTO
      : PAPELES_EN_MM.find((papel) => papel === entrada.ancho);
  if (ancho === undefined) return err("ANCHO_INVALIDO");
  const ficha = await tx.lecturasDeVentas.fichaDeTicket(contexto.empresaId, entrada.ticketId);
  if (ficha === null) return err("TICKET_NO_ENCONTRADO");
  const permitida = exigirSucursal(alcance, ficha.ticket.sucursalId);
  if (!permitida.ok) return permitida;
  if (ficha.ticket.estado === "ANULADO" || ficha.ticket.estado === "CORTESIA") {
    return err("TICKET_NO_IMPRIMIBLE");
  }
  const papel = papelDelTicket(ficha, ancho);
  return papel.ok ? ok(papel.valor) : papel;
}
