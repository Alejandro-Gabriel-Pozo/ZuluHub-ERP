import { sql, type Kysely, type Selectable } from "kysely";
import type { ListaDelSistema, ValorDeLista } from "../dominio/valor-de-lista";
import type { ListasDb } from "./esquema";

/**
 * Repositorio de las listas del sistema para la PLATAFORMA (e3 §3.7; `valor_de_lista`, migración 0027). Las mismas reglas de los demás
 * repositorios de plataforma:
 *
 *  - Es global: no lleva empresa. La aplicación solo LEE la tabla (lo hace el cobro, para las marcas activas); acá escribe la plataforma
 *    y solo un ADMIN (la política de la base lo exige además del guard).
 *  - Nada se borra (no hay `DELETE`): se desactiva y se reactiva. Los cambios son `UPDATE ... WHERE version = <la que se leyó>` y
 *    devuelven la fila nueva o `null`.
 *  - Ninguna restricción de la base se atrapa acá: salen tal cual y el adaptador de transacciones las traduce a `ErrorDePersistencia`
 *    (la traducción a motivos de negocio está en `traducir.ts`).
 */

/** El valor guardado, con el instante de su última modificación (lo fija la base). */
export type ValorGuardado = ValorDeLista & Readonly<{ actualizadoEn: Date }>;

export interface RepositorioDeListas {
  /** Los valores (activos o no) de las listas pedidas, por lista y por nombre sin distinguir mayúsculas ni acentos. */
  listar(listas: readonly ListaDelSistema[]): Promise<readonly ValorGuardado[]>;
  porId(id: string): Promise<ValorGuardado | null>;
  /** El valor de la lista con ese nombre SIN distinguir mayúsculas ni acentos (el mismo criterio que la única de la base), o `null`. */
  porNombre(lista: ListaDelSistema, nombre: string): Promise<ValorGuardado | null>;
  /**
   * Agrega el valor (activo, no fijo). `null` si no se pudo: ya hay uno con ese nombre en la lista (`ON CONFLICT DO NOTHING` SIN objetivo:
   * cubre la única por nombre, la clave y cualquier otra, y no lanza). Quien llama relee con `porNombre` para saber de quién es.
   */
  agregar(lista: ListaDelSistema, nombre: string): Promise<ValorGuardado | null>;
  /** Cambia el nombre y/o el estado de la versión indicada; `null` si el valor ya no está en esa versión. */
  cambiar(
    id: string,
    versionEsperada: number,
    cambios: Readonly<{ nombre: string } | { activo: boolean }>,
  ): Promise<ValorGuardado | null>;
}

type Fila = Selectable<ListasDb["valor_de_lista"]>;

const aValor = (fila: Fila): ValorGuardado => ({
  id: fila.id,
  lista: fila.lista,
  nombre: fila.nombre,
  activo: fila.activo,
  fija: fila.fija,
  version: fila.version,
  actualizadoEn: fila.actualizado_en,
});

export function crearRepositorioDeListas(db: Kysely<ListasDb>): RepositorioDeListas {
  return {
    async listar(listas) {
      if (listas.length === 0) return [];
      const filas = await db
        .selectFrom("valor_de_lista")
        .selectAll()
        .where("lista", "in", [...listas])
        .orderBy("lista")
        .orderBy("fija")
        // El orden ICU de la única por nombre: sin depender del locale de la base, y «Ángel» no queda al final.
        .orderBy(sql`nombre collate valor_de_lista_nombre_ci`)
        .execute();
      return filas.map(aValor);
    },

    async porId(id) {
      const fila = await db
        .selectFrom("valor_de_lista")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
      return fila === undefined ? null : aValor(fila);
    },

    async porNombre(lista, nombre) {
      // Con `lower()` y un servidor en locale `C`, «CAFÉ» no se encontraría como «café»: se compara con el mismo orden ICU del índice.
      const fila = await db
        .selectFrom("valor_de_lista")
        .selectAll()
        .where("lista", "=", lista)
        .where(sql<boolean>`nombre = ${nombre} collate valor_de_lista_nombre_ci`)
        .executeTakeFirst();
      return fila === undefined ? null : aValor(fila);
    },

    async agregar(lista, nombre) {
      const fila = await db
        .insertInto("valor_de_lista")
        .values({ lista, nombre })
        // Sin objetivo: `ON CONFLICT (id) DO NOTHING` solo cubriría ESE índice, y la carrera real es la de la única por nombre.
        .onConflict((oc) => oc.doNothing())
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aValor(fila);
    },

    async cambiar(id, versionEsperada, cambios) {
      const fila = await db
        .updateTable("valor_de_lista")
        .set(cambios)
        .where("id", "=", id)
        .where("version", "=", versionEsperada)
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aValor(fila);
    },
  };
}
