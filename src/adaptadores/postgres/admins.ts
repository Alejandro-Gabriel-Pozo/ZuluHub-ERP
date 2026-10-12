import { sql, type Kysely } from "kysely";
import type { AdminsDePlataforma } from "../../puertos/admins-de-plataforma";

/**
 * Puerto `admins-de-plataforma` sobre `admin_plataforma` (lectura). Lo usa el alta de empresa y el
 * reenvío del alta para impedir que un administrador de plataforma sea gerente (decisión F5). Con el
 * contexto de plataforma; otro rol de base no ve la tabla.
 */
export type AdminsDb = {
  admin_plataforma: { id: string; email: string; activo: boolean };
};

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
  };
}
