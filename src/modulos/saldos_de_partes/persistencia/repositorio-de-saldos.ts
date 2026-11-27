import { sql, type Kysely } from "kysely";
import { importeDesdeTexto, type Importe } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { esUuidCanonico, type EmpresaId } from "../../../primitivas/identificadores/marca";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import type { Sentido } from "../dominio/clases";
import type { Reparto } from "../dominio/distribucion";
import { estaVencida } from "../dominio/vencida";
import type { SaldosDb } from "./esquema";
import {
  aPartida,
  crearLecturasDeVariasPartes,
  partidasAbiertas,
  type CargoPendiente,
  type CargoPendienteDeParte,
  type LadoDePartida,
  type LecturasDeVariasPartes,
  type MovimientoDelLibro,
  type PartidaAbierta,
  type SaldoDeParte,
} from "./lecturas-de-varias-partes";

export type EstadoDeAsiento = Readonly<{
  /** El importe del asiento, en positivo. */
  tope: Importe;
  imputado: Importe;
  anulado: boolean;
}>;

/** Una línea del estado de cuenta: el asiento con SU signo (el importe es el de la base: positivo suma lo que se debe, negativo lo resta) y el saldo corrido. */
export type LineaDeCuenta = Readonly<{
  asientoId: string;
  clase: string;
  naturaleza: "ORIGINAL" | "ANULACION";
  importe: Importe;
  saldoAcumulado: Importe;
  fechaNegocio: FechaCivil;
  registradoEn: Date;
  venceEl: FechaCivil | null;
  referenciaTipo: string | null;
  referenciaId: string | null;
  detalle: string | null;
  anulaA: string | null;
  /** De qué hecho sale el asiento (CC-5: el ticket o la cobranza que lo originó); el espejo de una anulación lleva el MISMO origen que el asiento que anula. */
  origenTipo: string;
  origenId: string;
}>;

export type {
  CargoPendiente,
  CargoPendienteDeParte,
  LadoDePartida,
  MovimientoDelLibro,
  PartidaAbierta,
  SaldoDeParte,
};

/** Los tipos con que preguntan las consultas, que no importan el dominio (ADR-005): los reexporta la persistencia. */
export type { Reparto, Sentido };

/**
 * Lectura de los saldos derivados (los escribe solo un disparador de la base). Todo filtra por la empresa; una parte o un asiento de otra empresa
 * no existe (`null`, o saldo cero: sin oráculo de existencia).
 */
export interface RepositorioDeSaldos extends LecturasDeVariasPartes {
  /** El saldo de la parte en ese sentido: positivo = se debe; negativo = saldo a favor. Cero si nunca tuvo asientos. */
  saldoDeParte(empresa: EmpresaId, parteId: string, sentido: Sentido): Promise<Importe>;
  /** El desglose por centro de costo (sucursal ascendente, «sin centro» al final): su suma es `saldoDeParte`. */
  saldoPorCentroDeCosto(empresa: EmpresaId, parteId: string, sentido: Sentido): Promise<Reparto[]>;
  /** Cuánto de un asiento está imputado, su tope y si está anulado. `null` si no existe (o no tiene saldo propio: un espejo). */
  estadoDeAsiento(empresa: EmpresaId, asientoId: string): Promise<EstadoDeAsiento | null>;
  /**
   * El estado de cuenta: TODOS los asientos de la parte en orden de registro (con las anulaciones como líneas propias, nada se oculta), cada uno con el
   * saldo corrido desde el primero. `desde` y `hasta` (fecha de negocio, inclusive) recortan lo que se devuelve pero NO el saldo corrido, que siempre
   * es el real. La suma de todos los importes es `saldoDeParte`.
   */
  estadoDeCuenta(
    empresa: EmpresaId,
    parteId: string,
    sentido: Sentido,
    desde: FechaCivil | null,
    hasta: FechaCivil | null,
  ): Promise<LineaDeCuenta[]>;
  /** Los cargos con algo pendiente (los anulados y los espejos no cuentan), por vencimiento (sin vencimiento al final) y antigüedad, cada uno con su «vencida» a `hoy`. */
  cargosAbiertos(
    empresa: EmpresaId,
    parteId: string,
    sentido: Sentido,
    hoy: FechaCivil,
  ): Promise<CargoPendiente[]>;
  /** Los saldos a favor con algo por aplicar, y lo que les queda. */
  creditosAbiertos(
    empresa: EmpresaId,
    parteId: string,
    sentido: Sentido,
  ): Promise<PartidaAbierta[]>;
}

export function crearRepositorioDeSaldos(db: Kysely<SaldosDb>): RepositorioDeSaldos {
  return {
    ...crearLecturasDeVariasPartes(db),
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

    async estadoDeCuenta(empresa, parteId, sentido, desde, hasta) {
      if (!esUuidCanonico(parteId)) return [];
      // El saldo corrido se calcula sobre TODOS los asientos (ventana) y el recorte por fecha se aplica DESPUÉS, sobre la subconsulta.
      const todos = db
        .selectFrom("asiento_de_saldo as a")
        .select([
          "a.id as id",
          "a.clase as clase",
          "a.naturaleza as naturaleza",
          sql<string>`a.importe::text`.as("importe"),
          sql<string>`(sum(a.importe) over (order by a.registrado_en, a.id))::text`.as("acumulado"),
          sql<string>`a.fecha_negocio::text`.as("fecha_negocio"),
          "a.registrado_en as registrado_en",
          sql<string | null>`a.vence_el::text`.as("vence_el"),
          "a.referencia_tipo as referencia_tipo",
          "a.referencia_id as referencia_id",
          "a.detalle as detalle",
          "a.anula_a as anula_a",
          "a.origen_tipo as origen_tipo",
          sql<string>`a.origen_id::text`.as("origen_id"),
        ])
        .where("a.empresa_id", "=", empresa)
        .where("a.parte_id", "=", parteId)
        .where("a.sentido", "=", sentido)
        .where("a.moneda", "=", ARS);
      let consulta = db.selectFrom(todos.as("t")).selectAll("t");
      if (desde !== null)
        consulta = consulta.where(sql`t.fecha_negocio::date`, ">=", sql`${desde}::date`);
      if (hasta !== null)
        consulta = consulta.where(sql`t.fecha_negocio::date`, "<=", sql`${hasta}::date`);
      const filas = await consulta.orderBy("t.registrado_en").orderBy("t.id").execute();
      return filas.map((f) => ({
        asientoId: f.id,
        clase: f.clase,
        naturaleza: f.naturaleza,
        importe: importeDesdeTexto(ARS, f.importe),
        saldoAcumulado: importeDesdeTexto(ARS, f.acumulado),
        fechaNegocio: f.fecha_negocio as FechaCivil,
        registradoEn: f.registrado_en,
        venceEl: f.vence_el === null ? null : (f.vence_el as FechaCivil),
        referenciaTipo: f.referencia_tipo,
        referenciaId: f.referencia_id,
        detalle: f.detalle,
        anulaA: f.anula_a,
        origenTipo: f.origen_tipo,
        origenId: f.origen_id,
      }));
    },

    async cargosAbiertos(empresa, parteId, sentido, hoy) {
      const partidas = await partidasAbiertas(db, empresa, [parteId], sentido, "CARGOS");
      return partidas.map((p) => ({ ...aPartida(p), vencida: estaVencida(p.venceEl, hoy) }));
    },

    async creditosAbiertos(empresa, parteId, sentido) {
      const partidas = await partidasAbiertas(db, empresa, [parteId], sentido, "CREDITOS");
      return partidas.map(aPartida);
    },
  };
}
