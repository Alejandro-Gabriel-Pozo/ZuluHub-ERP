import type { Kysely } from "kysely";
import { ROLES_DE_GRUPO, type RolDeGrupo } from "../../capacidades/permisos/grupo";
import type { CargaDeAutorizacionDeGrupo } from "../../puertos/autorizacion-de-grupo";

/**
 * Puerto `autorizacion-de-grupo` sobre `membresia_tenant` y `persona`. Lee con la MISMA conexión de la
 * transacción de la consulta (nada se guarda entre llamadas): el rol vale para esa transacción y, si se
 * repite por un conflicto de serialización, se vuelve a leer.
 *
 * Es propietario solo quien tiene membresía de tenant ACTIVA en el tenant del contexto y está activo
 * globalmente (una suspensión de plataforma quita el acceso aunque la membresía siga activa): la misma
 * condición que `es_propietario_activo` impone la base. Con el rol de grupo la RLS ya limita a la fila
 * propia; el filtro por persona y tenant se repite a propósito (defensa en profundidad).
 */
export type AutorizacionDeGrupoDb = {
  membresia_tenant: { persona_id: string; tenant_id: string; rol: string; activo: boolean };
  persona: { id: string; activo_global: boolean };
};

const esRolDeGrupo = (valor: string): valor is RolDeGrupo =>
  ROLES_DE_GRUPO.some((rol) => rol === valor);

export function crearAutorizacionDeGrupoDePostgres(
  db: Kysely<AutorizacionDeGrupoDb>,
): CargaDeAutorizacionDeGrupo {
  return {
    async delPropietario(contexto) {
      const fila = await db
        .selectFrom("membresia_tenant as m")
        .innerJoin("persona as p", "p.id", "m.persona_id")
        .select("m.rol")
        .where("m.tenant_id", "=", contexto.tenantId)
        .where("m.persona_id", "=", contexto.personaId)
        .where("m.activo", "=", true)
        .where("p.activo_global", "=", true)
        .executeTakeFirst();
      if (fila === undefined) return { rol: null };
      // Un valor que el CHECK de la base no deja pasar: si llega otro, algo se rompió.
      if (!esRolDeGrupo(fila.rol))
        throw new RangeError(`rol de grupo desconocido en la base: ${fila.rol}`);
      return { rol: fila.rol };
    },
  };
}
