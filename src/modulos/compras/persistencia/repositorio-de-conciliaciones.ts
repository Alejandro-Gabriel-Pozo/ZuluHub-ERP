import { sql, type Kysely } from "kysely";
import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import type { NivelDeCompra } from "../dominio/niveles";
import type { ComprasDb } from "./esquema";
import { esUuid } from "./filas";

export type ConciliacionGuardada = Readonly<{
  id: string;
  acto: "CONCILIACION" | "ANULACION";
  anulaA: string | null;
  comprobanteId: string;
  /** `true`: la del atajo de N1 y N2 (nace con la compra); no se anula por separado. */
  esAtajo: boolean;
}>;

export type SaldoDeLineaFacturada = Readonly<{
  linea: number;
  facturada: string;
  asignada: string;
}>;

export type AsignacionGuardada = Readonly<{
  numero: number;
  lineaDeComprobante: number;
  recepcionId: string;
  lineaDeRecepcion: number;
  /** Con signo: positiva al conciliar, negativa en el espejo. */
  cantidad: string;
}>;

/** Una conciliación hecha de la factura, para mostrarla: cuándo (fecha de negocio, hora de Argentina), si ya se anuló y qué repartió. */
export type ConciliacionParaMostrar = Readonly<{
  id: string;
  fechaNegocio: string;
  anulada: boolean;
  asignaciones: readonly Readonly<{
    lineaDeComprobante: number;
    recepcionId: string;
    recepcionNumero: number;
    sucursalId: string;
    lineaDeRecepcion: number;
    cantidad: string;
  }>[];
}>;

/** Lo conciliado todavía vigente de una línea recibida contra una línea de factura: la suma neta de sus asignaciones y de sus espejos, solo si es mayor que cero. */
export type AsignacionVigenteDeLaLinea = Readonly<{
  recepcionId: string;
  lineaDeRecepcion: number;
  comprobanteId: string;
  lineaDeComprobante: number;
  cantidad: string;
}>;

/**
 * Las conciliaciones de un comprobante con lo recibido (E9 §3.3): el acto de conciliar y, una sola vez, su anulación espejo con las cantidades opuestas;
 * cada asignación solo entra si no supera lo recibido ni lo facturado (lo impone la base con los saldos). Solo inserción.
 */
export interface RepositorioDeConciliaciones {
  /** La conciliación (acto `CONCILIACION`) del comprobante y, si la hay, su anulación espejo. */
  conciliacionesDe(
    empresa: EmpresaId,
    comprobanteId: string,
  ): Promise<readonly ConciliacionGuardada[]>;
  /** La conciliación (o su espejo) con esa clave de idempotencia. */
  porClave(empresa: EmpresaId, clave: string): Promise<ConciliacionGuardada | null>;
  obtener(empresa: EmpresaId, id: string): Promise<ConciliacionGuardada | null>;
  /** Lo facturado y lo ya asignado de cada línea del comprobante (los saldos que mantiene la base). */
  saldosDeFactura(
    empresa: EmpresaId,
    comprobanteId: string,
  ): Promise<readonly SaldoDeLineaFacturada[]>;
  /** Las conciliaciones (acto `CONCILIACION`, sin el atajo) de la factura, la más vieja primero, con lo que repartió cada una y si ya se anuló. Solo lectura. */
  historialDe(
    empresa: EmpresaId,
    comprobanteId: string,
  ): Promise<readonly ConciliacionParaMostrar[]>;
  /** Lo conciliado todavía vigente de las líneas de esas recepciones (neto de espejos): una fila por línea recibida y línea de factura con saldo asignado. Solo lectura. */
  vigentesDeLasRecepciones(
    empresa: EmpresaId,
    recepcionIds: readonly string[],
  ): Promise<readonly AsignacionVigenteDeLaLinea[]>;
  insertarConciliacion(
    empresa: EmpresaId,
    alta: Readonly<{
      acto: "CONCILIACION" | "ANULACION";
      anulaA: string | null;
      comprobanteId: string;
      esAtajo: boolean;
      nivel: NivelDeCompra;
      clave: string;
      registradoPor: PersonaId;
    }>,
  ): Promise<string | undefined>;
  insertarAsignaciones(
    empresa: EmpresaId,
    conciliacion: Readonly<{
      id: string;
      acto: "CONCILIACION" | "ANULACION";
      comprobanteId: string;
    }>,
    asignaciones: readonly AsignacionGuardada[],
  ): Promise<void>;
  asignacionesDe(
    empresa: EmpresaId,
    conciliacionId: string,
  ): Promise<readonly AsignacionGuardada[]>;
}

const COLUMNAS_DE_CONCILIACION = ["id", "acto", "anula_a", "comprobante_id", "es_atajo"] as const;

function aConciliacion(f: {
  id: string;
  acto: string;
  anula_a: string | null;
  comprobante_id: string;
  es_atajo: boolean;
}): ConciliacionGuardada {
  return {
    id: f.id,
    acto: f.acto === "ANULACION" ? "ANULACION" : "CONCILIACION",
    anulaA: f.anula_a,
    comprobanteId: f.comprobante_id,
    esAtajo: f.es_atajo,
  };
}

export function crearRepositorioDeConciliaciones(
  db: Kysely<ComprasDb>,
): RepositorioDeConciliaciones {
  return {
    async conciliacionesDe(empresa, comprobanteId) {
      if (!esUuid(comprobanteId)) return [];
      const filas = await db
        .selectFrom("conciliacion")
        .select(["id", "acto", "anula_a", "comprobante_id", "es_atajo"])
        .where("empresa_id", "=", empresa)
        .where("comprobante_id", "=", comprobanteId)
        .orderBy("registrado_en")
        .orderBy("acto")
        .execute();
      return filas.map(aConciliacion);
    },
    async porClave(empresa, clave) {
      const fila = await db
        .selectFrom("conciliacion")
        .select(COLUMNAS_DE_CONCILIACION)
        .where("empresa_id", "=", empresa)
        .where("clave_idempotencia", "=", clave)
        .executeTakeFirst();
      return fila === undefined ? null : aConciliacion(fila);
    },
    async obtener(empresa, id) {
      if (!esUuid(id)) return null;
      const fila = await db
        .selectFrom("conciliacion")
        .select(COLUMNAS_DE_CONCILIACION)
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .executeTakeFirst();
      return fila === undefined ? null : aConciliacion(fila);
    },
    async saldosDeFactura(empresa, comprobanteId) {
      if (!esUuid(comprobanteId)) return [];
      const filas = await db
        .selectFrom("saldo_de_linea_de_comprobante")
        .select([
          "numero",
          sql<string>`cantidad_facturada::text`.as("facturada"),
          sql<string>`cantidad_asignada::text`.as("asignada"),
        ])
        .where("empresa_id", "=", empresa)
        .where("comprobante_id", "=", comprobanteId)
        .orderBy("numero")
        .execute();
      return filas.map((f) => ({ linea: f.numero, facturada: f.facturada, asignada: f.asignada }));
    },
    async historialDe(empresa, comprobanteId) {
      if (!esUuid(comprobanteId)) return [];
      const conciliaciones = await db
        .selectFrom("conciliacion as c")
        .select([
          "c.id",
          sql<string>`to_char(c.registrado_en at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD')`.as(
            "fecha_negocio",
          ),
          sql<boolean>`exists (select 1 from conciliacion e
            where e.empresa_id = c.empresa_id and e.anula_a = c.id and e.acto = 'ANULACION')`.as(
            "anulada",
          ),
        ])
        .where("c.empresa_id", "=", empresa)
        .where("c.comprobante_id", "=", comprobanteId)
        .where("c.acto", "=", "CONCILIACION")
        .where("c.es_atajo", "=", false)
        .orderBy("c.registrado_en")
        .orderBy("c.id")
        .execute();
      if (conciliaciones.length === 0) return [];
      const asignaciones = await db
        .selectFrom("asignacion_de_conciliacion as a")
        .innerJoin("recepcion as r", (j) =>
          j.onRef("r.empresa_id", "=", "a.empresa_id").onRef("r.id", "=", "a.recepcion_id"),
        )
        .select([
          "a.conciliacion_id",
          "a.linea_de_comprobante",
          "a.recepcion_id",
          "r.numero as recepcion_numero",
          "r.sucursal_id",
          "a.linea_de_recepcion",
          sql<string>`a.cantidad::text`.as("cantidad"),
        ])
        .where("a.empresa_id", "=", empresa)
        .where("a.comprobante_id", "=", comprobanteId)
        .where("a.acto", "=", "CONCILIACION")
        .orderBy("a.conciliacion_id")
        .orderBy("a.numero")
        .execute();
      return conciliaciones.map((c) => ({
        id: c.id,
        fechaNegocio: c.fecha_negocio,
        anulada: c.anulada,
        asignaciones: asignaciones
          .filter((a) => a.conciliacion_id === c.id)
          .map((a) => ({
            lineaDeComprobante: a.linea_de_comprobante,
            recepcionId: a.recepcion_id,
            recepcionNumero: a.recepcion_numero,
            sucursalId: a.sucursal_id,
            lineaDeRecepcion: a.linea_de_recepcion,
            cantidad: a.cantidad,
          })),
      }));
    },
    async vigentesDeLasRecepciones(empresa, recepcionIds) {
      const ids = recepcionIds.filter(esUuid);
      if (ids.length === 0) return [];
      const filas = await db
        .selectFrom("asignacion_de_conciliacion")
        .select([
          "recepcion_id",
          "linea_de_recepcion",
          "comprobante_id",
          "linea_de_comprobante",
          sql<string>`sum(cantidad)::text`.as("cantidad"),
        ])
        .where("empresa_id", "=", empresa)
        .where("recepcion_id", "in", ids)
        .groupBy(["recepcion_id", "linea_de_recepcion", "comprobante_id", "linea_de_comprobante"])
        .having(sql`sum(cantidad)`, ">", sql`0`)
        .orderBy("recepcion_id")
        .orderBy("linea_de_recepcion")
        .orderBy("comprobante_id")
        .orderBy("linea_de_comprobante")
        .execute();
      return filas.map((f) => ({
        recepcionId: f.recepcion_id,
        lineaDeRecepcion: f.linea_de_recepcion,
        comprobanteId: f.comprobante_id,
        lineaDeComprobante: f.linea_de_comprobante,
        cantidad: f.cantidad,
      }));
    },
    async insertarConciliacion(empresa, alta) {
      const fila = await db
        .insertInto("conciliacion")
        .values({
          empresa_id: empresa,
          acto: alta.acto,
          anula_a: alta.anulaA,
          comprobante_id: alta.comprobanteId,
          es_atajo: alta.esAtajo,
          nivel: alta.nivel,
          clave_idempotencia: alta.clave,
          registrado_por: alta.registradoPor,
        })
        .onConflict((oc) => oc.doNothing())
        .returning("id")
        .executeTakeFirst();
      return fila?.id;
    },
    async insertarAsignaciones(empresa, conciliacion, asignaciones) {
      if (asignaciones.length === 0) return;
      await db
        .insertInto("asignacion_de_conciliacion")
        .values(
          asignaciones.map((a) => ({
            empresa_id: empresa,
            conciliacion_id: conciliacion.id,
            acto: conciliacion.acto,
            numero: a.numero,
            comprobante_id: conciliacion.comprobanteId,
            linea_de_comprobante: a.lineaDeComprobante,
            recepcion_id: a.recepcionId,
            linea_de_recepcion: a.lineaDeRecepcion,
            cantidad: a.cantidad,
          })),
        )
        .execute();
    },
    async asignacionesDe(empresa, conciliacionId) {
      if (!esUuid(conciliacionId)) return [];
      const filas = await db
        .selectFrom("asignacion_de_conciliacion")
        .select([
          "numero",
          "linea_de_comprobante",
          "recepcion_id",
          "linea_de_recepcion",
          sql<string>`cantidad::text`.as("cantidad"),
        ])
        .where("empresa_id", "=", empresa)
        .where("conciliacion_id", "=", conciliacionId)
        .orderBy("numero")
        .execute();
      return filas.map((f) => ({
        numero: f.numero,
        lineaDeComprobante: f.linea_de_comprobante,
        recepcionId: f.recepcion_id,
        lineaDeRecepcion: f.linea_de_recepcion,
        cantidad: f.cantidad,
      }));
    },
  };
}
