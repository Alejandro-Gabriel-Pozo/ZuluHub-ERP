import type { Kysely } from "kysely";
import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import { esUuid, ticketId, type EjemplarId, type TicketId } from "../dominio/identificadores";
import type { VentasDb } from "./esquema";

export type AltaDeCobranza = Readonly<{
  id: string;
  ticketId: TicketId;
  ejemplarId: EjemplarId;
  cajaId: string;
  clave: string;
  huella: string;
  creadaPor: PersonaId;
  creadaEn: Date;
}>;

export type AplicacionDeCobro = Readonly<{
  orden: number;
  cobroId: string;
  cuentaDeCobroId: string | null;
  importe: string;
}>;

export type CobranzaGuardada = Readonly<{
  id: string;
  ticketId: TicketId;
  huella: string;
  /** Lo que se devolvió la primera vez; `null` hasta que termina la transacción que la creó. */
  resultado: Readonly<Record<string, unknown>> | null;
}>;

/** La cobranza de un ticket (E4 §3.6): el cambio de estado a cobrado, la cobranza con su clave y sus aplicaciones a los cobros de caja. */
export interface RepositorioDeCobranzas {
  /**
   * `EMITIDO → COBRADO` solo si el ejemplar vigente sigue siendo el visto (árbitro contra otro cobro, una anulación y una corrección).
   * `false` si no cambió nada: el caso de uso relee y dice por qué.
   */
  marcarCobrado(empresa: EmpresaId, id: TicketId, ejemplarVigenteVisto: number): Promise<boolean>;
  cobranzaPorClave(empresa: EmpresaId, clave: string): Promise<CobranzaGuardada | null>;
  cobranzaDeTicket(empresa: EmpresaId, ticket: TicketId): Promise<CobranzaGuardada | null>;
  /**
   * Inserta la cobranza (clave y ticket únicos por empresa; el disparador exige ticket EMITIDO con su ejemplar vigente). `ON CONFLICT DO NOTHING`
   * sin objetivo: `false` si ya había una con esa clave o para ese ticket (el caso de uso relee y dice cuál); bajo SERIALIZABLE, chocar con una
   * que esta transacción todavía no ve aborta por serialización y se repite entero.
   */
  insertarCobranza(empresa: EmpresaId, alta: AltaDeCobranza): Promise<boolean>;
  /** Una fila por cobro de caja, en la misma transacción de la cobranza. */
  insertarAplicaciones(
    empresa: EmpresaId,
    cobranza: string,
    aplicaciones: readonly AplicacionDeCobro[],
  ): Promise<void>;
  /** Guarda lo que devolvió el cobro (una sola vez): una repetición con la misma clave lo devuelve tal cual. */
  fijarResultadoDeCobranza(
    empresa: EmpresaId,
    cobranza: string,
    resultado: Readonly<Record<string, unknown>>,
  ): Promise<void>;
}

export function crearRepositorioDeCobranzas(db: Kysely<VentasDb>): RepositorioDeCobranzas {
  return {
    async marcarCobrado(empresa, id, ejemplarVigenteVisto) {
      const r = await db
        .updateTable("ticket")
        .set({ estado: "COBRADO" })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("estado", "=", "EMITIDO")
        .where("ejemplar_vigente", "=", ejemplarVigenteVisto)
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },

    async cobranzaPorClave(empresa, clave) {
      const f = await db
        .selectFrom("cobranza_de_ticket")
        .select(["id", "ticket_id", "huella", "resultado"])
        .where("empresa_id", "=", empresa)
        .where("clave", "=", clave)
        .executeTakeFirst();
      return f === undefined
        ? null
        : { id: f.id, ticketId: ticketId(f.ticket_id), huella: f.huella, resultado: f.resultado };
    },

    async cobranzaDeTicket(empresa, ticket) {
      if (!esUuid(ticket)) return null;
      const f = await db
        .selectFrom("cobranza_de_ticket")
        .select(["id", "ticket_id", "huella", "resultado"])
        .where("empresa_id", "=", empresa)
        .where("ticket_id", "=", ticket)
        .executeTakeFirst();
      return f === undefined
        ? null
        : { id: f.id, ticketId: ticketId(f.ticket_id), huella: f.huella, resultado: f.resultado };
    },

    async insertarCobranza(empresa, alta) {
      const fila = await db
        .insertInto("cobranza_de_ticket")
        .values({
          id: alta.id,
          empresa_id: empresa,
          ticket_id: alta.ticketId,
          ejemplar_id: alta.ejemplarId,
          caja_id: alta.cajaId,
          clave: alta.clave,
          huella: alta.huella,
          creada_por: alta.creadaPor,
          creada_en: alta.creadaEn,
        })
        .onConflict((oc) => oc.doNothing())
        .returning("id")
        .executeTakeFirst();
      return fila !== undefined;
    },

    async insertarAplicaciones(empresa, cobranza, aplicaciones) {
      await db
        .insertInto("aplicacion_de_cobro")
        .values(
          aplicaciones.map((a) => ({
            empresa_id: empresa,
            cobranza_id: cobranza,
            orden: a.orden,
            cobro_id: a.cobroId,
            cuenta_de_cobro_id: a.cuentaDeCobroId,
            importe: a.importe,
          })),
        )
        .execute();
    },

    async fijarResultadoDeCobranza(empresa, cobranza, resultado) {
      await db
        .updateTable("cobranza_de_ticket")
        .set({ resultado })
        .where("empresa_id", "=", empresa)
        .where("id", "=", cobranza)
        .execute();
    },
  };
}
