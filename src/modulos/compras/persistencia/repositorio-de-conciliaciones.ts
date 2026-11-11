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
}>;

export type AsignacionGuardada = Readonly<{
  numero: number;
  lineaDeComprobante: number;
  recepcionId: string;
  lineaDeRecepcion: number;
  /** Con signo: positiva al conciliar, negativa en el espejo. */
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

export function crearRepositorioDeConciliaciones(
  db: Kysely<ComprasDb>,
): RepositorioDeConciliaciones {
  return {
    async conciliacionesDe(empresa, comprobanteId) {
      if (!esUuid(comprobanteId)) return [];
      const filas = await db
        .selectFrom("conciliacion")
        .select(["id", "acto", "anula_a", "comprobante_id"])
        .where("empresa_id", "=", empresa)
        .where("comprobante_id", "=", comprobanteId)
        .orderBy("registrado_en")
        .orderBy("acto")
        .execute();
      return filas.map((f) => ({
        id: f.id,
        acto: f.acto === "ANULACION" ? "ANULACION" : "CONCILIACION",
        anulaA: f.anula_a,
        comprobanteId: f.comprobante_id,
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
