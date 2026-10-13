import type { Generated, Kysely } from "kysely";
import {
  LIMITES_DE_SESION,
  type LimitesDeSesion,
} from "../../capacidades/autenticacion/vigencia-de-sesion";
import type { BarridoDeAutenticacion } from "../../puertos/autenticacion";

/**
 * Barrido de lo vencido en el esquema de la librería de ingreso (web-armazon §4.3, «Barrido de sesiones
 * vencidas»). La librería solo borra una sesión vencida cuando alguien la vuelve a presentar, y no borra
 * nunca las verificaciones ni los contadores de límite de pedidos: sin barrido las tablas crecen sin fin.
 * Lo llama el cron de trabajos (W6) con el rol de autenticación, que es el único con permiso de borrar
 * acá (`DELETE` solo sobre sus tablas).
 *
 * Una transacción corta, tres borrados. Cada borrado toca como mucho `FILAS_POR_PASADA` filas: si hay
 * más, la próxima pasada sigue (no se retiene un bloqueo largo sobre una tabla que usa cada ingreso).
 * Idempotente: lo que ya no está no se vuelve a borrar y repetir no falla.
 */
export type AutenticacionDb = {
  session: {
    id: Generated<string>;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
  };
  verification: { id: Generated<string>; expiresAt: Date };
  rateLimit: { id: Generated<string>; lastRequest: string };
};

export const FILAS_POR_PASADA = 10_000;

/** Un contador de límite de pedidos más viejo que esto ya no cuenta para ninguna ventana de la librería. */
export const RETENCION_DE_LIMITES_EN_MS = 24 * 3_600_000;

export function crearBarridoDeAutenticacion(
  db: Kysely<AutenticacionDb>,
  limites: LimitesDeSesion = LIMITES_DE_SESION,
  filasPorPasada: number = FILAS_POR_PASADA,
): BarridoDeAutenticacion {
  const autenticacion = db.withSchema("autenticacion");
  return {
    async barrerVencidos(ahora) {
      const topeAbsoluto = new Date(ahora.getTime() - limites.absolutoEnMs);
      const sinUso = new Date(ahora.getTime() - limites.inactividad.vencimientoEnMs);
      const limiteDeContadores = ahora.getTime() - RETENCION_DE_LIMITES_EN_MS;
      return autenticacion.transaction().execute(async (trx) => {
        // Las mismas tres razones por las que `vigenciaDeSesion` da VENCIDA, con el mismo `<=`.
        const sesiones = await trx
          .deleteFrom("session")
          .where(
            "id",
            "in",
            trx
              .selectFrom("session")
              .select("id")
              .where((o) =>
                o.or([
                  o("expiresAt", "<=", ahora),
                  o("createdAt", "<=", topeAbsoluto),
                  o("updatedAt", "<=", sinUso),
                ]),
              )
              .limit(filasPorPasada),
          )
          .executeTakeFirst();
        const verificaciones = await trx
          .deleteFrom("verification")
          .where(
            "id",
            "in",
            trx
              .selectFrom("verification")
              .select("id")
              .where("expiresAt", "<=", ahora)
              .limit(filasPorPasada),
          )
          .executeTakeFirst();
        const limitesDePedidos = await trx
          .deleteFrom("rateLimit")
          .where(
            "id",
            "in",
            trx
              .selectFrom("rateLimit")
              .select("id")
              .where("lastRequest", "<", String(limiteDeContadores))
              .limit(filasPorPasada),
          )
          .executeTakeFirst();
        return {
          sesiones: Number(sesiones.numDeletedRows),
          verificaciones: Number(verificaciones.numDeletedRows),
          limitesDePedidos: Number(limitesDePedidos.numDeletedRows),
        };
      });
    },
  };
}
