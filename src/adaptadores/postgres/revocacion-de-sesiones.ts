import type { Kysely } from "kysely";
import type { RevocacionDeSesiones } from "../../puertos/revocacion-de-sesiones";

/**
 * `RevocacionDeSesiones` sobre la tabla `session` del esquema `autenticacion`, con la conexión del rol de autenticación
 * (el único con `DELETE` ahí; sobre `user` y `account` no tiene). Un solo `DELETE` por usuario: atómico, idempotente
 * (lo que ya no está no se vuelve a borrar) y sin lectura previa.
 */
export type RevocacionDb = { session: { userId: string } };

export function crearRevocacionDeSesionesDePostgres(
  db: Kysely<RevocacionDb>,
): RevocacionDeSesiones {
  const autenticacion = db.withSchema("autenticacion");
  return {
    async revocarDelUsuario(usuario) {
      const r = await autenticacion
        .deleteFrom("session")
        .where("userId", "=", usuario)
        .executeTakeFirst();
      return Number(r.numDeletedRows);
    },
  };
}
