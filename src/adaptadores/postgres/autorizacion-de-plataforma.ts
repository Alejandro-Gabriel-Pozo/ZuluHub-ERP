import type { Kysely } from "kysely";
import {
  ROLES_DE_ADMINISTRADOR,
  type CargaDeAutorizacionDePlataforma,
  type RolDeAdministrador,
} from "../../puertos/autorizacion-de-plataforma";
import { actorFirmado } from "./contexto-firmado";

/**
 * Puerto `autorizacion-de-plataforma` sobre `admin_plataforma`. Lee con la MISMA conexión de la
 * transacción del caso de uso: nada se guarda entre llamadas, así que dar de baja a un administrador
 * corta su acceso en la operación siguiente (y si la transacción se repite, se vuelve a leer).
 *
 * Solo un administrador ACTIVO tiene rol. El actor `sistema` no pasa por el guard (el barrido declara
 * `sinGuard`): para él, y para un id que no existe o está de baja, el rol es `null` y el guard responde
 * `SIN_PERMISO`.
 */
export type AutorizacionDePlataformaDb = {
  admin_plataforma: { id: string; rol: string; activo: boolean };
};

const esRolDeAdministrador = (valor: string): valor is RolDeAdministrador =>
  ROLES_DE_ADMINISTRADOR.some((rol) => rol === valor);

export function crearAutorizacionDePlataformaDePostgres(
  db: Kysely<AutorizacionDePlataformaDb>,
): CargaDeAutorizacionDePlataforma {
  return {
    async delActor(contexto) {
      // Valida el id con la misma regla que la firma del contexto (uuid canónico): un id mal formado
      // es un defecto del llamador, no una consulta sin resultado.
      const actor = actorFirmado(contexto.actor);
      if (contexto.actor.tipo === "SISTEMA") return { rol: null };
      const fila = await db
        .selectFrom("admin_plataforma")
        .select("rol")
        .where("id", "=", actor)
        .where("activo", "=", true)
        .executeTakeFirst();
      if (fila === undefined) return { rol: null };
      // Un valor que el CHECK de la base no deja pasar: si llega otro, algo se rompió.
      if (!esRolDeAdministrador(fila.rol)) {
        throw new RangeError(`rol de administrador desconocido en la base: ${fila.rol}`);
      }
      return { rol: fila.rol };
    },
  };
}
