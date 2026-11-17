import { type Kysely, sql } from "kysely";
import type { PlanesDePlataformaDb } from "./tablas";
import type { RepositorioDePlanes } from "./tipos-de-planes";
import { aPlan, aVersion, aPublicada, columnasDelContenido } from "./mapeos-de-planes";

export function crearPlanesYVersiones(
  db: Kysely<PlanesDePlataformaDb>,
): Pick<
  RepositorioDePlanes,
  | "obtenerPlan"
  | "obtenerPlanPorCodigo"
  | "listarPlanes"
  | "crearPlan"
  | "versionPorId"
  | "borradorDe"
  | "publicadasDe"
  | "versionesDeLosPlanes"
  | "crearBorrador"
  | "actualizarBorrador"
  | "publicar"
> {
  return {
    async obtenerPlan(id) {
      const fila = await db.selectFrom("plan").selectAll().where("id", "=", id).executeTakeFirst();
      return fila === undefined ? null : aPlan(fila);
    },

    async obtenerPlanPorCodigo(codigo) {
      const fila = await db
        .selectFrom("plan")
        .selectAll()
        .where("codigo", "=", codigo)
        .executeTakeFirst();
      return fila === undefined ? null : aPlan(fila);
    },

    async listarPlanes() {
      const filas = await db.selectFrom("plan").selectAll().orderBy("codigo", "asc").execute();
      return filas.map(aPlan);
    },

    async crearPlan(codigo) {
      const fila = await db
        .insertInto("plan")
        .values({ codigo })
        .returningAll()
        .executeTakeFirstOrThrow();
      return aPlan(fila);
    },

    async versionPorId(id) {
      const fila = await db
        .selectFrom("version_de_plan")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
      return fila === undefined ? null : aVersion(fila);
    },

    async borradorDe(plan) {
      const fila = await db
        .selectFrom("version_de_plan")
        .selectAll()
        .where("plan_id", "=", plan)
        .where("estado", "=", "BORRADOR")
        .executeTakeFirst();
      return fila === undefined ? null : aVersion(fila);
    },

    async publicadasDe(plan) {
      const filas = await db
        .selectFrom("version_de_plan")
        .selectAll()
        .where("plan_id", "=", plan)
        .where("estado", "=", "PUBLICADA")
        .orderBy("numero", "asc")
        .execute();
      return filas.map(aPublicada);
    },

    async versionesDeLosPlanes(planes) {
      if (planes.length === 0) return [];
      const filas = await db
        .selectFrom("version_de_plan")
        .selectAll()
        .where("plan_id", "in", planes)
        .orderBy("plan_id", "asc")
        .orderBy("numero", "asc")
        .execute();
      return filas.map(aVersion);
    },

    async crearBorrador(plan, contenido) {
      const fila = await db
        .insertInto("version_de_plan")
        .values({ plan_id: plan, ...columnasDelContenido(contenido) })
        .returningAll()
        .executeTakeFirstOrThrow();
      return aVersion(fila);
    },

    async actualizarBorrador(id, versionEsperada, contenido) {
      const fila = await db
        .updateTable("version_de_plan")
        .set(columnasDelContenido(contenido))
        .where("id", "=", id)
        .where("version", "=", versionEsperada)
        .where("estado", "=", "BORRADOR")
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aVersion(fila);
    },

    async publicar(id, versionEsperada, publicacion) {
      const fila = await db
        .updateTable("version_de_plan")
        .set({
          estado: "PUBLICADA",
          numero: publicacion.numero,
          motivo: publicacion.motivo,
          publicada_en: publicacion.publicadaEn,
          publicada_por: sql<string>`(select app_actor_plataforma())`,
        })
        .where("id", "=", id)
        .where("version", "=", versionEsperada)
        .where("estado", "=", "BORRADOR")
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aPublicada(fila);
    },
  };
}
