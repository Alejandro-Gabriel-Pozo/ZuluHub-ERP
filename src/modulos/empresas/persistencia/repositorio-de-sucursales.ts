import { sql, type Kysely, type Selectable } from "kysely";
import {
  empresaId,
  sucursalId,
  type EmpresaId,
  type SucursalId,
} from "../../../primitivas/identificadores/marca";
import { horaDelDiaDesdeTexto, type HoraDelDia } from "../../../primitivas/tiempo/hora-del-dia";
import type { DatosDeJornada, Sucursal } from "../dominio/sucursal";
import { FORMA_DE_UUID, type EmpresasDb } from "./repositorios";

/** Resultado de `crearSiNoExiste`: la sucursal nueva, o la que ya tenía ese nombre. */
export type AltaDeSucursal = Readonly<{ creada: boolean; sucursal: Sucursal }>;

export interface RepositorioDeSucursales {
  crear(empresa: EmpresaId, nombre: string): Promise<Sucursal>;
  listar(empresa: EmpresaId): Promise<Sucursal[]>;
  /**
   * Cambia el nombre y/o la hora de corte en un solo `UPDATE` (una versión nueva) si la versión
   * coincide; `null` si no coincide o no existe. Al menos un cambio: sin ninguno lanza `RangeError`.
   */
  editar(
    id: SucursalId,
    versionEsperada: number,
    cambios: Readonly<{ nombre?: string; horaDeCorte?: HoraDelDia }>,
  ): Promise<Sucursal | null>;
  /**
   * La zona horaria de la empresa de la sucursal y la hora de corte de la sucursal, en una lectura
   * (la fecha de negocio se calcula con las dos). `null` si no existe o es de otra empresa (la RLS
   * oculta las ajenas, igual que a `obtener`).
   */
  jornadaDe(id: SucursalId): Promise<DatosDeJornada | null>;
  /**
   * Da de alta la sucursal SIN leerla de vuelta (`INSERT` sin `RETURNING`): la plataforma puede crear
   * la sucursal inicial de una empresa pero no tiene permiso de lectura sobre `sucursal` (son datos
   * operativos), y un `RETURNING` exigiría ese permiso. Un nombre repetido sale como error de unicidad.
   */
  sembrar(empresa: EmpresaId, nombre: string): Promise<void>;
  /** Una sucursal de la empresa; `null` si no existe o es de otra empresa. */
  obtener(empresa: EmpresaId, id: SucursalId): Promise<Sucursal | null>;
  /** Solo las activas de la empresa, ordenadas por nombre e id. */
  listarActivas(empresa: EmpresaId): Promise<Sucursal[]>;
  /**
   * Crea la sucursal salvo que la empresa ya tenga una con ese nombre (sin distinguir mayúsculas,
   * activa o no): `INSERT ... ON CONFLICT DO NOTHING` y, si no insertó, devuelve la existente.
   */
  crearSiNoExiste(empresa: EmpresaId, nombre: string): Promise<AltaDeSucursal>;
  /** Activa o desactiva si la versión coincide; `null` si no coincide o no es de la empresa. */
  cambiarActiva(
    empresa: EmpresaId,
    id: SucursalId,
    versionEsperada: number,
    activa: boolean,
  ): Promise<Sucursal | null>;
}

/** `HH:MM:SS` de la columna `time` → `HH:MM`. Un valor que el CHECK de la base no deja pasar es una falla. */
function aHoraDeCorte(hora: string): HoraDelDia {
  const leida = horaDelDiaDesdeTexto(hora.slice(0, 5));
  if (!leida.ok || hora.length !== 8 || !hora.endsWith(":00")) {
    throw new RangeError(`hora de corte inválida en la base: ${hora}`);
  }
  return leida.valor;
}

function aSucursal(fila: Selectable<EmpresasDb["sucursal"]>): Sucursal {
  return {
    id: sucursalId(fila.id),
    empresaId: empresaId(fila.empresa_id),
    nombre: fila.nombre,
    activa: fila.activa,
    horaDeCorte: aHoraDeCorte(fila.hora_de_corte),
    version: fila.version,
  };
}

export function crearRepositorioDeSucursales(db: Kysely<EmpresasDb>): RepositorioDeSucursales {
  return {
    async obtener(empresa, id) {
      // Un texto que no es un UUID no puede ser el id de ninguna sucursal: la base lo rechazaría
      // con un error de formato en lugar de "no existe".
      if (!FORMA_DE_UUID.test(id)) return null;
      const fila = await db
        .selectFrom("sucursal")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .executeTakeFirst();
      return fila === undefined ? null : aSucursal(fila);
    },

    async listarActivas(empresa) {
      const filas = await db
        .selectFrom("sucursal")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("activa", "=", true)
        .orderBy("nombre")
        .orderBy("id")
        .execute();
      return filas.map(aSucursal);
    },

    async sembrar(empresa, nombre) {
      await db.insertInto("sucursal").values({ empresa_id: empresa, nombre }).execute();
    },

    async crearSiNoExiste(empresa, nombre) {
      const nueva = await db
        .insertInto("sucursal")
        .values({ empresa_id: empresa, nombre })
        .onConflict((oc) => oc.doNothing())
        .returningAll()
        .executeTakeFirst();
      if (nueva !== undefined) return { creada: true, sucursal: aSucursal(nueva) };
      // El índice único `sucursal_nombre_ci_uk` (0005) compara con el orden ICU `sucursal_nombre_ci`
      // (sin distinguir mayúsculas y sin depender del locale de la base): se busca con el mismo.
      // Con `lower()` y un servidor en locale `C`, «CAFÉ» chocaría con «café» y no se encontraría.
      const existente = await db
        .selectFrom("sucursal")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where(sql<boolean>`nombre = ${nombre} collate sucursal_nombre_ci`)
        .executeTakeFirst();
      if (existente === undefined) {
        throw new Error("el alta de sucursal no insertó y tampoco hay una con ese nombre");
      }
      return { creada: false, sucursal: aSucursal(existente) };
    },

    async cambiarActiva(empresa, id, versionEsperada, activa) {
      const fila = await db
        .updateTable("sucursal")
        .set({ activa })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("version", "=", versionEsperada)
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aSucursal(fila);
    },

    async crear(empresa, nombre) {
      const fila = await db
        .insertInto("sucursal")
        .values({ empresa_id: empresa, nombre })
        .returningAll()
        .executeTakeFirstOrThrow();
      return aSucursal(fila);
    },

    async listar(empresa) {
      const filas = await db
        .selectFrom("sucursal")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .orderBy("nombre")
        .orderBy("id")
        .execute();
      return filas.map(aSucursal);
    },

    async editar(id, versionEsperada, cambios) {
      if (cambios.nombre === undefined && cambios.horaDeCorte === undefined) {
        throw new RangeError("editar una sucursal exige al menos un cambio");
      }
      const fila = await db
        .updateTable("sucursal")
        .set({
          ...(cambios.nombre === undefined ? {} : { nombre: cambios.nombre }),
          ...(cambios.horaDeCorte === undefined ? {} : { hora_de_corte: cambios.horaDeCorte }),
        })
        .where("id", "=", id)
        .where("version", "=", versionEsperada)
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aSucursal(fila);
    },

    async jornadaDe(id) {
      if (!FORMA_DE_UUID.test(id)) return null;
      const fila = await db
        .selectFrom("sucursal as s")
        .innerJoin("empresa as e", "e.id", "s.empresa_id")
        .select(["e.zona_horaria", "s.hora_de_corte"])
        .where("s.id", "=", id)
        .executeTakeFirst();
      return fila === undefined
        ? null
        : { zonaHoraria: fila.zona_horaria, horaDeCorte: aHoraDeCorte(fila.hora_de_corte) };
    },
  };
}
