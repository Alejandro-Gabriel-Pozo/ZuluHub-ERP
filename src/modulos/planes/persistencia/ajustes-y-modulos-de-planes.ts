import { type Kysely, sql } from "kysely";
import type { PlanesDePlataformaDb } from "./tablas";
import type { RepositorioDePlanes } from "./tipos-de-planes";
import { aAjuste, aModulo } from "./mapeos-de-planes";

export function crearAjustesYModulosDePlanes(
  db: Kysely<PlanesDePlataformaDb>,
): Pick<
  RepositorioDePlanes,
  | "ajustesDelTenant"
  | "serieDeAjustes"
  | "ajustar"
  | "modulosDeLasEmpresas"
  | "activarModulo"
  | "desactivarModulo"
> {
  return {
    async ajustesDelTenant(tenant) {
      const filas = await db
        .selectFrom("ajuste_de_perilla")
        .selectAll()
        .where("tenant_id", "=", tenant)
        .orderBy("perilla", "asc")
        .orderBy("empresa_id", "asc")
        .orderBy("numero", "asc")
        .execute();
      return filas.map(aAjuste);
    },

    async serieDeAjustes(tenant, empresa, perilla) {
      const filas = await db
        .selectFrom("ajuste_de_perilla")
        .selectAll()
        .where("tenant_id", "=", tenant)
        .where("perilla", "=", perilla)
        .where((eb) =>
          empresa === null ? eb("empresa_id", "is", null) : eb("empresa_id", "=", empresa),
        )
        .orderBy("numero", "asc")
        .execute();
      return filas.map(aAjuste);
    },

    async ajustar(nuevo) {
      const fila = await db
        .insertInto("ajuste_de_perilla")
        .values({
          tenant_id: nuevo.tenantId,
          empresa_id: nuevo.empresaId,
          perilla: nuevo.perilla,
          numero: nuevo.numero,
          valor: nuevo.valor,
          vigente_desde: nuevo.vigenteDesde,
          reemplaza_programada: nuevo.reemplazaProgramada,
          motivo: nuevo.motivo,
          asignado_por: sql<string>`(select app_actor_plataforma())`,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return aAjuste(fila);
    },

    async modulosDeLasEmpresas(empresas) {
      if (empresas.length === 0) return [];
      const filas = await db
        .selectFrom("modulo_de_empresa")
        .selectAll()
        .where("empresa_id", "in", empresas)
        .orderBy("empresa_id", "asc")
        .orderBy("modulo", "asc")
        .execute();
      return filas.map(aModulo);
    },

    async activarModulo(empresa, modulo, existente) {
      if (existente === null) {
        const fila = await db
          .insertInto("modulo_de_empresa")
          .values({ empresa_id: empresa, modulo })
          .returningAll()
          .executeTakeFirstOrThrow();
        return aModulo(fila);
      }
      const fila = await db
        .updateTable("modulo_de_empresa")
        .set({ activo: true })
        .where("empresa_id", "=", existente.empresaId)
        .where("modulo", "=", existente.modulo)
        .where("version", "=", existente.version)
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aModulo(fila);
    },

    async desactivarModulo(existente) {
      const fila = await db
        .updateTable("modulo_de_empresa")
        .set({ activo: false })
        .where("empresa_id", "=", existente.empresaId)
        .where("modulo", "=", existente.modulo)
        .where("version", "=", existente.version)
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aModulo(fila);
    },
  };
}
