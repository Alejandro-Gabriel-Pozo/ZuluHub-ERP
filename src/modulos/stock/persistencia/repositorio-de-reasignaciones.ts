import { sql, type Kysely } from "kysely";
import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import type { StockDb } from "./esquema";
import { esUuid } from "./filas";

/**
 * Las reasignaciones entre lotes (0032, E6): mover existencia de un lote a otro del mismo depósito, y la apertura de un control (todo lo que el
 * libro tiene entra al «sin asignar»). Solo inserción; el saldo por lote lo escribe el disparador de la base. Separado de
 * `repositorio-de-lotes.ts` por tamaño.
 */
export type AltaDeReasignacion = Readonly<{
  id: string;
  depositoId: string;
  articuloId: string;
  /** `null`: la apertura de un control (todo entra al «sin asignar»; puede ser negativa). */
  loteOrigenId: string | null;
  loteDestinoId: string;
  /** Con signo, texto decimal exacto (positiva si hay origen). */
  cantidad: string;
  motivo: string;
  clave: string;
  por: PersonaId;
  en: Date;
}>;

export type ReasignacionGuardada = Readonly<{
  id: string;
  depositoId: string;
  articuloId: string;
  loteOrigenId: string | null;
  loteDestinoId: string;
  cantidad: string;
  motivo: string;
}>;

export interface RepositorioDeReasignaciones {
  registrarReasignacion(empresa: EmpresaId, alta: AltaDeReasignacion): Promise<void>;
  reasignacionPorClave(empresa: EmpresaId, clave: string): Promise<ReasignacionGuardada | null>;
  /** El saldo del lote en el depósito (0 si nunca tuvo), bloqueando la fila si existe (`FOR UPDATE`). */
  bloquearSaldoDeLote(empresa: EmpresaId, depositoId: string, loteId: string): Promise<bigint>;
}

const aUnidades = (texto: string): bigint => BigInt(texto.replace(".", ""));

export function crearRepositorioDeReasignaciones(db: Kysely<StockDb>): RepositorioDeReasignaciones {
  return {
    async registrarReasignacion(empresa, alta) {
      await db
        .insertInto("reasignacion_de_lote")
        .values({
          id: alta.id,
          empresa_id: empresa,
          deposito_id: alta.depositoId,
          articulo_id: alta.articuloId,
          lote_origen_id: alta.loteOrigenId,
          lote_destino_id: alta.loteDestinoId,
          cantidad: alta.cantidad,
          motivo: alta.motivo,
          clave_idempotencia: alta.clave,
          por: alta.por,
          en: alta.en,
        })
        .execute();
    },
    async reasignacionPorClave(empresa, clave) {
      const { rows } = await sql<{
        id: string;
        deposito_id: string;
        articulo_id: string;
        lote_origen_id: string | null;
        lote_destino_id: string;
        cantidad: string;
        motivo: string;
      }>`
        select id, deposito_id, articulo_id, lote_origen_id, lote_destino_id, cantidad::text as cantidad, motivo
          from reasignacion_de_lote where empresa_id = ${empresa} and clave_idempotencia = ${clave}`.execute(
        db,
      );
      const f = rows[0];
      return f === undefined
        ? null
        : {
            id: f.id,
            depositoId: f.deposito_id,
            articuloId: f.articulo_id,
            loteOrigenId: f.lote_origen_id,
            loteDestinoId: f.lote_destino_id,
            cantidad: f.cantidad,
            motivo: f.motivo,
          };
    },
    async bloquearSaldoDeLote(empresa, depositoId, loteId) {
      if (!esUuid(depositoId) || !esUuid(loteId)) return 0n;
      const { rows } = await sql<{ existencia: string }>`
        select existencia::text as existencia from saldo_de_lote
         where empresa_id = ${empresa} and deposito_id = ${depositoId} and lote_id = ${loteId} for update`.execute(
        db,
      );
      return rows[0] === undefined ? 0n : aUnidades(rows[0].existencia);
    },
  };
}
