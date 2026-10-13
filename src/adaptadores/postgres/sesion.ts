import type { Kysely } from "kysely";
import { ROLES_DE_EMPRESA } from "../../capacidades/permisos/roles";
import type { EstadoDeEmpresa, EstadoDeTenant } from "../../contexto/estados";
import { empresaId, personaId } from "../../primitivas/identificadores/marca";
import type { LecturasDeSesion } from "../../puertos/sesion";

/**
 * Puerto `LecturasDeSesion` sobre `persona`, `membresia`, `empresa` y `tenant`. Lee con la MISMA conexión
 * de la transacción (contexto `SESION`, o `INVITACION` con usuario): la RLS de la puerta deja ver solo lo
 * del usuario firmado en `s`, y las consultas repiten el filtro por usuario a propósito (defensa en
 * profundidad: si una política se aflojara, el filtro explícito sigue acotando).
 */
export type SesionDb = {
  persona: { id: string; usuario_auth_id: string | null; activo_global: boolean };
  membresia: { empresa_id: string; persona_id: string; rol: string; activo: boolean };
  empresa: { id: string; tenant_id: string; razon_social: string; estado: EstadoDeEmpresa };
  tenant: { id: string; marca_id: string; estado: EstadoDeTenant };
};

export function crearLecturasDeSesionDePostgres(db: Kysely<SesionDb>): LecturasDeSesion {
  return {
    async personaDelUsuario(usuario) {
      const fila = await db
        .selectFrom("persona")
        .select("id")
        .where("usuario_auth_id", "=", usuario)
        .where("activo_global", "=", true)
        .executeTakeFirst();
      return fila === undefined ? null : personaId(fila.id);
    },

    async empresasDelUsuario(usuario, marca) {
      const filas = await db
        .selectFrom("persona as p")
        .innerJoin("membresia as m", "m.persona_id", "p.id")
        .innerJoin("empresa as e", "e.id", "m.empresa_id")
        .innerJoin("tenant as t", "t.id", "e.tenant_id")
        .select([
          "e.id as empresa_id",
          "e.razon_social",
          "e.estado as estado_de_empresa",
          "t.estado as estado_de_tenant",
          "m.rol",
        ])
        .where("p.usuario_auth_id", "=", usuario)
        .where("p.activo_global", "=", true)
        .where("m.activo", "=", true)
        .where("t.marca_id", "=", marca)
        .execute();
      return filas.map((f) => {
        // Un valor que el CHECK de la base no deja pasar: si llega otro, algo se rompió.
        const rol = ROLES_DE_EMPRESA.find((r) => r === f.rol);
        if (rol === undefined) throw new RangeError(`rol desconocido en la base: ${f.rol}`);
        return {
          empresaId: empresaId(f.empresa_id),
          nombre: f.razon_social,
          rol,
          estado: f.estado_de_empresa,
          estadoDelTenant: f.estado_de_tenant,
        };
      });
    },
  };
}
