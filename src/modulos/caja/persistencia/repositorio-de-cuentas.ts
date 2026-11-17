import { sql, type Kysely, type Selectable } from "kysely";
import {
  sucursalId,
  type EmpresaId,
  type SucursalId,
} from "../../../primitivas/identificadores/marca";
import type { CuentaDeCobro } from "../dominio/configuracion";
import { esUuid } from "../dominio/identificadores";
import type { TipoDeCuenta } from "../estados";
import type { CajaDb } from "./esquema";

export type NuevaCuentaDeCobro = Readonly<{
  tipo: TipoDeCuenta;
  nombre: string;
  identificadorExterno: string | null;
  sucursalId: SucursalId;
}>;

/** Lo que cambia una edición de cuenta (el tipo no cambia nunca). */
export type CambiosPersistidosDeCuenta = Readonly<{
  nombre: string;
  identificadorExterno: string | null;
  sucursalId: SucursalId;
}>;

export type OpcionesDeListadoDeCuentas = Readonly<{
  /** Solo las cuentas de estas sucursales; `null`: de todas. Una lista vacía no devuelve nada (fail closed). */
  sucursales: readonly SucursalId[] | null;
  incluirInactivas: boolean;
}>;

/** Persistencia de las cuentas de cobro. El nombre es único por empresa sin distinguir mayúsculas (`cuenta_de_cobro_nombre_uk`). */
export interface RepositorioDeCuentasDeCobro {
  obtener(empresa: EmpresaId, id: string): Promise<CuentaDeCobro | null>;
  /** La cuenta que usa ese nombre en la empresa, sin distinguir mayúsculas, activa o no. */
  obtenerPorNombre(empresa: EmpresaId, nombre: string): Promise<CuentaDeCobro | null>;
  /** Alta de una cuenta activa. Un nombre repetido sale como error de unicidad. */
  crear(empresa: EmpresaId, nueva: NuevaCuentaDeCobro): Promise<CuentaDeCobro>;
  /** Por sucursal y nombre; solo lectura. */
  listar(empresa: EmpresaId, opciones: OpcionesDeListadoDeCuentas): Promise<CuentaDeCobro[]>;
  /** Aplica los cambios si la versión coincide; `null` si no coincide o no es de la empresa. */
  editar(
    empresa: EmpresaId,
    id: string,
    versionEsperada: number,
    cambios: CambiosPersistidosDeCuenta,
  ): Promise<CuentaDeCobro | null>;
  cambiarActiva(
    empresa: EmpresaId,
    id: string,
    versionEsperada: number,
    activa: boolean,
  ): Promise<CuentaDeCobro | null>;
}

function aCuenta(fila: Selectable<CajaDb["cuenta_de_cobro"]>): CuentaDeCobro {
  return {
    id: fila.id,
    tipo: fila.tipo,
    nombre: fila.nombre,
    identificadorExterno: fila.identificador_externo,
    sucursalId: sucursalId(fila.sucursal_id),
    activa: fila.activa,
    version: fila.version,
  };
}

export function crearRepositorioDeCuentasDeCobro(db: Kysely<CajaDb>): RepositorioDeCuentasDeCobro {
  const deLaEmpresa = (empresa: EmpresaId) =>
    db.selectFrom("cuenta_de_cobro").selectAll().where("empresa_id", "=", empresa);
  const actualizar = (empresa: EmpresaId, id: string, versionEsperada: number) =>
    db
      .updateTable("cuenta_de_cobro")
      .where("empresa_id", "=", empresa)
      .where("id", "=", id)
      .where("version", "=", versionEsperada);

  return {
    async obtener(empresa, id) {
      if (!esUuid(id)) return null;
      const fila = await deLaEmpresa(empresa).where("id", "=", id).executeTakeFirst();
      return fila === undefined ? null : aCuenta(fila);
    },

    async obtenerPorNombre(empresa, nombre) {
      const fila = await deLaEmpresa(empresa)
        .where(sql<boolean>`lower(nombre) = lower(${nombre})`)
        .executeTakeFirst();
      return fila === undefined ? null : aCuenta(fila);
    },

    async crear(empresa, nueva) {
      const fila = await db
        .insertInto("cuenta_de_cobro")
        .values({
          empresa_id: empresa,
          tipo: nueva.tipo,
          nombre: nueva.nombre,
          identificador_externo: nueva.identificadorExterno,
          sucursal_id: nueva.sucursalId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return aCuenta(fila);
    },

    async listar(empresa, opciones) {
      if (opciones.sucursales !== null && opciones.sucursales.length === 0) return [];
      let consulta = deLaEmpresa(empresa);
      if (opciones.sucursales !== null) {
        consulta = consulta.where("sucursal_id", "in", opciones.sucursales);
      }
      if (!opciones.incluirInactivas) consulta = consulta.where("activa", "=", true);
      const filas = await consulta.orderBy("sucursal_id").orderBy("nombre").orderBy("id").execute();
      return filas.map(aCuenta);
    },

    async editar(empresa, id, versionEsperada, cambios) {
      const fila = await actualizar(empresa, id, versionEsperada)
        .set({
          nombre: cambios.nombre,
          identificador_externo: cambios.identificadorExterno,
          sucursal_id: cambios.sucursalId,
        })
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aCuenta(fila);
    },

    async cambiarActiva(empresa, id, versionEsperada, activa) {
      const fila = await actualizar(empresa, id, versionEsperada)
        .set({ activa })
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aCuenta(fila);
    },
  };
}
