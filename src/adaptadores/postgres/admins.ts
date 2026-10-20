import { sql, type Kysely } from "kysely";
import { adminPlataformaId } from "../../primitivas/identificadores/marca";
import type { AdminsDePlataforma } from "../../puertos/admins-de-plataforma";
import {
  ROLES_DE_ADMINISTRADOR,
  type RolDeAdministrador,
} from "../../puertos/autorizacion-de-plataforma";

/**
 * Puerto `admins-de-plataforma` sobre `admin_plataforma` (lectura). Lo usa el alta de empresa y el
 * reenvío del alta para impedir que un administrador de plataforma sea gerente (decisión F5). Con el
 * contexto de plataforma; otro rol de base no ve la tabla.
 */
export type AdminsDb = {
  admin_plataforma: { id: string; email: string; rol: string; activo: boolean };
};

const esRolDeAdministrador = (valor: string): valor is RolDeAdministrador =>
  ROLES_DE_ADMINISTRADOR.some((rol) => rol === valor);

export function crearAdminsDePostgres(db: Kysely<AdminsDb>): AdminsDePlataforma {
  return {
    async esEmailDeAdminActivo(email) {
      const fila = await db
        .selectFrom("admin_plataforma")
        .select("id")
        // Se normaliza en la base con la misma expresión de `admin_plataforma_email_ck`, así lo que se
        // compara es exactamente lo que se pudo guardar.
        .where(sql<boolean>`email = lower(btrim(${email}))`)
        .where("activo", "=", true)
        .executeTakeFirst();
      return fila !== undefined;
    },

    async buscarPorEmail(email) {
      const fila = await db
        .selectFrom("admin_plataforma")
        .select(["id", "rol", "activo"])
        .where(sql<boolean>`email = lower(btrim(${email}))`)
        .executeTakeFirst();
      if (fila === undefined) return null;
      // Un valor que el CHECK de la base no deja pasar: si llega otro, algo se rompió.
      if (!esRolDeAdministrador(fila.rol)) {
        throw new RangeError(`rol de administrador desconocido en la base: ${fila.rol}`);
      }
      return { id: adminPlataformaId(fila.id), rol: fila.rol, activo: fila.activo };
    },
  };
}
