import { sql, type Generated, type Kysely } from "kysely";
import {
  POLITICA_DE_INTENTOS,
  decisionDeBloqueo,
  retencionDeFallosEnMs,
  type PoliticaDeIntentos,
} from "../../capacidades/autenticacion/bloqueo-de-intentos";
import type {
  ResultadoDeIntento,
  SegundoFactorDeAutenticacion,
} from "../../puertos/segundo-factor-de-autenticacion";

/**
 * El segundo factor de la consola en el esquema `autenticacion` (h5-p8 §2.4 y §2.6, migración 0015). Lo usa el rol de
 * la librería de ingreso, el único que entra a ese esquema.
 *
 * Un intento de código es UNA transacción corta: toma un candado consultivo por usuario (los intentos del mismo
 * usuario se hacen de a uno, así que 8 pedidos simultáneos no esquivan el límite ni gastan el mismo código dos
 * veces), borra lo viejo de ese usuario, mira los fallos recientes, decide con la función pura
 * `decisionDeBloqueo` y, si no hay bloqueo, deja que `verificar` juzgue el código (puede registrar el paso de TOTP
 * usado en la misma transacción). El candado es de transacción: se suelta solo al confirmar, también detrás del
 * pooler de Neon.
 *
 * `codigo_totp_usado` guarda solo el NÚMERO DE PASO del reloj, nunca el código: no hay nada que robar ahí.
 */
export type SegundoFactorDb = {
  intento_segundo_factor: { id: Generated<string>; usuario_id: string; fallo_en: Date };
  codigo_totp_usado: { usuario_id: string; paso: string; usado_en: Date };
  session: { token: string; segundo_factor_en: Date | null };
};

/** Un paso de TOTP (30 s) deja de poder repetirse en minutos; se recuerda un día por si el reloj de alguien se atrasa. */
export const RETENCION_DE_PASOS_USADOS_EN_MS = 24 * 3_600_000;

export function crearSegundoFactorDePostgres(
  db: Kysely<SegundoFactorDb>,
  politica: PoliticaDeIntentos = POLITICA_DE_INTENTOS,
): SegundoFactorDeAutenticacion {
  const autenticacion = db.withSchema("autenticacion");
  return {
    async intentarCodigo(usuario, ahora, verificar): Promise<ResultadoDeIntento> {
      return autenticacion.transaction().execute(async (trx): Promise<ResultadoDeIntento> => {
        await sql`select pg_advisory_xact_lock(hashtextextended(${`segundo-factor:${usuario}`}, 0))`.execute(
          trx,
        );
        await trx
          .deleteFrom("intento_segundo_factor")
          .where("usuario_id", "=", usuario)
          .where("fallo_en", "<", new Date(ahora.getTime() - retencionDeFallosEnMs(politica)))
          .execute();
        await trx
          .deleteFrom("codigo_totp_usado")
          .where("usuario_id", "=", usuario)
          .where("usado_en", "<", new Date(ahora.getTime() - RETENCION_DE_PASOS_USADOS_EN_MS))
          .execute();
        const filas = await trx
          .selectFrom("intento_segundo_factor")
          .select("fallo_en")
          .where("usuario_id", "=", usuario)
          .execute();
        const fallos = filas.map((f) => f.fallo_en);
        const antes = decisionDeBloqueo(fallos, ahora, politica);
        if (antes.bloqueado) return { tipo: "BLOQUEADO", hasta: antes.hasta };

        const valido = await verificar({
          async registrarPasoUsado(paso) {
            const r = await trx
              .insertInto("codigo_totp_usado")
              .values({ usuario_id: usuario, paso: String(paso), usado_en: ahora })
              .onConflict((c) => c.columns(["usuario_id", "paso"]).doNothing())
              .executeTakeFirst();
            return Number(r.numInsertedOrUpdatedRows ?? 0) === 1;
          },
        });
        if (valido) {
          await trx
            .deleteFrom("intento_segundo_factor")
            .where("usuario_id", "=", usuario)
            .execute();
          return { tipo: "VALIDO" };
        }
        await trx
          .insertInto("intento_segundo_factor")
          .values({ usuario_id: usuario, fallo_en: ahora })
          .execute();
        const despues = decisionDeBloqueo([...fallos, ahora], ahora, politica);
        return {
          tipo: "INVALIDO",
          bloqueoNuevo: despues.bloqueado
            ? { hasta: despues.hasta, fallos: fallos.length + 1 }
            : null,
        };
      });
    },

    async marcarSegundoFactor(tokenDeSesion, ahora) {
      const r = await autenticacion
        .updateTable("session")
        .set({ segundo_factor_en: sql`greatest(coalesce(segundo_factor_en, ${ahora}), ${ahora})` })
        .where("token", "=", tokenDeSesion)
        .executeTakeFirst();
      return Number(r.numUpdatedRows) === 1;
    },
  };
}
