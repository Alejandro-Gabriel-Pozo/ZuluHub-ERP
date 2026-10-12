import type { Generated, Kysely } from "kysely";
import type { ReferenciasDeError } from "../../puertos/referencias-de-error";

/**
 * Puerto `referencias-de-error` sobre `referencia_de_error` (solo inserción). Se escribe con el
 * contexto de quien recibe el rechazo: la base compara la empresa y la persona con las del contexto
 * (aplicación y grupo) o exige un actor vigente (plataforma), y valida la forma de cada campo con CHECK
 * estrictos. Sin `RETURNING`: quien escribe no puede leer la tabla. Sin `ON CONFLICT`: la referencia no
 * es única (32 bits pueden colisionar) y dos iguales conviven.
 */
export type ReferenciasDeErrorDb = {
  referencia_de_error: {
    id: Generated<string>;
    referencia: string;
    accion: string;
    motivo: string;
    empresa_id: string | null;
    persona_id: string | null;
    creado_en: Generated<Date>;
  };
};

export function crearReferenciasDeErrorDePostgres(
  db: Kysely<ReferenciasDeErrorDb>,
): ReferenciasDeError {
  return {
    async registrar(referencia) {
      await db
        .insertInto("referencia_de_error")
        .values({
          referencia: referencia.referencia,
          accion: referencia.accion,
          motivo: referencia.motivo,
          empresa_id: referencia.empresaId,
          persona_id: referencia.personaId,
        })
        .execute();
    },
  };
}
