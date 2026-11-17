import { sql, type Kysely, type Selectable } from "kysely";
import {
  sucursalId,
  type EmpresaId,
  type SucursalId,
} from "../../../primitivas/identificadores/marca";
import type { Caja } from "../dominio/configuracion";
import { esUuid } from "../dominio/identificadores";
import type { CajaDb } from "./esquema";

export type OpcionesDeListadoDeCajas = Readonly<{ incluirInactivas: boolean }>;

/**
 * Persistencia de las cajas. Todo corre dentro de la transacción del caso de uso y sin caché. El nombre es único por sucursal sin
 * distinguir mayúsculas (`caja_nombre_uk`, sobre `lower(nombre)`): se busca con la misma expresión.
 */
export interface RepositorioDeCajas {
  /** Una caja de la empresa; `null` si no existe o es de otra empresa (la RLS oculta las ajenas). */
  obtener(empresa: EmpresaId, id: string): Promise<Caja | null>;
  /** La caja de esa sucursal con ese nombre, sin distinguir mayúsculas, activa o no. */
  obtenerPorNombre(empresa: EmpresaId, sucursal: SucursalId, nombre: string): Promise<Caja | null>;
  /** Cuántas cajas ACTIVAS tiene la sucursal (lo que cuenta el límite del plan). */
  contarActivas(empresa: EmpresaId, sucursal: SucursalId): Promise<number>;
  /** Alta de una caja activa. Un nombre repetido sale como error de unicidad (`caja_nombre_uk`). */
  crear(empresa: EmpresaId, sucursal: SucursalId, nombre: string): Promise<Caja>;
  /**
   * La primera caja de la sucursal por nombre e id, ACTIVA O NO (con una desactivada o renombrada la sucursal ya tiene caja); `null` si no
   * tiene ninguna. Es lo que mira la caja por defecto antes de insertar.
   */
  primeraDeLaSucursal(empresa: EmpresaId, sucursal: SucursalId): Promise<Caja | null>;
  /**
   * Alta de una caja activa con `INSERT ... ON CONFLICT DO NOTHING` sobre la única de nombre: `null` si ya había una con ese nombre en la
   * sucursal (otra transacción la insertó antes). La usa la caja por defecto, que no debe fallar por un doble ingreso.
   */
  crearSiNoExiste(empresa: EmpresaId, sucursal: SucursalId, nombre: string): Promise<Caja | null>;
  /** Las cajas de la sucursal ordenadas por nombre e id; sin las inactivas salvo que se pidan. Solo lectura. */
  listarDeLaSucursal(
    empresa: EmpresaId,
    sucursal: SucursalId,
    opciones: OpcionesDeListadoDeCajas,
  ): Promise<Caja[]>;
  /** Cambia el nombre si la versión coincide; `null` si no coincide o no es de la empresa. */
  editarNombre(
    empresa: EmpresaId,
    id: string,
    versionEsperada: number,
    nombre: string,
  ): Promise<Caja | null>;
  /** Activa o desactiva si la versión coincide; `null` si no coincide o no es de la empresa. */
  cambiarActiva(
    empresa: EmpresaId,
    id: string,
    versionEsperada: number,
    activa: boolean,
  ): Promise<Caja | null>;
}

function aCaja(fila: Selectable<CajaDb["caja"]>): Caja {
  return {
    id: fila.id,
    sucursalId: sucursalId(fila.sucursal_id),
    nombre: fila.nombre,
    activa: fila.activa,
    version: fila.version,
  };
}

export function crearRepositorioDeCajas(db: Kysely<CajaDb>): RepositorioDeCajas {
  return {
    async obtener(empresa, id) {
      // Un texto que no es un UUID no puede ser el id de ninguna caja: la base lo rechazaría con un error de formato.
      if (!esUuid(id)) return null;
      const fila = await db
        .selectFrom("caja")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .executeTakeFirst();
      return fila === undefined ? null : aCaja(fila);
    },

    async obtenerPorNombre(empresa, sucursal, nombre) {
      const fila = await db
        .selectFrom("caja")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("sucursal_id", "=", sucursal)
        .where(sql<boolean>`lower(nombre) = lower(${nombre})`)
        .executeTakeFirst();
      return fila === undefined ? null : aCaja(fila);
    },

    async contarActivas(empresa, sucursal) {
      const fila = await db
        .selectFrom("caja")
        .select(sql<string>`count(*)::text`.as("n"))
        .where("empresa_id", "=", empresa)
        .where("sucursal_id", "=", sucursal)
        .where("activa", "=", true)
        .executeTakeFirstOrThrow();
      return Number(fila.n);
    },

    async crear(empresa, sucursal, nombre) {
      const fila = await db
        .insertInto("caja")
        .values({ empresa_id: empresa, sucursal_id: sucursal, nombre })
        .returningAll()
        .executeTakeFirstOrThrow();
      return aCaja(fila);
    },

    async primeraDeLaSucursal(empresa, sucursal) {
      const fila = await db
        .selectFrom("caja")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("sucursal_id", "=", sucursal)
        .orderBy("nombre")
        .orderBy("id")
        .limit(1)
        .executeTakeFirst();
      return fila === undefined ? null : aCaja(fila);
    },

    async crearSiNoExiste(empresa, sucursal, nombre) {
      const fila = await db
        .insertInto("caja")
        .values({ empresa_id: empresa, sucursal_id: sucursal, nombre })
        .onConflict((oc) => oc.doNothing())
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aCaja(fila);
    },

    async listarDeLaSucursal(empresa, sucursal, opciones) {
      let consulta = db
        .selectFrom("caja")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("sucursal_id", "=", sucursal);
      if (!opciones.incluirInactivas) consulta = consulta.where("activa", "=", true);
      const filas = await consulta.orderBy("nombre").orderBy("id").execute();
      return filas.map(aCaja);
    },

    async editarNombre(empresa, id, versionEsperada, nombre) {
      const fila = await db
        .updateTable("caja")
        .set({ nombre })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("version", "=", versionEsperada)
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aCaja(fila);
    },

    async cambiarActiva(empresa, id, versionEsperada, activa) {
      const fila = await db
        .updateTable("caja")
        .set({ activa })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("version", "=", versionEsperada)
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aCaja(fila);
    },
  };
}
