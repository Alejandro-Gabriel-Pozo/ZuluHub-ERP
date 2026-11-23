import { sql, type Kysely } from "kysely";
import { importeATexto, importeDesdeTexto, type Importe } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import {
  esUuidCanonico,
  type EmpresaId,
  type PersonaId,
} from "../../../primitivas/identificadores/marca";
import type { Sentido } from "../dominio/clases";
import type { SaldosDb } from "./esquema";

/** Una imputación (importe > 0) o un deshacer (importe < 0). El saldante es el asiento que resta; el saldado, el que suma. */
export type ImputacionNueva = Readonly<{
  empresa: EmpresaId;
  numero: number;
  saldanteId: string;
  saldadoId: string;
  parteId: string;
  sentido: Sentido;
  importe: Importe;
  clave: string;
  huella: string;
  registradoPor: PersonaId;
}>;

export type ImputacionGuardada = Readonly<{
  id: string;
  numero: number;
  saldanteId: string;
  saldadoId: string;
  parteId: string;
  sentido: Sentido;
  importe: Importe;
  clave: string;
  huella: string;
}>;

/** Lo que hoy está imputado entre un par (neto de lo deshecho): solo los pares con algo vigente. */
export type ParImputado = Readonly<{ saldanteId: string; saldadoId: string; importe: Importe }>;

/**
 * Persistencia de las imputaciones (0092): solo inserción. Los topes (lo imputado nunca pasa el importe de un asiento ni baja de cero, ni por
 * par) los imponen los CHECK de los derivados: acá no hay «leer, decidir, escribir».
 */
export interface RepositorioDeImputaciones {
  /** Un renglón por vez y en el orden dado (los bloqueos de la base se toman en ese orden). Devuelve los ids que genera la base, en ese orden. */
  insertar(nuevas: readonly ImputacionNueva[]): Promise<string[]>;
  /** Los renglones de una operación (por su clave), por número. */
  porClave(empresa: EmpresaId, clave: string): Promise<ImputacionGuardada[]>;
  /** Los pares con algo imputado en los que participa el asiento, ordenados por (saldado, saldante). */
  paresVigentesDe(empresa: EmpresaId, asientoId: string): Promise<ParImputado[]>;
}

export function crearRepositorioDeImputaciones(db: Kysely<SaldosDb>): RepositorioDeImputaciones {
  return {
    async insertar(nuevas) {
      const ids: string[] = [];
      for (const n of nuevas) {
        const fila = await db
          .insertInto("imputacion_de_saldo")
          .values({
            empresa_id: n.empresa,
            numero: n.numero,
            saldante_id: n.saldanteId,
            saldado_id: n.saldadoId,
            parte_id: n.parteId,
            sentido: n.sentido,
            importe: importeATexto(n.importe),
            moneda: n.importe.moneda,
            clave_idempotencia: n.clave,
            huella: n.huella,
            registrado_por: n.registradoPor,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        ids.push(fila.id);
      }
      return ids;
    },

    async porClave(empresa, clave) {
      const filas = await db
        .selectFrom("imputacion_de_saldo as i")
        .select([
          "i.id as id",
          "i.numero as numero",
          "i.saldante_id as saldante_id",
          "i.saldado_id as saldado_id",
          "i.parte_id as parte_id",
          "i.sentido as sentido",
          sql<string>`i.importe::text`.as("importe"),
          "i.clave_idempotencia as clave",
          "i.huella as huella",
        ])
        .where("i.empresa_id", "=", empresa)
        .where("i.clave_idempotencia", "=", clave)
        .orderBy("i.numero")
        .execute();
      return filas.map((f) => ({
        id: f.id,
        numero: f.numero,
        saldanteId: f.saldante_id,
        saldadoId: f.saldado_id,
        parteId: f.parte_id,
        sentido: f.sentido,
        importe: importeDesdeTexto(ARS, f.importe),
        clave: f.clave,
        huella: f.huella,
      }));
    },

    async paresVigentesDe(empresa, asientoId) {
      if (!esUuidCanonico(asientoId)) return [];
      const filas = await db
        .selectFrom("saldo_de_imputacion as s")
        .select([
          "s.saldante_id as saldante_id",
          "s.saldado_id as saldado_id",
          sql<string>`s.importe::text`.as("importe"),
        ])
        .where("s.empresa_id", "=", empresa)
        .where("s.importe", ">", "0")
        .where((eb) =>
          eb.or([eb("s.saldante_id", "=", asientoId), eb("s.saldado_id", "=", asientoId)]),
        )
        .orderBy("s.saldado_id")
        .orderBy("s.saldante_id")
        .execute();
      return filas.map((f) => ({
        saldanteId: f.saldante_id,
        saldadoId: f.saldado_id,
        importe: importeDesdeTexto(ARS, f.importe),
      }));
    },
  };
}
