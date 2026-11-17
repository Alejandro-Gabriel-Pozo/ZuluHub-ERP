import type { Kysely } from "kysely";
import type { AlcanceDeSucursales } from "../../../capacidades/permisos/alcance";
import type { EmpresaId, SucursalId } from "../../../primitivas/identificadores/marca";
import type { StockDb } from "./esquema";
import { aDeposito, esUuid } from "./filas";
import { insertarIdempotente } from "../../catalogo/publico";
import type { Deposito, UsoDeDeposito } from "./modelo";

export type AltaDeDeposito = Readonly<{
  /** Lo manda la aplicación: es la idempotencia del alta. */
  id: string;
  sucursalId: SucursalId;
  nombre: string;
  nombreClave: string;
  uso: UsoDeDeposito;
  deVenta: boolean;
}>;

export type CambiosDeDeposito = Readonly<{ nombre: string; nombreClave: string; deVenta: boolean }>;

export type FiltroDeDepositos = Readonly<{
  /** Lo que el actor puede ver: `"TODAS"` o la lista de sus sucursales (vacía: no ve ninguno). */
  alcance: AlcanceDeSucursales;
  sucursalId?: SucursalId | undefined;
  /** Solo los activos (los inactivos no se ofrecen para mover). */
  soloActivos?: boolean | undefined;
}>;

export interface RepositorioDeDepositos {
  obtener(empresa: EmpresaId, id: string): Promise<Deposito | null>;
  /** El depósito con `SELECT … FOR UPDATE`: serializa editar, desactivar y reactivar el mismo depósito. `null` si no existe o es de otra empresa. */
  bloquear(empresa: EmpresaId, id: string): Promise<Deposito | null>;
  /**
   * `INSERT … ON CONFLICT DO NOTHING` por el `id`: `true` si insertó, `false` si ya había un depósito con ese id. Un nombre repetido o un segundo
   * «de venta» NO son un conflicto del id: salen como error de unicidad (`deposito_nombre_uk`, `deposito_de_venta_uk`).
   */
  insertar(empresa: EmpresaId, alta: AltaDeDeposito): Promise<boolean>;
  /** Cambia el nombre y si es el de venta con control de versión (la base la sube); `null` si la versión ya no es esa. */
  actualizar(
    empresa: EmpresaId,
    id: string,
    versionEsperada: number,
    cambios: CambiosDeDeposito,
  ): Promise<Deposito | null>;
  cambiarActivo(empresa: EmpresaId, id: string, activo: boolean): Promise<Deposito | null>;
  /** El depósito de venta ACTIVO de la sucursal (a lo sumo uno), o `null`. */
  deVentaDe(empresa: EmpresaId, sucursal: SucursalId): Promise<Deposito | null>;
  /** Los depósitos que el alcance deja ver, por sucursal y nombre. */
  listar(empresa: EmpresaId, filtro: FiltroDeDepositos): Promise<Deposito[]>;
}

export function crearRepositorioDeDepositos(db: Kysely<StockDb>): RepositorioDeDepositos {
  return {
    async obtener(empresa, id) {
      if (!esUuid(id)) return null;
      const fila = await db
        .selectFrom("deposito")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .executeTakeFirst();
      return fila === undefined ? null : aDeposito(fila);
    },
    async bloquear(empresa, id) {
      if (!esUuid(id)) return null;
      const fila = await db
        .selectFrom("deposito")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .forUpdate()
        .executeTakeFirst();
      return fila === undefined ? null : aDeposito(fila);
    },
    async insertar(empresa, alta) {
      const alta_ = () =>
        db.insertInto("deposito").values({
          id: alta.id,
          empresa_id: empresa,
          sucursal_id: alta.sucursalId,
          nombre: alta.nombre,
          nombre_clave: alta.nombreClave,
          uso: alta.uso,
          de_venta: alta.deVenta,
        });
      const fila = await insertarIdempotente(
        () =>
          alta_()
            .onConflict((oc) => oc.doNothing())
            .returning("id")
            .executeTakeFirst(),
        async () =>
          (await db
            .selectFrom("deposito")
            .select("id")
            .where("empresa_id", "=", empresa)
            .where("id", "=", alta.id)
            .executeTakeFirst()) !== undefined,
        () => alta_().returning("id").executeTakeFirstOrThrow(),
      );
      return fila !== undefined;
    },
    async actualizar(empresa, id, versionEsperada, cambios) {
      const fila = await db
        .updateTable("deposito")
        .set({
          nombre: cambios.nombre,
          nombre_clave: cambios.nombreClave,
          de_venta: cambios.deVenta,
        })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("version", "=", versionEsperada)
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aDeposito(fila);
    },
    async cambiarActivo(empresa, id, activo) {
      const fila = await db
        .updateTable("deposito")
        .set({ activo })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aDeposito(fila);
    },
    async deVentaDe(empresa, sucursal) {
      const fila = await db
        .selectFrom("deposito")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("sucursal_id", "=", sucursal)
        .where("de_venta", "=", true)
        .where("activo", "=", true)
        .executeTakeFirst();
      return fila === undefined ? null : aDeposito(fila);
    },
    async listar(empresa, filtro) {
      if (filtro.alcance !== "TODAS" && filtro.alcance.length === 0) return [];
      let consulta = db.selectFrom("deposito").selectAll().where("empresa_id", "=", empresa);
      if (filtro.alcance !== "TODAS") {
        consulta = consulta.where("sucursal_id", "in", [...filtro.alcance]);
      }
      if (filtro.sucursalId !== undefined) {
        consulta = consulta.where("sucursal_id", "=", filtro.sucursalId);
      }
      if (filtro.soloActivos === true) consulta = consulta.where("activo", "=", true);
      const filas = await consulta
        .orderBy("sucursal_id")
        .orderBy("nombre_clave")
        .orderBy("id")
        .execute();
      return filas.map(aDeposito);
    },
  };
}
