import { sql, type Kysely } from "kysely";
import { esClaveDe } from "../../capacidades/modulos/activos";
import { CATALOGO_DE_MODULOS } from "../../capacidades/modulos/catalogo";
import { vigenteEn } from "../../capacidades/planes/vigencia";
import type { AlcanceDeSucursales } from "../../capacidades/permisos/alcance";
import { ROLES_DE_EMPRESA, type RolDeEmpresa } from "../../capacidades/permisos/roles";
import { sucursalId } from "../../primitivas/identificadores/marca";
import type { ContextoOperativo } from "../../contexto/contexto";
import type { CargaDeAutorizacion, DatosDelActor } from "../../puertos/autorizacion";

/**
 * Puerto `autorizacion` sobre `membresia`, `persona`, `asignacion_sucursal`, `sucursal`, `empresa`, `tenant` y,
 * para los módulos, `modulo_de_empresa`, `plan_de_tenant` y `version_de_plan` (SQL propio, ver `modulosDe`). Lee con la MISMA conexión de la transacción
 * del caso de uso (nada se guarda entre llamadas): el rol y los módulos valen para esa transacción y, si se
 * repite por un conflicto de serialización, se vuelven a leer.
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

/** Lo que carga el adaptador cuando no hay rol (ni, por lo tanto, nada que activar): falla cerrado. */
const SIN_ROL: DatosDelActor = { rol: null, modulosActivados: [], modulosHabilitados: [] };

/**
 * Una fila de la lectura de módulos (`modulosDe`): o un módulo ACTIVADO (`nombre`) o una ASIGNACIÓN de plan
 * del tenant (`numero`, `vigente_desde` y los `modulos` de su versión; `null` si la versión no se ve).
 */
type FilaDeModulos =
  | Readonly<{ tipo: "activado"; nombre: string }>
  | Readonly<{
      tipo: "asignacion";
      numero: number;
      vigente_desde: Date;
      modulos: string[] | null;
    }>;

/** Quién es el actor en la empresa del contexto: su rol y el tenant de esa empresa (que da el plan). */
type MembresiaDelActor = Readonly<{ rol: RolDeEmpresa; tenantId: string }>;

/**
 * Un nombre de módulo que llega de la base tiene que ser una clave del catálogo (`esClaveDe`): la base solo
 * valida la FORMA (`^[a-z][a-z0-9_]{1,39}$`), y un nombre que el catálogo no conoce (o que ni siquiera tiene
 * esa forma) es un dato roto, no un módulo que haya que ignorar en silencio. Como el rol desconocido, es una
 * falla: ningún actor opera con un plan o una activación que el código no sabe leer.
 */
function validarNombresDeModulo(origen: string, nombres: readonly string[]): readonly string[] {
  for (const nombre of nombres) {
    if (!esClaveDe(CATALOGO_DE_MODULOS, nombre)) {
      throw new RangeError(`módulo desconocido en la base (${origen}): ${nombre}`);
    }
  }
  return [...nombres].sort();
}

export function crearAutorizacionDePostgres(db: Kysely<AutorizacionDb>): CargaDeAutorizacion {
  /**
   * El rol de la membresía ACTIVA con la persona activa globalmente que entró por la marca del tenant de
   * la empresa, con el tenant de esa empresa (de la MISMA fila: el plan se busca con él); `null` si no hay
   * (ver arriba). Una marca de entrada `null` con persona no autoriza: ni siquiera se consulta.
   */
  async function membresiaDelActor(contexto: ContextoOperativo): Promise<MembresiaDelActor | null> {
    if (contexto.personaId === null || contexto.marcaDeEntrada === null) return null;
    const fila = await db
      .selectFrom("membresia as m")
      .innerJoin("persona as p", "p.id", "m.persona_id")
      .innerJoin("empresa as e", "e.id", "m.empresa_id")
      .innerJoin("tenant as t", "t.id", "e.tenant_id")
      .select(["m.rol", "e.tenant_id"])
      .where("m.empresa_id", "=", contexto.empresaId)
      .where("t.marca_id", "=", contexto.marcaDeEntrada)
      .where("m.persona_id", "=", contexto.personaId)
      .where("m.activo", "=", true)
      .where("p.activo_global", "=", true)
      .executeTakeFirst();
    if (fila === undefined) return null;
    // Un valor que el CHECK de la base no deja pasar: si llega otro, algo se rompió.
    if (!esRolDeEmpresa(fila.rol)) throw new RangeError(`rol desconocido en la base: ${fila.rol}`);
    return { rol: fila.rol, tenantId: fila.tenant_id };
  }

  /**
   * Los módulos de la empresa, en la transacción en curso (sin caché: una baja, una suspensión o un cambio
   * de plan se ven en la operación siguiente), de una sola lectura consistente:
   *  - activados: las filas ACTIVAS de `modulo_de_empresa` de la empresa del contexto (la RLS ya limita a
   *    esa empresa; el filtro se repite como defensa en profundidad). Las apagadas no cuentan;
   *  - habilitados (el techo): los módulos de la versión de plan de la asignación VIGENTE del tenant a
   *    `contexto.ahora`, con la misma regla pura que los derechos de uso (`vigenteEn`: manda la de mayor
   *    número entre las que ya empezaron). Una asignación programada todavía no rige.
   *
   * Falla cerrado y sin ocultar nada:
   *  - un tenant SIN asignación vigente no tiene techo (`[]`), como en `derechosDeUso` («sin plan: solo los
   *    obligatorios», que no dependen de él): lo activado queda en solo lectura, nunca operativo. No es una
   *    falla porque hoy ningún tenant tiene plan hasta que el alta lo asigne (M6);
   *  - una asignación vigente cuya versión no se ve (no existe o la RLS no la deja ver) es una falla: la
   *    clave foránea impide que ocurra, así que si ocurre algo se rompió;
   *  - un nombre de módulo que el catálogo no conoce, en la activación o en el plan, es una falla.
   * Un módulo activado que no figura en el plan NO es una falla: es el solo lectura (corrección 16), que
   * decide `estadoDeModulos` a partir de estas dos listas.
   */
  async function modulosDe(
    contexto: ContextoOperativo,
    tenantId: string,
  ): Promise<Pick<DatosDelActor, "modulosActivados" | "modulosHabilitados">> {
    // UNA sola sentencia para las dos mitades: así ven el mismo instante de la base aunque la transacción
    // corra en `read committed` (las consultas lo hacen). Con dos sentencias, un cambio atómico de la
    // plataforma (activar un módulo y a la vez cambiar de plan) podía leerse a medias: activado según lo
    // nuevo y habilitado según lo viejo, un estado que nunca existió.
    const { rows } = await sql<FilaDeModulos>`
      select 'activado' as tipo, m.modulo as nombre,
             null::integer as numero, null::timestamptz as vigente_desde, null::text[] as modulos
        from modulo_de_empresa m
       where m.empresa_id = ${contexto.empresaId} and m.activo
      union all
      select 'asignacion', null, a.numero, a.vigente_desde, v.modulos
        from plan_de_tenant a
        left join version_de_plan v on v.id = a.version_de_plan_id
       where a.tenant_id = ${tenantId}`.execute(db);
    const activadas: string[] = [];
    const asignaciones: { numero: number; vigenteDesde: Date; modulos: string[] | null }[] = [];
    for (const fila of rows) {
      if (fila.tipo === "activado") activadas.push(fila.nombre);
      else
        asignaciones.push({
          numero: fila.numero,
          vigenteDesde: fila.vigente_desde,
          modulos: fila.modulos,
        });
    }
    const rige = vigenteEn(asignaciones, contexto.ahora);
    if (rige !== null && rige.modulos === null) {
      throw new RangeError("la versión de plan vigente del tenant no existe en la base");
    }
    return {
      modulosActivados: validarNombresDeModulo("activados", activadas),
      modulosHabilitados: validarNombresDeModulo("plan", rige?.modulos ?? []),
    };
  }

  /** Solo el rol (para el alcance de sucursales, que no necesita módulos ni plan). */
  async function rolDelActor(contexto: ContextoOperativo): Promise<RolDeEmpresa | null> {
    return (await membresiaDelActor(contexto))?.rol ?? null;
  }

  return {
    async delActor(contexto): Promise<DatosDelActor> {
      const membresia = await membresiaDelActor(contexto);
      // Sin rol no se lee ningún módulo: el actor no opera y no hay nada que activar (falla cerrado).
      if (membresia === null) return SIN_ROL;
      return { rol: membresia.rol, ...(await modulosDe(contexto, membresia.tenantId)) };
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
