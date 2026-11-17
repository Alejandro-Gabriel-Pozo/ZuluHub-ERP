import type { Kysely } from "kysely";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import type { StockDb } from "./esquema";
import { aArticulo, esUuid } from "./filas";
import type { Articulo } from "./modelo";

export type AltaDeArticulo = Readonly<{
  productoId: string;
  /** La unidad base del producto: la base la exige con una clave foránea compuesta. */
  unidadDeStockId: string;
  dimension: string;
}>;

export interface RepositorioDeArticulos {
  obtener(empresa: EmpresaId, id: string): Promise<Articulo | null>;
  /** El artículo de ese producto (activo o no), o `null`: un producto tiene a lo sumo uno (única por empresa y producto). */
  porProducto(empresa: EmpresaId, productoId: string): Promise<Articulo | null>;
  /** Lo mismo con `SELECT … FOR UPDATE`: serializa controlar y dejar de controlar el mismo producto. */
  bloquearPorProducto(empresa: EmpresaId, productoId: string): Promise<Articulo | null>;
  /** Los artículos de esos ids (los que no existen no vuelven), activos o no. */
  porIds(empresa: EmpresaId, ids: readonly string[]): Promise<Articulo[]>;
  /** Los artículos de esos productos (los productos sin artículo no vuelven), activos o no. */
  porProductos(empresa: EmpresaId, productoIds: readonly string[]): Promise<Articulo[]>;
  /** Crea el artículo (el id lo genera la base). Un segundo para el mismo producto choca con `articulo_de_stock_producto_uk`. */
  insertar(empresa: EmpresaId, alta: AltaDeArticulo): Promise<Articulo>;
  cambiarActivo(empresa: EmpresaId, id: string, activo: boolean): Promise<Articulo | null>;
}

const soloUuids = (ids: readonly string[]): string[] => ids.filter(esUuid);

export function crearRepositorioDeArticulos(db: Kysely<StockDb>): RepositorioDeArticulos {
  return {
    async obtener(empresa, id) {
      if (!esUuid(id)) return null;
      const fila = await db
        .selectFrom("articulo_de_stock")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .executeTakeFirst();
      return fila === undefined ? null : aArticulo(fila);
    },
    async porProducto(empresa, productoId) {
      if (!esUuid(productoId)) return null;
      const fila = await db
        .selectFrom("articulo_de_stock")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("producto_id", "=", productoId)
        .executeTakeFirst();
      return fila === undefined ? null : aArticulo(fila);
    },
    async bloquearPorProducto(empresa, productoId) {
      if (!esUuid(productoId)) return null;
      const fila = await db
        .selectFrom("articulo_de_stock")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("producto_id", "=", productoId)
        .forUpdate()
        .executeTakeFirst();
      return fila === undefined ? null : aArticulo(fila);
    },
    async porIds(empresa, ids) {
      const validos = soloUuids(ids);
      if (validos.length === 0) return [];
      const filas = await db
        .selectFrom("articulo_de_stock")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("id", "in", validos)
        .orderBy("id")
        .execute();
      return filas.map(aArticulo);
    },
    async porProductos(empresa, productoIds) {
      const validos = soloUuids(productoIds);
      if (validos.length === 0) return [];
      const filas = await db
        .selectFrom("articulo_de_stock")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("producto_id", "in", validos)
        .orderBy("id")
        .execute();
      return filas.map(aArticulo);
    },
    async insertar(empresa, alta) {
      const fila = await db
        .insertInto("articulo_de_stock")
        .values({
          empresa_id: empresa,
          producto_id: alta.productoId,
          unidad_de_stock_id: alta.unidadDeStockId,
          dimension: alta.dimension,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return aArticulo(fila);
    },
    async cambiarActivo(empresa, id, activo) {
      const fila = await db
        .updateTable("articulo_de_stock")
        .set({ activo })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aArticulo(fila);
    },
  };
}
