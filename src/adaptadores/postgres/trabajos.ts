import type { Generated, Kysely } from "kysely";
import { exigirSinSecretos } from "../../puertos/sin-secretos";
import type { ResultadoDeEncolar, Trabajos } from "../../puertos/trabajos";

/**
 * Puerto `trabajos` sobre la tabla `trabajo` (ADR-007). Encolar es parte de la transacción del caso
 * de uso: si la transacción se revierte, la fila no queda. La clave de idempotencia es única por
 * empresa (`trabajo_clave_uk`): encolar dos veces lo mismo deja una sola fila y la segunda vuelve
 * como `YA_ENCOLADO` (`ON CONFLICT DO NOTHING`, sin `DO UPDATE`: no pisa nada).
 */
export type TrabajosDb = {
  trabajo: {
    id: Generated<string>;
    empresa_id: string | null;
    tipo: string;
    datos: Generated<string>;
    clave_idempotencia: string;
  };
};

export function crearTrabajosDePostgres(db: Kysely<TrabajosDb>): Trabajos {
  return {
    async encolar(trabajo): Promise<ResultadoDeEncolar> {
      if (trabajo.claveDeIdempotencia.trim() === "") {
        throw new RangeError("encolar: la clave de idempotencia no puede estar vacía");
      }
      exigirSinSecretos(trabajo.datos, "encolar");
      const fila = await db
        .insertInto("trabajo")
        .values({
          empresa_id: trabajo.empresaId,
          tipo: trabajo.tipo,
          datos: JSON.stringify(trabajo.datos),
          clave_idempotencia: trabajo.claveDeIdempotencia,
        })
        .onConflict((oc) => oc.columns(["empresa_id", "clave_idempotencia"]).doNothing())
        .returning("id")
        .executeTakeFirst();
      return fila === undefined ? "YA_ENCOLADO" : "ENCOLADO";
    },
  };
}
