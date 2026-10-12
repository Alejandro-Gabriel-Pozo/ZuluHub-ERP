import type { Kysely } from "kysely";
import { ROLES_DE_EMPRESA, type RolDeEmpresa } from "../../capacidades/permisos/roles";
import type { CargaDeAutorizacion, DatosDelActor } from "../../puertos/autorizacion";

/**
 * Puerto `autorizacion` sobre `membresia` y `persona`. Lee con la MISMA conexión de la transacción
 * del caso de uso (nada se guarda entre llamadas): el rol vale para esa transacción y, si se repite
 * por un conflicto de serialización, se vuelve a leer.
 *
 * El actor autoriza solo si hay membresía ACTIVA en la empresa del contexto y la persona está activa
 * globalmente (una suspensión de plataforma quita todos los permisos, aunque su membresía siga
 * activa). Con el contexto operativo la RLS ya limita a la empresa del contexto; el filtro por
 * empresa se repite a propósito (defensa en profundidad).
 */
export type AutorizacionDb = {
  membresia: { empresa_id: string; persona_id: string; rol: string; activo: boolean };
  persona: { id: string; activo_global: boolean };
};

const esRolDeEmpresa = (valor: string): valor is RolDeEmpresa =>
  ROLES_DE_EMPRESA.some((rol) => rol === valor);

/**
 * Módulos activables por empresa: todavía no existe la tabla (el único módulo, `administracion`, es
 * obligatorio y no se guarda). Cuando aparezca el primero, cambia solo esta lista.
 */
const SIN_MODULOS_ACTIVADOS: readonly string[] = [];

export function crearAutorizacionDePostgres(db: Kysely<AutorizacionDb>): CargaDeAutorizacion {
  return {
    async delActor(contexto): Promise<DatosDelActor> {
      if (contexto.personaId === null) {
        return { rol: null, modulosActivados: SIN_MODULOS_ACTIVADOS };
      }
      const fila = await db
        .selectFrom("membresia as m")
        .innerJoin("persona as p", "p.id", "m.persona_id")
        .select("m.rol")
        .where("m.empresa_id", "=", contexto.empresaId)
        .where("m.persona_id", "=", contexto.personaId)
        .where("m.activo", "=", true)
        .where("p.activo_global", "=", true)
        .executeTakeFirst();
      if (fila === undefined) return { rol: null, modulosActivados: SIN_MODULOS_ACTIVADOS };
      // Un valor que el CHECK de la base no deja pasar: si llega otro, algo se rompió.
      if (!esRolDeEmpresa(fila.rol))
        throw new RangeError(`rol desconocido en la base: ${fila.rol}`);
      return { rol: fila.rol, modulosActivados: SIN_MODULOS_ACTIVADOS };
    },
  };
}
