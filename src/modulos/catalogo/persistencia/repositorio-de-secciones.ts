import type { Kysely } from "kysely";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import type { CatalogoDb } from "./esquema";
import { FORMA_DE_UUID } from "./filas";
import { aSeccion, type SeccionDeCarta } from "./repositorio-de-productos";

/**
 * Lo que `reordenar` y `reactivar` secciones de la carta necesitan y el repositorio de productos no tiene (carta real §6.1). Todo filtra por empresa y corre en
 * la transacción de quien llama (que es quien autoriza y audita). Una sección no se borra: se apaga y se vuelve a prender.
 */
export interface RepositorioDeSecciones {
  /** TODAS las secciones, activas o no, en el orden de la carta: la lista de la ficha necesita las apagadas para «volver a prender». */
  todas(empresa: EmpresaId): Promise<readonly SeccionDeCarta[]>;
  /**
   * Las secciones ACTIVAS, tomadas con `FOR UPDATE` en un orden fijo (por `id`): dos reordenamientos a la vez toman las mismas filas en el mismo orden, así
   * que uno espera al otro y no hay cruce. Se devuelven en el orden de la carta (`orden` y, si empatan, `id`).
   */
  bloquearActivas(empresa: EmpresaId): Promise<readonly SeccionDeCarta[]>;
  /** `null` si la versión ya no es la esperada (o la sección no es de la empresa). */
  cambiarOrden(
    empresa: EmpresaId,
    id: string,
    versionEsperada: number,
    orden: number,
  ): Promise<SeccionDeCarta | null>;
  /** Vuelve a prender una sección apagada; no toca su orden ni sus productos. `null` si no es de la empresa. */
  reactivar(empresa: EmpresaId, id: string): Promise<SeccionDeCarta | null>;
}

export function crearRepositorioDeSecciones(db: Kysely<CatalogoDb>): RepositorioDeSecciones {
  return {
    async todas(empresa) {
      const filas = await db
        .selectFrom("seccion_de_carta")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .orderBy("orden")
        .orderBy("nombre_clave")
        .orderBy("id")
        .execute();
      return filas.map(aSeccion);
    },
    async bloquearActivas(empresa) {
      const filas = await db
        .selectFrom("seccion_de_carta")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("activa", "=", true)
        .orderBy("id")
        .forUpdate()
        .execute();
      return filas.map(aSeccion).sort((a, b) => a.orden - b.orden || (a.id < b.id ? -1 : 1));
    },
    async cambiarOrden(empresa, id, versionEsperada, orden) {
      if (!FORMA_DE_UUID.test(id)) return null;
      const fila = await db
        .updateTable("seccion_de_carta")
        .set({ orden })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("version", "=", versionEsperada)
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aSeccion(fila);
    },
    async reactivar(empresa, id) {
      if (!FORMA_DE_UUID.test(id)) return null;
      const fila = await db
        .updateTable("seccion_de_carta")
        .set({ activa: true })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aSeccion(fila);
    },
  };
}
