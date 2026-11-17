import { sql, type Kysely } from "kysely";
import {
  personaId,
  type EmpresaId,
  type PersonaId,
} from "../../../primitivas/identificadores/marca";
import { esUuid, ticketId, type TicketId } from "../dominio/identificadores";
import type { VentasDb } from "./esquema";

/** Un documento: qué comprobante facturó un ticket en un intento. Es un PUNTERO (E1 §3.3): «facturado» lo decide fiscal. */
export type DocumentoDeTicket = Readonly<{
  id: string;
  ticketId: TicketId;
  ejemplarId: string;
  intento: number;
  clave: string;
  comprobanteId: string;
  vigente: boolean;
  creadoEn: Date;
  creadoPor: PersonaId;
  noVigenteEn: Date | null;
}>;

export type AltaDeDocumento = Readonly<{
  id: string;
  ticketId: TicketId;
  ejemplarId: string;
  intento: number;
  clave: string;
  comprobanteId: string;
  creadoPor: PersonaId;
  creadoEn: Date;
}>;

/**
 * Persistencia del puntero `documento_de_ticket` (0029). Todo corre dentro de la transacción del caso de uso, filtra SIEMPRE por la empresa
 * (y la RLS lo repite) y no usa caché. Un id que no es un uuid no puede ser el de nada: «no existe» sin tocar la base.
 */
export interface RepositorioDeDocumentos {
  /** Toma la fila del ticket con `FOR UPDATE` hasta el fin de la transacción: dos personas que facturan el mismo ticket se turnan. `false` si no existe. */
  bloquearTicket(empresa: EmpresaId, ticket: TicketId): Promise<boolean>;
  porClave(empresa: EmpresaId, clave: string): Promise<DocumentoDeTicket | null>;
  /** Todos los documentos del ticket, del primer intento al último. */
  delTicket(empresa: EmpresaId, ticket: TicketId): Promise<readonly DocumentoDeTicket[]>;
  /** Los documentos VIGENTES de esos tickets (como mucho uno por ticket): una sola lectura para una página de pendientes. */
  vigentesDe(empresa: EmpresaId, tickets: readonly string[]): Promise<readonly DocumentoDeTicket[]>;
  insertar(empresa: EmpresaId, alta: AltaDeDocumento): Promise<void>;
  /** `true → false`, la única transición; `false` si ya no estaba vigente (0 filas). */
  marcarNoVigente(empresa: EmpresaId, id: string, cuando: Date): Promise<boolean>;
}

type Fila = Readonly<{
  id: string;
  ticket_id: string;
  ejemplar_id: string;
  intento: number;
  clave: string;
  comprobante_id: string;
  vigente: boolean;
  creado_en: Date;
  creado_por: string;
  no_vigente_en: Date | null;
}>;

const COLUMNAS = [
  "id",
  "ticket_id",
  "ejemplar_id",
  "intento",
  "clave",
  "comprobante_id",
  "vigente",
  "creado_en",
  "creado_por",
  "no_vigente_en",
] as const;

const aDocumento = (f: Fila): DocumentoDeTicket => ({
  id: f.id,
  ticketId: ticketId(f.ticket_id),
  ejemplarId: f.ejemplar_id,
  intento: Number(f.intento),
  clave: f.clave,
  comprobanteId: f.comprobante_id,
  vigente: f.vigente,
  creadoEn: f.creado_en,
  creadoPor: personaId(f.creado_por),
  noVigenteEn: f.no_vigente_en,
});

export function crearRepositorioDeDocumentos(db: Kysely<VentasDb>): RepositorioDeDocumentos {
  return {
    async bloquearTicket(empresa, ticket) {
      if (!esUuid(ticket)) return false;
      const filas = await sql<{ id: string }>`
        select id from ticket where empresa_id = ${empresa} and id = ${ticket} for update`.execute(
        db,
      );
      return filas.rows.length === 1;
    },

    async porClave(empresa, clave) {
      if (!esUuid(clave)) return null;
      const fila = await db
        .selectFrom("documento_de_ticket")
        .select(COLUMNAS)
        .where("empresa_id", "=", empresa)
        .where("clave", "=", clave)
        .executeTakeFirst();
      return fila === undefined ? null : aDocumento(fila);
    },

    async delTicket(empresa, ticket) {
      if (!esUuid(ticket)) return [];
      const filas = await db
        .selectFrom("documento_de_ticket")
        .select(COLUMNAS)
        .where("empresa_id", "=", empresa)
        .where("ticket_id", "=", ticket)
        .orderBy("intento")
        .execute();
      return filas.map(aDocumento);
    },

    async vigentesDe(empresa, tickets) {
      const validos = tickets.filter(esUuid);
      if (validos.length === 0) return [];
      const filas = await db
        .selectFrom("documento_de_ticket")
        .select(COLUMNAS)
        .where("empresa_id", "=", empresa)
        .where("ticket_id", "in", validos)
        .where("vigente", "=", true)
        .execute();
      return filas.map(aDocumento);
    },

    async insertar(empresa, alta) {
      await db
        .insertInto("documento_de_ticket")
        .values({
          id: alta.id,
          empresa_id: empresa,
          ticket_id: alta.ticketId,
          ejemplar_id: alta.ejemplarId,
          intento: alta.intento,
          clave: alta.clave,
          comprobante_id: alta.comprobanteId,
          creado_en: alta.creadoEn,
          creado_por: alta.creadoPor,
        })
        .execute();
    },

    async marcarNoVigente(empresa, id, cuando) {
      if (!esUuid(id)) return false;
      const r = await db
        .updateTable("documento_de_ticket")
        .set({ vigente: false, no_vigente_en: cuando })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("vigente", "=", true)
        .executeTakeFirst();
      return Number(r.numUpdatedRows) === 1;
    },
  };
}
