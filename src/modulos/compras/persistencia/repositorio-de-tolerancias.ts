import type { Kysely } from "kysely";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import type { Tolerancias } from "../dominio/diferencias";
import type { ComprasDb } from "./esquema";

export type ToleranciasGuardadas = Readonly<{ tolerancias: Tolerancias; version: number }>;

/**
 * Las tolerancias de la empresa (N4, 0067): una fila por empresa con las cuatro (`null` = no definida; no es cero). Sin fila, ninguna está definida. Las cambia el gerente; la
 * versión sirve para no pisar un cambio ajeno.
 */
export interface RepositorioDeTolerancias {
  leer(empresa: EmpresaId): Promise<ToleranciasGuardadas | null>;
  /** `false` si otra transacción la creó antes (la clave es la empresa). */
  insertar(empresa: EmpresaId, tolerancias: Tolerancias): Promise<boolean>;
  /** `false` si la versión ya no es la esperada. */
  actualizar(
    empresa: EmpresaId,
    versionEsperada: number,
    tolerancias: Tolerancias,
  ): Promise<boolean>;
}

export function crearRepositorioDeTolerancias(db: Kysely<ComprasDb>): RepositorioDeTolerancias {
  return {
    async leer(empresa) {
      const f = await db
        .selectFrom("tolerancia_de_compras")
        .select([
          "tolerancia_de_cantidad",
          "tolerancia_de_precio",
          "tolerancia_de_importe",
          "tolerancia_de_recepcion",
          "version",
        ])
        .where("empresa_id", "=", empresa)
        .executeTakeFirst();
      if (f === undefined) return null;
      return {
        tolerancias: {
          cantidad: f.tolerancia_de_cantidad,
          precio: f.tolerancia_de_precio,
          importe: f.tolerancia_de_importe,
          recepcion: f.tolerancia_de_recepcion,
        },
        version: f.version,
      };
    },
    async insertar(empresa, t) {
      const f = await db
        .insertInto("tolerancia_de_compras")
        .values({
          empresa_id: empresa,
          tolerancia_de_cantidad: t.cantidad,
          tolerancia_de_precio: t.precio,
          tolerancia_de_importe: t.importe,
          tolerancia_de_recepcion: t.recepcion,
        })
        .onConflict((oc) => oc.doNothing())
        .returning("empresa_id")
        .executeTakeFirst();
      return f !== undefined;
    },
    async actualizar(empresa, versionEsperada, t) {
      const f = await db
        .updateTable("tolerancia_de_compras")
        .set({
          tolerancia_de_cantidad: t.cantidad,
          tolerancia_de_precio: t.precio,
          tolerancia_de_importe: t.importe,
          tolerancia_de_recepcion: t.recepcion,
        })
        .where("empresa_id", "=", empresa)
        .where("version", "=", versionEsperada)
        .returning("empresa_id")
        .executeTakeFirst();
      return f !== undefined;
    },
  };
}
