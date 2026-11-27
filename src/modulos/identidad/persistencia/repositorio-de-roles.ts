import { sql, type Kysely } from "kysely";
import type { PisosDeAcciones, TipoDePiso } from "../../../capacidades/roles/pisos";
import { TIPOS_DE_PISO } from "../../../capacidades/roles/pisos";
import {
  empresaId,
  personaId,
  type EmpresaId,
  type PersonaId,
} from "../../../primitivas/identificadores/marca";
import { deLaLista } from "./repositorios-comunes";
import type { IdentidadDb } from "./tablas";

/** Las plantillas base de las que puede nacer un rol propio (el gerente no tiene lista editable). */
export const PLANTILLAS_DE_ORIGEN = ["ADMINISTRADOR", "OPERADOR"] as const;
export type PlantillaDeOrigen = (typeof PLANTILLAS_DE_ORIGEN)[number];

/** Un rol propio de la empresa con su VERSIÓN VIGENTE (la de mayor número). `version` es el control optimista de la fila; `numeroDeVersion`, el de la lista de acciones. */
export type RolPropio = Readonly<{
  id: string;
  empresaId: EmpresaId;
  nombre: string;
  plantillaOrigen: PlantillaDeOrigen | null;
  activo: boolean;
  version: number;
  numeroDeVersion: number;
  acciones: readonly string[];
}>;

export type RolPropioDeLista = RolPropio & Readonly<{ personasActivas: number }>;

/** Un evento de la auditoría de un rol propio, tal como está guardado (`antes` y `despues` sin interpretar: los valida la consulta). */
export type EventoDeAuditoriaDeRol = Readonly<{
  id: string;
  accion: string;
  actor: PersonaId | null;
  creadoEn: Date;
  antes: unknown;
  despues: unknown;
}>;

/** Las acciones auditadas que cuentan la vida de un rol propio (lo que muestra su historial). */
export const ACCIONES_DEL_HISTORIAL_DE_UN_ROL = [
  "ROL_CREADO",
  "ROL_EDITADO",
  "ROL_ARCHIVADO",
  "ROL_REACTIVADO",
] as const;

export type AltaDeRol = Readonly<{
  id: string;
  empresaId: EmpresaId;
  nombre: string;
  nombreClave: string;
  plantillaOrigen: PlantillaDeOrigen | null;
  acciones: readonly string[];
  creadoPor: PersonaId;
  ahora: Date;
}>;

/**
 * Repositorio de los roles propios de la empresa (H4b T4; tablas de 0094). Mismas reglas que los demás repositorios de identidad: los cambios de estado son
 * `UPDATE ... WHERE version = ...` y devuelven si tocaron la fila; las restricciones de la base salen tal cual y se traducen en los casos de uso. Las versiones de un rol
 * son de solo inserción: cambiar sus acciones es agregar una versión con el número siguiente (si dos ediciones llegan a la vez, la segunda choca con la clave primaria).
 */
export interface RepositorioDeRoles {
  obtener(empresa: EmpresaId, rolId: string): Promise<RolPropio | null>;
  /** Por la CLAVE del nombre (sin distinguir mayúsculas), también entre los archivados. */
  obtenerPorNombre(empresa: EmpresaId, nombreClave: string): Promise<RolPropio | null>;
  listar(empresa: EmpresaId): Promise<readonly RolPropioDeLista[]>;
  /** Cuántos roles propios ACTIVOS tiene la empresa (lo que cuenta la perilla y el tope técnico). */
  contarActivos(empresa: EmpresaId): Promise<number>;
  /** Cuántas personas ACTIVAS tienen ese rol. */
  personasActivas(empresa: EmpresaId, rolId: string): Promise<number>;
  /** Inserta el rol y su versión 1 (en la misma transacción). El id lo manda quien llama: repetir el alta con el mismo id choca con la clave primaria. */
  crear(alta: AltaDeRol): Promise<void>;
  /** Agrega la versión `numero` (la siguiente a la vigente). */
  agregarVersion(
    empresa: EmpresaId,
    rolId: string,
    numero: number,
    acciones: readonly string[],
    creadoPor: PersonaId,
    ahora: Date,
  ): Promise<void>;
  cambiarNombre(
    empresa: EmpresaId,
    rolId: string,
    nombre: string,
    nombreClave: string,
    versionEsperada: number,
  ): Promise<boolean>;
  cambiarActivo(
    empresa: EmpresaId,
    rolId: string,
    activo: boolean,
    versionEsperada: number,
  ): Promise<boolean>;
  /**
   * Los últimos `limite` eventos de la auditoría de ESE rol de ESA empresa (solo los de `ACCIONES_DEL_HISTORIAL_DE_UN_ROL`), del más nuevo al más viejo (fecha y, a igual instante, el id: el orden es estable).
   * Solo lectura; la RLS y el filtro por empresa vuelven a acotar a la empresa del contexto.
   */
  historial(
    empresa: EmpresaId,
    rolId: string,
    limite: number,
  ): Promise<readonly EventoDeAuditoriaDeRol[]>;
  /** Los pisos que fijó la plataforma (una acción sin piso es libre dentro del plan). */
  pisos(): Promise<PisosDeAcciones>;
  /** Las acciones de la versión vigente de una plantilla base, o `null` si no hay ninguna. */
  accionesDeLaPlantilla(clave: PlantillaDeOrigen): Promise<readonly string[] | null>;
}

type FilaDeRol = {
  id: string;
  empresa_id: string;
  nombre: string;
  plantilla_origen: string | null;
  activo: boolean;
  version: number;
  numero_de_version: number | null;
  acciones: string[] | null;
};

const SELECCION_DE_ROL = sql`r.id, r.empresa_id, r.nombre, r.plantilla_origen, r.activo, r.version,
  v.numero as numero_de_version, v.acciones as acciones`;
/** La versión vigente (la de mayor número) de cada rol, por lateral: sin versión legible el rol no tiene acciones (nace cerrado). */
const CON_VERSION_VIGENTE = sql`left join lateral (
    select x.numero, x.acciones from version_de_rol x
     where x.empresa_id = r.empresa_id and x.rol_id = r.id order by x.numero desc limit 1
  ) v on true`;

export function crearRepositorioDeRoles(db: Kysely<IdentidadDb>): RepositorioDeRoles {
  const aRol = (f: FilaDeRol): RolPropio => ({
    id: f.id,
    empresaId: empresaId(f.empresa_id),
    nombre: f.nombre,
    plantillaOrigen:
      f.plantilla_origen === null
        ? null
        : deLaLista(PLANTILLAS_DE_ORIGEN, f.plantilla_origen, "plantilla_origen"),
    activo: f.activo,
    version: f.version,
    numeroDeVersion: f.numero_de_version ?? 0,
    acciones: f.acciones ?? [],
  });
  return {
    async obtener(empresa, rolId) {
      const { rows } =
        await sql<FilaDeRol>`select ${SELECCION_DE_ROL} from rol_de_empresa r ${CON_VERSION_VIGENTE}
        where r.empresa_id = ${empresa} and r.id = ${rolId}`.execute(db);
      const fila = rows[0];
      return fila === undefined ? null : aRol(fila);
    },

    async obtenerPorNombre(empresa, nombreClave) {
      const { rows } =
        await sql<FilaDeRol>`select ${SELECCION_DE_ROL} from rol_de_empresa r ${CON_VERSION_VIGENTE}
        where r.empresa_id = ${empresa} and r.nombre_clave = ${nombreClave}`.execute(db);
      const fila = rows[0];
      return fila === undefined ? null : aRol(fila);
    },

    async listar(empresa) {
      const { rows } = await sql<FilaDeRol & { personas_activas: number }>`
        select ${SELECCION_DE_ROL},
               (select count(*)::int from membresia m
                 where m.empresa_id = r.empresa_id and m.rol_propio_id = r.id and m.activo) as personas_activas
          from rol_de_empresa r ${CON_VERSION_VIGENTE}
         where r.empresa_id = ${empresa}
         order by r.nombre_clave, r.id`.execute(db);
      return rows.map((f) => ({ ...aRol(f), personasActivas: f.personas_activas }));
    },

    async contarActivos(empresa) {
      const fila = await db
        .selectFrom("rol_de_empresa")
        .select(sql<number>`count(*)::int`.as("n"))
        .where("empresa_id", "=", empresa)
        .where("activo", "=", true)
        .executeTakeFirstOrThrow();
      return fila.n;
    },

    async personasActivas(empresa, rolId) {
      const { rows } = await sql<{ n: number }>`select count(*)::int as n from membresia
        where empresa_id = ${empresa} and rol_propio_id = ${rolId} and activo`.execute(db);
      return rows[0]?.n ?? 0;
    },

    async historial(empresa, rolId, limite) {
      const { rows } = await sql<{
        id: string;
        accion: string;
        actor_persona_id: string | null;
        creado_en: Date;
        antes: unknown;
        despues: unknown;
      }>`select id::text as id, accion, actor_persona_id, creado_en, antes, despues from auditoria_empresa
        where empresa_id = ${empresa} and entidad = 'rol_de_empresa' and entidad_id = ${rolId}
          and accion = any(${[...ACCIONES_DEL_HISTORIAL_DE_UN_ROL]}::text[])
        order by creado_en desc, id desc limit ${limite}`.execute(db);
      return rows.map((f) => ({
        id: f.id,
        accion: f.accion,
        actor: f.actor_persona_id === null ? null : personaId(f.actor_persona_id),
        creadoEn: f.creado_en,
        antes: f.antes,
        despues: f.despues,
      }));
    },

    async crear(alta) {
      await db
        .insertInto("rol_de_empresa")
        .values({
          id: alta.id,
          empresa_id: alta.empresaId,
          nombre: alta.nombre,
          nombre_clave: alta.nombreClave,
          plantilla_origen: alta.plantillaOrigen,
        })
        .execute();
      await db
        .insertInto("version_de_rol")
        .values({
          empresa_id: alta.empresaId,
          rol_id: alta.id,
          numero: 1,
          acciones: [...alta.acciones],
          creado_por: alta.creadoPor,
          creado_en: alta.ahora,
        })
        .execute();
    },

    async agregarVersion(empresa, rolId, numero, acciones, creadoPor, ahora) {
      await db
        .insertInto("version_de_rol")
        .values({
          empresa_id: empresa,
          rol_id: rolId,
          numero,
          acciones: [...acciones],
          creado_por: creadoPor,
          creado_en: ahora,
        })
        .execute();
    },

    async cambiarNombre(empresa, rolId, nombre, nombreClave, versionEsperada) {
      const r = await db
        .updateTable("rol_de_empresa")
        .set({ nombre, nombre_clave: nombreClave })
        .where("empresa_id", "=", empresa)
        .where("id", "=", rolId)
        .where("version", "=", versionEsperada)
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },

    async cambiarActivo(empresa, rolId, activo, versionEsperada) {
      const r = await db
        .updateTable("rol_de_empresa")
        .set({ activo })
        .where("empresa_id", "=", empresa)
        .where("id", "=", rolId)
        .where("activo", "=", !activo)
        .where("version", "=", versionEsperada)
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },

    async pisos() {
      const { rows } = await sql<{
        accion: string;
        tipo: string;
      }>`select accion, tipo from piso_de_plataforma`.execute(db);
      const pisos: Record<string, TipoDePiso> = {};
      for (const f of rows) pisos[f.accion] = deLaLista(TIPOS_DE_PISO, f.tipo, "tipo de piso");
      return pisos;
    },

    async accionesDeLaPlantilla(clave) {
      const { rows } = await sql<{ acciones: string[] }>`select acciones from version_de_plantilla
        where clave = ${clave} order by numero desc limit 1`.execute(db);
      return rows[0]?.acciones ?? null;
    },
  };
}
