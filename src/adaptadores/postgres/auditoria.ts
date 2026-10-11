import type { Generated, Kysely } from "kysely";
import type { Auditoria } from "../../puertos/auditoria";
import { exigirSinSecretos } from "../../puertos/sin-secretos";

/**
 * Puerto de auditoría sobre `auditoria_empresa` (solo inserción; un disparador impide cambiarla).
 * Va en la misma transacción del cambio que describe.
 */
export type AuditoriaDb = {
  auditoria_empresa: {
    id: Generated<string>;
    empresa_id: string;
    actor_persona_id: string | null;
    accion: string;
    entidad: string;
    entidad_id: string;
    antes: string | null;
    despues: string | null;
  };
};

export function crearAuditoriaDePostgres(db: Kysely<AuditoriaDb>): Auditoria {
  return {
    async registrar(registro) {
      const antes = registro.antes ?? null;
      const despues = registro.despues ?? null;
      if (antes !== null) exigirSinSecretos(antes, "auditoría (antes)");
      if (despues !== null) exigirSinSecretos(despues, "auditoría (despues)");
      await db
        .insertInto("auditoria_empresa")
        .values({
          empresa_id: registro.empresaId,
          actor_persona_id: registro.actorPersonaId,
          accion: registro.accion,
          entidad: registro.entidad,
          entidad_id: registro.entidadId,
          antes: antes === null ? null : JSON.stringify(antes),
          despues: despues === null ? null : JSON.stringify(despues),
        })
        .execute();
    },
  };
}
