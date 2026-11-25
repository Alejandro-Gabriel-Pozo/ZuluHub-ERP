import { sql, type Kysely } from "kysely";
import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import type { CausaDeCorreccion } from "../dominio/correccion-de-lo-recibido";
import type { ComprasDb } from "./esquema";
import { esUuid } from "./filas";

export type CorreccionDeLoRecibidoGuardada = Readonly<{
  id: string;
  recepcionId: string;
  linea: number;
  numero: number;
  cantidadAnterior: string;
  cantidadNueva: string;
  causa: CausaDeCorreccion;
  nota: string | null;
  movimientoId: string;
  claveIdempotencia: string;
  huella: string;
  registradoEn: Date;
  registradoPor: string;
}>;

export type AltaDeCorreccionDeLoRecibido = Readonly<{
  id: string;
  recepcionId: string;
  linea: number;
  numero: number;
  cantidadAnterior: string;
  cantidadNueva: string;
  causa: CausaDeCorreccion;
  nota: string | null;
  movimientoId: string;
  clave: string;
  huella: string;
  registradoPor: PersonaId;
}>;

/** Lo recibido y lo ya conciliado de una línea de recepción: el saldo vigente, el que dice lo que hay hoy (la línea original conserva lo que se cargó). */
export type SaldoDeLaLinea = Readonly<{ recibida: string; asignada: string }>;

/**
 * Las correcciones de lo recibido de las líneas de una recepción separada (E9 N3, 0098). Solo inserción: la línea original no se edita; lo vigente está en el saldo de la línea, que la base
 * ajusta con cada corrección. `insertar` usa `ON CONFLICT DO NOTHING` sin objetivo (cubre la clave y el número de la línea) y devuelve `false` si chocó: quien llama ya bloqueó la recepción y
 * la línea y buscó antes, así que un choque es una carrera que el bloqueo debería haber impedido.
 */
export interface RepositorioDeCorreccionesDeLoRecibido {
  porClave(empresa: EmpresaId, clave: string): Promise<CorreccionDeLoRecibidoGuardada | null>;
  /** La última corrección de la línea (la de mayor número), o `null`. */
  ultimaDeLaLinea(
    empresa: EmpresaId,
    recepcionId: string,
    linea: number,
  ): Promise<CorreccionDeLoRecibidoGuardada | null>;
  /** Todas las correcciones de la recepción, por línea y número. */
  deLaRecepcion(
    empresa: EmpresaId,
    recepcionId: string,
  ): Promise<readonly CorreccionDeLoRecibidoGuardada[]>;
  /** Lo recibido y lo conciliado vigentes de la línea, con `FOR UPDATE`: corregir, conciliar y anular una conciliación se serializan por esta fila. `null` si la línea no existe. */
  saldoBloqueado(
    empresa: EmpresaId,
    recepcionId: string,
    linea: number,
  ): Promise<SaldoDeLaLinea | null>;
  /** Lo recibido y lo conciliado vigentes de cada línea de la recepción, SIN bloquear: lo que muestran las pantallas. */
  saldosDeLaRecepcion(
    empresa: EmpresaId,
    recepcionId: string,
  ): Promise<readonly Readonly<{ linea: number; recibida: string; asignada: string }>[]>;
  insertar(empresa: EmpresaId, alta: AltaDeCorreccionDeLoRecibido): Promise<boolean>;
}

const COLUMNAS = [
  "id",
  "recepcion_id",
  "linea",
  "numero",
  "causa",
  "nota",
  "movimiento_id",
  "clave_idempotencia",
  "huella",
  "registrado_en",
  "registrado_por",
  sql<string>`cantidad_anterior::text`.as("cantidad_anterior"),
  sql<string>`cantidad_nueva::text`.as("cantidad_nueva"),
] as const;

type Fila = {
  id: string;
  recepcion_id: string;
  linea: number;
  numero: number;
  causa: string;
  nota: string | null;
  movimiento_id: string;
  clave_idempotencia: string;
  huella: string;
  registrado_en: Date;
  registrado_por: string;
  cantidad_anterior: string;
  cantidad_nueva: string;
};

function aCorreccion(f: Fila): CorreccionDeLoRecibidoGuardada {
  if (
    f.causa !== "ERROR_DE_CARGA" &&
    f.causa !== "REPARTO_INTERNO" &&
    f.causa !== "FALTANTE_DEL_PROVEEDOR"
  ) {
    throw new RangeError(`causa de corrección desconocida: ${f.causa}`);
  }
  return {
    id: f.id,
    recepcionId: f.recepcion_id,
    linea: f.linea,
    numero: f.numero,
    cantidadAnterior: f.cantidad_anterior,
    cantidadNueva: f.cantidad_nueva,
    causa: f.causa,
    nota: f.nota,
    movimientoId: f.movimiento_id,
    claveIdempotencia: f.clave_idempotencia,
    huella: f.huella,
    registradoEn: f.registrado_en,
    registradoPor: f.registrado_por,
  };
}

export function crearRepositorioDeCorreccionesDeLoRecibido(
  db: Kysely<ComprasDb>,
): RepositorioDeCorreccionesDeLoRecibido {
  return {
    async porClave(empresa, clave) {
      const fila = await db
        .selectFrom("correccion_de_lo_recibido")
        .select(COLUMNAS)
        .where("empresa_id", "=", empresa)
        .where("clave_idempotencia", "=", clave)
        .executeTakeFirst();
      return fila === undefined ? null : aCorreccion(fila);
    },
    async ultimaDeLaLinea(empresa, recepcionId, linea) {
      if (!esUuid(recepcionId)) return null;
      const fila = await db
        .selectFrom("correccion_de_lo_recibido")
        .select(COLUMNAS)
        .where("empresa_id", "=", empresa)
        .where("recepcion_id", "=", recepcionId)
        .where("linea", "=", linea)
        .orderBy("numero", "desc")
        .limit(1)
        .executeTakeFirst();
      return fila === undefined ? null : aCorreccion(fila);
    },
    async deLaRecepcion(empresa, recepcionId) {
      if (!esUuid(recepcionId)) return [];
      const filas = await db
        .selectFrom("correccion_de_lo_recibido")
        .select(COLUMNAS)
        .where("empresa_id", "=", empresa)
        .where("recepcion_id", "=", recepcionId)
        .orderBy("linea")
        .orderBy("numero")
        .execute();
      return filas.map(aCorreccion);
    },
    async saldoBloqueado(empresa, recepcionId, linea) {
      if (!esUuid(recepcionId)) return null;
      const fila = await db
        .selectFrom("saldo_de_linea_de_recepcion")
        .select([
          sql<string>`cantidad_recibida::text`.as("recibida"),
          sql<string>`cantidad_asignada::text`.as("asignada"),
        ])
        .where("empresa_id", "=", empresa)
        .where("recepcion_id", "=", recepcionId)
        .where("numero", "=", linea)
        .forUpdate()
        .executeTakeFirst();
      return fila === undefined ? null : { recibida: fila.recibida, asignada: fila.asignada };
    },
    async saldosDeLaRecepcion(empresa, recepcionId) {
      if (!esUuid(recepcionId)) return [];
      const filas = await db
        .selectFrom("saldo_de_linea_de_recepcion")
        .select([
          "numero",
          sql<string>`cantidad_recibida::text`.as("recibida"),
          sql<string>`cantidad_asignada::text`.as("asignada"),
        ])
        .where("empresa_id", "=", empresa)
        .where("recepcion_id", "=", recepcionId)
        .orderBy("numero")
        .execute();
      return filas.map((f) => ({ linea: f.numero, recibida: f.recibida, asignada: f.asignada }));
    },
    async insertar(empresa, alta) {
      const fila = await db
        .insertInto("correccion_de_lo_recibido")
        .values({
          id: alta.id,
          empresa_id: empresa,
          recepcion_id: alta.recepcionId,
          linea: alta.linea,
          numero: alta.numero,
          cantidad_anterior: alta.cantidadAnterior,
          cantidad_nueva: alta.cantidadNueva,
          causa: alta.causa,
          nota: alta.nota,
          movimiento_id: alta.movimientoId,
          clave_idempotencia: alta.clave,
          huella: alta.huella,
          registrado_por: alta.registradoPor,
        })
        .onConflict((oc) => oc.doNothing())
        .returning("numero")
        .executeTakeFirst();
      return fila !== undefined;
    },
  };
}
