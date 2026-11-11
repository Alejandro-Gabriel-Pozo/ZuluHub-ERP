import type { Kysely } from "kysely";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import type { ComprasDb } from "./esquema";
import { esUuid } from "./filas";

/** Lo que compras necesita saber de un producto del catálogo para comprarlo: qué es, si está activo, su unidad base y su dimensión. */
export type ProductoParaCompras = Readonly<{
  id: string;
  nombre: string;
  claseDeUso: string;
  activo: boolean;
  unidadBaseId: string;
  dimension: string;
}>;

/**
 * Las columnas que compras LEE de `producto` (0025), una por una: se declaran en `esquema.ts` y `COLUMNAS_QUE_LEE_COMPRAS` las repite para que la prueba
 * (`compras-persistencia.test.ts`) las compare con el catálogo real: si el catálogo cambia o quita una, falla ahí y no en producción. Compras no escribe esta tabla.
 */
export const COLUMNAS_QUE_LEE_COMPRAS = [
  "id",
  "empresa_id",
  "nombre",
  "clase_de_uso",
  "unidad_base_id",
  "dimension",
  "activo",
] as const;

export interface ProductosParaCompras {
  obtener(empresa: EmpresaId, id: string): Promise<ProductoParaCompras | null>;
  /** Igual que `obtener`, con la fila bloqueada en modo compartido: nadie lo desactiva ni lo cambia mientras dura la transacción. */
  bloquearCompartido(empresa: EmpresaId, id: string): Promise<ProductoParaCompras | null>;
}

export function crearProductosParaCompras(db: Kysely<ComprasDb>): ProductosParaCompras {
  async function leer(empresa: EmpresaId, id: string, bloquear: boolean) {
    if (!esUuid(id)) return null;
    let consulta = db
      .selectFrom("producto")
      .select(COLUMNAS_QUE_LEE_COMPRAS)
      .where("empresa_id", "=", empresa)
      .where("id", "=", id);
    if (bloquear) consulta = consulta.forShare();
    const f = await consulta.executeTakeFirst();
    if (f === undefined) return null;
    return {
      id: f.id,
      nombre: f.nombre,
      claseDeUso: f.clase_de_uso,
      activo: f.activo,
      unidadBaseId: f.unidad_base_id,
      dimension: f.dimension,
    };
  }
  return {
    obtener: (empresa, id) => leer(empresa, id, false),
    bloquearCompartido: (empresa, id) => leer(empresa, id, true),
  };
}
