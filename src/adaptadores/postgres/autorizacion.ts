import type { Kysely } from "kysely";
import type { AlcanceDeSucursales } from "../../capacidades/permisos/alcance";
import { ROLES_DE_EMPRESA, type RolDeEmpresa } from "../../capacidades/permisos/roles";
import { sucursalId } from "../../primitivas/identificadores/marca";
import type { ContextoOperativo } from "../../contexto/contexto";
import type { CargaDeAutorizacion, DatosDelActor } from "../../puertos/autorizacion";

/**
 * Puerto `autorizacion` sobre `membresia`, `persona`, `asignacion_sucursal`, `sucursal`, `empresa` y `tenant`. Lee con la MISMA conexión de la transacción
 * del caso de uso (nada se guarda entre llamadas): el rol vale para esa transacción y, si se repite
 * por un conflicto de serialización, se vuelve a leer.
 *
 * El actor autoriza solo si hay membresía ACTIVA en la empresa del contexto y la persona está activa
 * globalmente (una suspensión de plataforma quita todos los permisos, aunque su membresía siga
 * activa). Con el contexto operativo la RLS ya limita a la empresa del contexto; el filtro por
 * empresa se repite a propósito (defensa en profundidad).
 *
 * Además, la persona tiene que haber entrado por la puerta de la MARCA de su tenant (marcas y planes,
 * §B.2.4): `marcaDeEntrada` del contexto debe ser igual a `tenant.marca_id` de la empresa. Si no
 * coincide, o es `null` con una persona, no hay rol y todo da `SIN_PERMISO`, sin ningún detalle. La
 * marca se lee en la MISMA consulta que la membresía (misma transacción: el tenant no cambia de marca,
 * `tenant_marca_inmutable`) y con lo que el rol de la aplicación ya ve bajo la RLS (su empresa y el
 * tenant de esta). Previene: que una persona de un tenant de la marca A opere entrando por el host de la
 * marca B (la marca no viaja en el token firmado: no es frontera de aislamiento por sí sola, §B.10).
 */
export type AutorizacionDb = {
  membresia: { empresa_id: string; persona_id: string; rol: string; activo: boolean };
  persona: { id: string; activo_global: boolean };
  asignacion_sucursal: {
    empresa_id: string;
    persona_id: string;
    sucursal_id: string;
    activa: boolean;
  };
  sucursal: { id: string; empresa_id: string; activa: boolean };
  empresa: { id: string; tenant_id: string };
  tenant: { id: string; marca_id: string };
};

const esRolDeEmpresa = (valor: string): valor is RolDeEmpresa =>
  ROLES_DE_EMPRESA.some((rol) => rol === valor);

/**
 * Módulos activables por empresa: todavía no existe la tabla (el único módulo, `administracion`, es
 * obligatorio y no se guarda). Cuando aparezca el primero, cambia solo esta lista.
 */
const SIN_MODULOS_ACTIVADOS: readonly string[] = [];

/**
 * Módulos que incluye el plan: todavía no existe (las tablas de planes llegan con la migración 0007).
 * Sin plan solo rigen los obligatorios, que no dependen de él; cuando exista, esta lectura va en la
 * misma consulta que el rol.
 */
const SIN_MODULOS_HABILITADOS: readonly string[] = [];

/** Lo que carga el adaptador cuando no hay rol (ni, por lo tanto, nada que activar). */
const SIN_ROL: DatosDelActor = {
  rol: null,
  modulosActivados: SIN_MODULOS_ACTIVADOS,
  modulosHabilitados: SIN_MODULOS_HABILITADOS,
};

export function crearAutorizacionDePostgres(db: Kysely<AutorizacionDb>): CargaDeAutorizacion {
  /**
   * El rol de la membresía ACTIVA con la persona activa globalmente que entró por la marca del tenant de
   * la empresa; `null` si no hay (ver arriba). Una marca de entrada `null` con persona no autoriza: ni
   * siquiera se consulta.
   */
  async function rolDelActor(contexto: ContextoOperativo): Promise<RolDeEmpresa | null> {
    if (contexto.personaId === null || contexto.marcaDeEntrada === null) return null;
    const fila = await db
      .selectFrom("membresia as m")
      .innerJoin("persona as p", "p.id", "m.persona_id")
      .innerJoin("empresa as e", "e.id", "m.empresa_id")
      .innerJoin("tenant as t", "t.id", "e.tenant_id")
      .select("m.rol")
      .where("m.empresa_id", "=", contexto.empresaId)
      .where("t.marca_id", "=", contexto.marcaDeEntrada)
      .where("m.persona_id", "=", contexto.personaId)
      .where("m.activo", "=", true)
      .where("p.activo_global", "=", true)
      .executeTakeFirst();
    if (fila === undefined) return null;
    // Un valor que el CHECK de la base no deja pasar: si llega otro, algo se rompió.
    if (!esRolDeEmpresa(fila.rol)) throw new RangeError(`rol desconocido en la base: ${fila.rol}`);
    return fila.rol;
  }

  return {
    async delActor(contexto): Promise<DatosDelActor> {
      const rol = await rolDelActor(contexto);
      if (rol === null) return SIN_ROL;
      return {
        rol,
        modulosActivados: SIN_MODULOS_ACTIVADOS,
        modulosHabilitados: SIN_MODULOS_HABILITADOS,
      };
    },

    async sucursalesDelActor(contexto): Promise<AlcanceDeSucursales> {
      const rol = await rolDelActor(contexto);
      // Sin rol vigente no hay alcance alguno: falla cerrado, nunca «todas» por omisión.
      if (rol === null || contexto.personaId === null) return [];
      // Gerente y administrador operan en todas las sucursales (decisión de H6). Cualquier otro rol
      // que se agregue algún día cae acá en la lista asignada, la opción más restrictiva.
      if (rol === "GERENTE" || rol === "ADMINISTRADOR") return "TODAS";
      const filas = await db
        .selectFrom("asignacion_sucursal as a")
        .innerJoin("sucursal as s", (unir) =>
          unir.onRef("s.id", "=", "a.sucursal_id").onRef("s.empresa_id", "=", "a.empresa_id"),
        )
        .select("a.sucursal_id")
        .where("a.empresa_id", "=", contexto.empresaId)
        .where("a.persona_id", "=", contexto.personaId)
        .where("a.activa", "=", true)
        .where("s.activa", "=", true)
        .orderBy("a.sucursal_id")
        .execute();
      return filas.map((fila) => sucursalId(fila.sucursal_id));
    },
  };
}
