import { sql, type Kysely } from "kysely";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import { esUuid } from "../dominio/identificadores";
import type { VentasDb } from "./esquema";

/** Lo que otro módulo necesita saber de un ticket para mostrarlo (CC-5: el origen de un movimiento de la cuenta corriente). */
export type TicketParaMostrar = Readonly<{
  ticketId: string;
  numero: number;
  sucursalId: string;
  /** `true` si la cuenta de consumo del ticket nació en el salón (tiene ancla); `false` si es del mostrador. */
  esDelSalon: boolean;
}>;

export interface LecturaDeTicketsParaCuentas {
  /** Lo mismo, por el id de la COBRANZA del ticket (el origen de un asiento de cobranza): el id que vuelve es el de la cobranza. Una cobranza que no existe o es de otra empresa no figura. */
  paraMostrarPorCobranza(
    empresa: EmpresaId,
    cobranzaIds: readonly string[],
  ): Promise<(TicketParaMostrar & Readonly<{ cobranzaId: string }>)[]>;
  /** Los tickets pedidos de la empresa, en UNA lectura; uno que no existe o es de otra empresa no figura. Solo lectura. */
  paraMostrar(empresa: EmpresaId, ticketIds: readonly string[]): Promise<TicketParaMostrar[]>;
}

export function crearLecturaDeTicketsParaCuentas(
  db: Kysely<VentasDb>,
): LecturaDeTicketsParaCuentas {
  return {
    async paraMostrarPorCobranza(empresa, cobranzaIds) {
      const ids = cobranzaIds.filter(esUuid);
      if (ids.length === 0) return [];
      const filas = await db
        .selectFrom("cobranza_de_ticket as k")
        .innerJoin("ticket as t", (j) =>
          j.onRef("t.id", "=", "k.ticket_id").onRef("t.empresa_id", "=", "k.empresa_id"),
        )
        .innerJoin("cuenta_consumo as c", (j) =>
          j.onRef("c.id", "=", "t.cuenta_id").onRef("c.empresa_id", "=", "t.empresa_id"),
        )
        .select([
          "k.id as cobranza_id",
          "t.id as id",
          "t.numero as numero",
          "t.sucursal_id as sucursal_id",
          sql<boolean>`c.ancla_tipo is not null`.as("es_del_salon"),
        ])
        .where("k.empresa_id", "=", empresa)
        .where(sql<boolean>`k.id = any(${ids}::uuid[])`)
        .orderBy("k.id")
        .execute();
      return filas.map((f) => ({
        cobranzaId: f.cobranza_id,
        ticketId: f.id,
        numero: f.numero,
        sucursalId: f.sucursal_id,
        esDelSalon: f.es_del_salon,
      }));
    },

    async paraMostrar(empresa, ticketIds) {
      const ids = ticketIds.filter(esUuid);
      if (ids.length === 0) return [];
      const filas = await db
        .selectFrom("ticket as t")
        .innerJoin("cuenta_consumo as c", (j) =>
          j.onRef("c.id", "=", "t.cuenta_id").onRef("c.empresa_id", "=", "t.empresa_id"),
        )
        .select([
          "t.id as id",
          "t.numero as numero",
          "t.sucursal_id as sucursal_id",
          sql<boolean>`c.ancla_tipo is not null`.as("es_del_salon"),
        ])
        .where("t.empresa_id", "=", empresa)
        .where(sql<boolean>`t.id = any(${ids}::uuid[])`)
        .orderBy("t.numero")
        .execute();
      return filas.map((f) => ({
        ticketId: f.id,
        numero: f.numero,
        sucursalId: f.sucursal_id,
        esDelSalon: f.es_del_salon,
      }));
    },
  };
}
