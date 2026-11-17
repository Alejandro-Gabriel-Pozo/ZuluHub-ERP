import { sql, type Kysely } from "kysely";
import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import type { ComprasDb } from "./esquema";
import { esUuid } from "./filas";

export type CorreccionGuardada = Readonly<{
  recepcionId: string;
  linea: number;
  numero: number;
  /** `null` si la línea no tenía precio (se le puso uno). */
  precioAnterior: string | null;
  precioNuevo: string | null;
  motivo: string;
  claveIdempotencia: string;
  huella: string;
  registradoEn: Date;
  registradoPor: string;
}>;

export type AltaDeCorreccion = Readonly<{
  recepcionId: string;
  linea: number;
  numero: number;
  precioAnterior: string | null;
  precioNuevo: string;
  motivo: string;
  clave: string;
  huella: string;
  registradoPor: PersonaId;
}>;

/**
 * Las correcciones de las líneas de una compra (E9 §3.7). Solo inserción: la línea original no se edita, los valores vigentes son los de la última corrección.
 * `insertar` usa `ON CONFLICT DO NOTHING` sin objetivo (cubre la clave y el número de la línea) y devuelve `false` si chocó; quien llama ya bloqueó la recepción
 * y buscó antes, así que un choque es una carrera que el bloqueo debería haber impedido.
 */
export interface RepositorioDeCorrecciones {
  porClave(empresa: EmpresaId, clave: string): Promise<CorreccionGuardada | null>;
  /** La última corrección de la línea (la de mayor número), o `null`. */
  ultimaDeLaLinea(
    empresa: EmpresaId,
    recepcionId: string,
    linea: number,
  ): Promise<CorreccionGuardada | null>;
  /** Todas las correcciones de la compra, por línea y número. */
  deLaRecepcion(empresa: EmpresaId, recepcionId: string): Promise<readonly CorreccionGuardada[]>;
  insertar(empresa: EmpresaId, alta: AltaDeCorreccion): Promise<boolean>;
}

const COLUMNAS = [
  "recepcion_id",
  "linea",
  "numero",
  "motivo",
  "clave_idempotencia",
  "huella",
  "registrado_en",
  "registrado_por",
  sql<string | null>`precio_anterior::text`.as("precio_anterior"),
  sql<string | null>`precio_nuevo::text`.as("precio_nuevo"),
] as const;

type Fila = {
  recepcion_id: string;
  linea: number;
  numero: number;
  motivo: string;
  clave_idempotencia: string;
  huella: string;
  registrado_en: Date;
  registrado_por: string;
  precio_anterior: string | null;
  precio_nuevo: string | null;
};

const aCorreccion = (f: Fila): CorreccionGuardada => ({
  recepcionId: f.recepcion_id,
  linea: f.linea,
  numero: f.numero,
  precioAnterior: f.precio_anterior,
  precioNuevo: f.precio_nuevo,
  motivo: f.motivo,
  claveIdempotencia: f.clave_idempotencia,
  huella: f.huella,
  registradoEn: f.registrado_en,
  registradoPor: f.registrado_por,
});

export function crearRepositorioDeCorrecciones(db: Kysely<ComprasDb>): RepositorioDeCorrecciones {
  return {
    async porClave(empresa, clave) {
      const fila = await db
        .selectFrom("correccion_de_compra")
        .select(COLUMNAS)
        .where("empresa_id", "=", empresa)
        .where("clave_idempotencia", "=", clave)
        .executeTakeFirst();
      return fila === undefined ? null : aCorreccion(fila);
    },
    async ultimaDeLaLinea(empresa, recepcionId, linea) {
      if (!esUuid(recepcionId)) return null;
      const fila = await db
        .selectFrom("correccion_de_compra")
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
        .selectFrom("correccion_de_compra")
        .select(COLUMNAS)
        .where("empresa_id", "=", empresa)
        .where("recepcion_id", "=", recepcionId)
        .orderBy("linea")
        .orderBy("numero")
        .execute();
      return filas.map(aCorreccion);
    },
    async insertar(empresa, alta) {
      const fila = await db
        .insertInto("correccion_de_compra")
        .values({
          empresa_id: empresa,
          recepcion_id: alta.recepcionId,
          linea: alta.linea,
          numero: alta.numero,
          precio_anterior: alta.precioAnterior,
          precio_nuevo: alta.precioNuevo,
          cantidad_anterior: null,
          cantidad_nueva: null,
          motivo: alta.motivo,
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
