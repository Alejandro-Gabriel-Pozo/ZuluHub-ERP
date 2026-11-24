import { sql, type Kysely } from "kysely";
import { importeATexto, importeDesdeTexto, type Importe } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import {
  personaId,
  esUuidCanonico,
  type EmpresaId,
  type PersonaId,
} from "../../../primitivas/identificadores/marca";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import type { Sentido } from "../dominio/clases";
import type { Reparto } from "../dominio/distribucion";
import type { SaldosDb } from "./esquema";

/** Un asiento por alta. Lo calcula la base: `id`, `registrado_en` y `fecha_negocio` (de la zona de la empresa). */
export type AsientoNuevo = Readonly<{
  empresa: EmpresaId;
  parteId: string;
  sentido: Sentido;
  clase: string;
  naturaleza: "ORIGINAL" | "ANULACION";
  importe: Importe;
  origenTipo: string;
  origenId: string;
  origenOrden: number;
  referenciaTipo: string | null;
  referenciaId: string | null;
  venceEl: FechaCivil | null;
  detalle: string | null;
  anulaA: string | null;
  clave: string;
  huella: string;
  hechoEn: Date;
  registradoPor: PersonaId;
}>;

export type AsientoGuardado = Readonly<{
  id: string;
  parteId: string;
  sentido: Sentido;
  clase: string;
  naturaleza: "ORIGINAL" | "ANULACION";
  importe: Importe;
  origenTipo: string;
  origenId: string;
  origenOrden: number;
  referenciaTipo: string | null;
  referenciaId: string | null;
  venceEl: FechaCivil | null;
  detalle: string | null;
  anulaA: string | null;
  clave: string;
  huella: string;
  hechoEn: Date;
  registradoEn: Date;
  fechaNegocio: FechaCivil;
  registradoPor: PersonaId;
}>;

/**
 * Persistencia del libro de asientos (0092): solo inserción (disparadores de la base, también para el dueño). La base repite todas las reglas
 * (signo de la clase, espejo exacto, distribución que suma, parte activa). Toda lectura filtra por la empresa.
 */
export interface RepositorioDeAsientos {
  /** Alta del asiento; devuelve el id que genera la base. Una clave repetida choca con `asiento_de_saldo_clave_uk`. */
  insertar(nuevo: AsientoNuevo): Promise<string>;
  /** Los renglones de la distribución por centro de costo, en el orden dado. Se confirman juntos con el asiento: la base lo verifica al `COMMIT`. */
  insertarDistribucion(
    empresa: EmpresaId,
    asientoId: string,
    reparto: readonly Reparto[],
  ): Promise<void>;
  /** El asiento hecho con esa clave de idempotencia, si hay. */
  porClave(empresa: EmpresaId, clave: string): Promise<AsientoGuardado | null>;
  /** El asiento ORIGINAL de ese origen y orden (el espejo comparte origen y no cuenta). */
  porOrigen(
    empresa: EmpresaId,
    tipo: string,
    id: string,
    orden: number,
  ): Promise<AsientoGuardado | null>;
  obtener(empresa: EmpresaId, id: string): Promise<AsientoGuardado | null>;
  /** La distribución por centro de costo de un asiento, en el orden fijo (sucursal ascendente, «sin centro» al final). */
  distribucionDe(empresa: EmpresaId, asientoId: string): Promise<Reparto[]>;
}

type Fila = Readonly<{
  id: string;
  parte_id: string;
  sentido: Sentido;
  clase: string;
  naturaleza: "ORIGINAL" | "ANULACION";
  importe: string;
  origen_tipo: string;
  origen_id: string;
  origen_orden: number;
  referencia_tipo: string | null;
  referencia_id: string | null;
  vence_el: string | null;
  detalle: string | null;
  anula_a: string | null;
  clave_idempotencia: string;
  huella: string;
  hecho_en: Date;
  registrado_en: Date;
  fecha_negocio: string;
  registrado_por: string;
}>;

const aGuardado = (f: Fila): AsientoGuardado => ({
  id: f.id,
  parteId: f.parte_id,
  sentido: f.sentido,
  clase: f.clase,
  naturaleza: f.naturaleza,
  importe: importeDesdeTexto(ARS, f.importe),
  origenTipo: f.origen_tipo,
  origenId: f.origen_id,
  origenOrden: f.origen_orden,
  referenciaTipo: f.referencia_tipo,
  referenciaId: f.referencia_id,
  venceEl: f.vence_el as FechaCivil | null,
  detalle: f.detalle,
  anulaA: f.anula_a,
  clave: f.clave_idempotencia,
  huella: f.huella,
  hechoEn: f.hecho_en,
  registradoEn: f.registrado_en,
  fechaNegocio: f.fecha_negocio as FechaCivil,
  registradoPor: personaId(f.registrado_por),
});

export function crearRepositorioDeAsientos(db: Kysely<SaldosDb>): RepositorioDeAsientos {
  const columnas = [
    "a.id as id",
    "a.parte_id as parte_id",
    "a.sentido as sentido",
    "a.clase as clase",
    "a.naturaleza as naturaleza",
    sql<string>`a.importe::text`.as("importe"),
    "a.origen_tipo as origen_tipo",
    "a.origen_id as origen_id",
    "a.origen_orden as origen_orden",
    "a.referencia_tipo as referencia_tipo",
    "a.referencia_id as referencia_id",
    sql<string | null>`a.vence_el::text`.as("vence_el"),
    "a.detalle as detalle",
    "a.anula_a as anula_a",
    "a.clave_idempotencia as clave_idempotencia",
    "a.huella as huella",
    "a.hecho_en as hecho_en",
    "a.registrado_en as registrado_en",
    sql<string>`a.fecha_negocio::text`.as("fecha_negocio"),
    "a.registrado_por as registrado_por",
  ] as const;

  return {
    async insertar(nuevo) {
      const fila = await db
        .insertInto("asiento_de_saldo")
        .values({
          empresa_id: nuevo.empresa,
          parte_id: nuevo.parteId,
          sentido: nuevo.sentido,
          clase: nuevo.clase,
          naturaleza: nuevo.naturaleza,
          importe: importeATexto(nuevo.importe),
          moneda: nuevo.importe.moneda,
          origen_tipo: nuevo.origenTipo,
          origen_id: nuevo.origenId,
          origen_orden: nuevo.origenOrden,
          referencia_tipo: nuevo.referenciaTipo,
          referencia_id: nuevo.referenciaId,
          vence_el: nuevo.venceEl,
          detalle: nuevo.detalle,
          anula_a: nuevo.anulaA,
          clave_idempotencia: nuevo.clave,
          huella: nuevo.huella,
          hecho_en: nuevo.hechoEn,
          registrado_por: nuevo.registradoPor,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return fila.id;
    },

    async insertarDistribucion(empresa, asientoId, reparto) {
      // Un renglón por vez y en el orden dado: el disparador de cada uno suma al desglose por centro de costo.
      for (const r of reparto) {
        await db
          .insertInto("distribucion_de_asiento")
          .values({
            empresa_id: empresa,
            asiento_id: asientoId,
            sucursal_id: r.centroDeCosto,
            importe: importeATexto(r.importe),
            moneda: r.importe.moneda,
          })
          .execute();
      }
    },

    async porClave(empresa, clave) {
      const fila = await db
        .selectFrom("asiento_de_saldo as a")
        .select(columnas)
        .where("a.empresa_id", "=", empresa)
        .where("a.clave_idempotencia", "=", clave)
        .executeTakeFirst();
      return fila === undefined ? null : aGuardado(fila);
    },

    async porOrigen(empresa, tipo, id, orden) {
      if (!esUuidCanonico(id)) return null;
      const fila = await db
        .selectFrom("asiento_de_saldo as a")
        .select(columnas)
        .where("a.empresa_id", "=", empresa)
        .where("a.origen_tipo", "=", tipo)
        .where("a.origen_id", "=", id)
        .where("a.origen_orden", "=", orden)
        .where("a.anula_a", "is", null)
        .executeTakeFirst();
      return fila === undefined ? null : aGuardado(fila);
    },

    async obtener(empresa, id) {
      if (!esUuidCanonico(id)) return null;
      const fila = await db
        .selectFrom("asiento_de_saldo as a")
        .select(columnas)
        .where("a.empresa_id", "=", empresa)
        .where("a.id", "=", id)
        .executeTakeFirst();
      return fila === undefined ? null : aGuardado(fila);
    },

    async distribucionDe(empresa, asientoId) {
      if (!esUuidCanonico(asientoId)) return [];
      const filas = await db
        .selectFrom("distribucion_de_asiento as d")
        .select(["d.sucursal_id as sucursal_id", sql<string>`d.importe::text`.as("importe")])
        .where("d.empresa_id", "=", empresa)
        .where("d.asiento_id", "=", asientoId)
        .orderBy(sql`d.sucursal_id nulls last`)
        .execute();
      return filas.map((f) => ({
        centroDeCosto: f.sucursal_id,
        importe: importeDesdeTexto(ARS, f.importe),
      }));
    },
  };
}
