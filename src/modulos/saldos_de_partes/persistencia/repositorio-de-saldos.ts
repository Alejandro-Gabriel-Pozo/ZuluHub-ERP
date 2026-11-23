import { sql, type Kysely } from "kysely";
import { importeDesdeTexto, type Importe } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { esUuidCanonico, type EmpresaId } from "../../../primitivas/identificadores/marca";
import type { Sentido } from "../dominio/clases";
import type { Reparto } from "../dominio/distribucion";
import type { SaldosDb } from "./esquema";

export type EstadoDeAsiento = Readonly<{
  /** El importe del asiento, en positivo. */
  tope: Importe;
  imputado: Importe;
  anulado: boolean;
}>;

/**
 * Lectura de los saldos derivados (los escribe solo un disparador de la base). Todo filtra por la empresa; una parte o un asiento de otra empresa
 * no existe (`null`, o saldo cero: sin oráculo de existencia).
 */
export interface RepositorioDeSaldos {
  /** El saldo de la parte en ese sentido: positivo = se debe; negativo = saldo a favor. Cero si nunca tuvo asientos. */
  saldoDeParte(empresa: EmpresaId, parteId: string, sentido: Sentido): Promise<Importe>;
  /** El desglose por centro de costo (sucursal ascendente, «sin centro» al final): su suma es `saldoDeParte`. */
  saldoPorCentroDeCosto(empresa: EmpresaId, parteId: string, sentido: Sentido): Promise<Reparto[]>;
  /** Cuánto de un asiento está imputado, su tope y si está anulado. `null` si no existe (o no tiene saldo propio: un espejo). */
  estadoDeAsiento(empresa: EmpresaId, asientoId: string): Promise<EstadoDeAsiento | null>;
}

export function crearRepositorioDeSaldos(db: Kysely<SaldosDb>): RepositorioDeSaldos {
  return {
    async saldoDeParte(empresa, parteId, sentido) {
      if (!esUuidCanonico(parteId)) return importeDesdeTexto(ARS, "0.00");
      const fila = await db
        .selectFrom("saldo_de_parte as s")
        .select(sql<string>`s.saldo::text`.as("saldo"))
        .where("s.empresa_id", "=", empresa)
        .where("s.parte_id", "=", parteId)
        .where("s.sentido", "=", sentido)
        .where("s.moneda", "=", ARS)
        .executeTakeFirst();
      return importeDesdeTexto(ARS, fila?.saldo ?? "0.00");
    },

    async saldoPorCentroDeCosto(empresa, parteId, sentido) {
      if (!esUuidCanonico(parteId)) return [];
      const filas = await db
        .selectFrom("saldo_de_parte_por_centro_de_costo as s")
        .select(["s.sucursal_id as sucursal_id", sql<string>`s.saldo::text`.as("saldo")])
        .where("s.empresa_id", "=", empresa)
        .where("s.parte_id", "=", parteId)
        .where("s.sentido", "=", sentido)
        .where("s.moneda", "=", ARS)
        .orderBy(sql`s.sucursal_id nulls last`)
        .execute();
      return filas.map((f) => ({
        centroDeCosto: f.sucursal_id,
        importe: importeDesdeTexto(ARS, f.saldo),
      }));
    },

    async estadoDeAsiento(empresa, asientoId) {
      if (!esUuidCanonico(asientoId)) return null;
      const fila = await db
        .selectFrom("saldo_de_asiento as s")
        .select([
          sql<string>`s.tope::text`.as("tope"),
          sql<string>`s.importe_imputado::text`.as("imputado"),
          "s.anulado as anulado",
        ])
        .where("s.empresa_id", "=", empresa)
        .where("s.asiento_id", "=", asientoId)
        .executeTakeFirst();
      return fila === undefined
        ? null
        : {
            tope: importeDesdeTexto(ARS, fila.tope),
            imputado: importeDesdeTexto(ARS, fila.imputado),
            anulado: fila.anulado,
          };
    },
  };
}
