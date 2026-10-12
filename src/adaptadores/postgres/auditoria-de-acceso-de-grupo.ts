import type { Generated, Kysely } from "kysely";
import type { Contexto } from "../../contexto/contexto";
import type { AuditoriaDeAccesoDeGrupo } from "../../puertos/auditoria-de-acceso-de-grupo";

/**
 * Puerto de auditoría de acceso del grupo sobre `auditoria_acceso_grupo` (solo inserción; un
 * disparador impide cambiarla o borrarla). Va en la misma transacción de la lectura que describe.
 *
 * El tenant y la persona NO los elige el llamador: salen del contexto de la transacción, y la base
 * (política `auditoria_acceso_grupo_alta`) exige además que coincidan con el contexto firmado y que la
 * persona sea propietaria activa del tenant. Dos barreras. El `INSERT` es sin `RETURNING`: el rol de
 * grupo puede registrar su acceso pero no leer el registro.
 */
export type AuditoriaDeAccesoDeGrupoDb = {
  auditoria_acceso_grupo: {
    id: Generated<string>;
    tenant_id: string;
    persona_id: string;
    empresa_id: string | null;
  };
};

export function crearAuditoriaDeAccesoDeGrupoDePostgres(
  db: Kysely<AuditoriaDeAccesoDeGrupoDb>,
  contexto: Contexto,
): AuditoriaDeAccesoDeGrupo {
  return {
    async registrar(registro) {
      // Se valida al USAR, no al construir: la composición arma todos los adaptadores para cualquier
      // contexto, y solo el de grupo puede auditar un acceso de grupo.
      if (contexto.tipo !== "GRUPO") {
        throw new RangeError("auditoría de acceso de grupo: el contexto no es de grupo");
      }
      await db
        .insertInto("auditoria_acceso_grupo")
        .values({
          tenant_id: contexto.tenantId,
          persona_id: contexto.personaId,
          empresa_id: registro.empresaId,
        })
        .execute();
    },
  };
}
