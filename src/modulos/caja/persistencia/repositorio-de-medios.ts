import { sql, type Kysely, type Selectable } from "kysely";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import type { MedioDePago } from "../dominio/configuracion";
import { esUuid } from "../dominio/identificadores";
import type { DatosQuePideElMedio } from "../dominio/medios";
import type { TipoDeMedio } from "../estados";
import type { CajaDb } from "./esquema";

export type OpcionesDeListadoDeMedios = Readonly<{ incluirInactivos: boolean }>;

/** Lo que cambia una edición: el nombre (`null` lo borra) y/o los datos que pide. Al menos uno. */
export type CambiosPersistidosDeMedio = Readonly<{
  nombre?: string | null;
  pide?: DatosQuePideElMedio;
}>;

/**
 * Persistencia de los medios de pago. Hay un solo efectivo por empresa (`medio_de_pago_efectivo_uk`); el nombre es único por empresa sin
 * distinguir mayúsculas (`medio_de_pago_nombre_uk`) y, sin nombre, hay uno por tipo (`medio_de_pago_sin_nombre_uk`).
 */
export interface RepositorioDeMediosDePago {
  obtener(empresa: EmpresaId, id: string): Promise<MedioDePago | null>;
  /** El medio que usa ese nombre en la empresa, sin distinguir mayúsculas (de cualquier tipo, activo o no). */
  obtenerPorNombre(empresa: EmpresaId, nombre: string): Promise<MedioDePago | null>;
  /** El medio SIN nombre de ese tipo (uno solo por tipo). */
  obtenerSinNombre(empresa: EmpresaId, tipo: TipoDeMedio): Promise<MedioDePago | null>;
  /** El efectivo de la empresa, si ya existe. */
  obtenerEfectivo(empresa: EmpresaId): Promise<MedioDePago | null>;
  /** Alta de un medio activo que no pide ningún dato. Un duplicado sale como error de unicidad. */
  crear(empresa: EmpresaId, tipo: TipoDeMedio, nombre: string | null): Promise<MedioDePago>;
  /**
   * Asegura el efectivo de la empresa: lo crea (sin nombre) si no está (`INSERT ... ON CONFLICT DO NOTHING`) y devuelve el que haya.
   * `creado` dice si lo insertó esta llamada. Lo usan `crearCaja` y, en el tramo siguiente, la caja por defecto.
   */
  asegurarEfectivo(empresa: EmpresaId): Promise<Readonly<{ creado: boolean; medio: MedioDePago }>>;
  /** Los medios de la empresa por tipo y nombre; sin los inactivos salvo que se pidan. Solo lectura. */
  listar(empresa: EmpresaId, opciones: OpcionesDeListadoDeMedios): Promise<MedioDePago[]>;
  /** Aplica los cambios si la versión coincide; `null` si no coincide o no es de la empresa. Sin ningún cambio lanza `RangeError`. */
  editar(
    empresa: EmpresaId,
    id: string,
    versionEsperada: number,
    cambios: CambiosPersistidosDeMedio,
  ): Promise<MedioDePago | null>;
  cambiarActivo(
    empresa: EmpresaId,
    id: string,
    versionEsperada: number,
    activo: boolean,
  ): Promise<MedioDePago | null>;
}

function aMedio(fila: Selectable<CajaDb["medio_de_pago"]>): MedioDePago {
  return {
    id: fila.id,
    tipo: fila.tipo,
    nombre: fila.nombre,
    activo: fila.activo,
    pide: {
      cupon: fila.pide_cupon,
      ultimos4: fila.pide_ultimos4,
      marca: fila.pide_marca,
      cuotas: fila.pide_cuotas,
      dni: fila.pide_dni,
    },
    version: fila.version,
  };
}

export function crearRepositorioDeMediosDePago(db: Kysely<CajaDb>): RepositorioDeMediosDePago {
  const deLaEmpresa = (empresa: EmpresaId) =>
    db.selectFrom("medio_de_pago").selectAll().where("empresa_id", "=", empresa);
  const actualizar = (empresa: EmpresaId, id: string, versionEsperada: number) =>
    db
      .updateTable("medio_de_pago")
      .where("empresa_id", "=", empresa)
      .where("id", "=", id)
      .where("version", "=", versionEsperada);

  return {
    async obtener(empresa, id) {
      if (!esUuid(id)) return null;
      const fila = await deLaEmpresa(empresa).where("id", "=", id).executeTakeFirst();
      return fila === undefined ? null : aMedio(fila);
    },

    async obtenerPorNombre(empresa, nombre) {
      const fila = await deLaEmpresa(empresa)
        .where(sql<boolean>`lower(nombre) = lower(${nombre})`)
        .executeTakeFirst();
      return fila === undefined ? null : aMedio(fila);
    },

    async obtenerSinNombre(empresa, tipo) {
      const fila = await deLaEmpresa(empresa)
        .where("tipo", "=", tipo)
        .where("nombre", "is", null)
        .executeTakeFirst();
      return fila === undefined ? null : aMedio(fila);
    },

    async obtenerEfectivo(empresa) {
      const fila = await deLaEmpresa(empresa).where("tipo", "=", "EFECTIVO").executeTakeFirst();
      return fila === undefined ? null : aMedio(fila);
    },

    async crear(empresa, tipo, nombre) {
      const fila = await db
        .insertInto("medio_de_pago")
        .values({ empresa_id: empresa, tipo, nombre })
        .returningAll()
        .executeTakeFirstOrThrow();
      return aMedio(fila);
    },

    async asegurarEfectivo(empresa) {
      const nuevo = await db
        .insertInto("medio_de_pago")
        .values({ empresa_id: empresa, tipo: "EFECTIVO", nombre: null })
        .onConflict((oc) => oc.doNothing())
        .returningAll()
        .executeTakeFirst();
      if (nuevo !== undefined) return { creado: true, medio: aMedio(nuevo) };
      const existente = await deLaEmpresa(empresa)
        .where("tipo", "=", "EFECTIVO")
        .executeTakeFirst();
      if (existente === undefined) {
        throw new Error("no se pudo asegurar el efectivo: no insertó y tampoco existe uno");
      }
      return { creado: false, medio: aMedio(existente) };
    },

    async listar(empresa, opciones) {
      let consulta = deLaEmpresa(empresa);
      if (!opciones.incluirInactivos) consulta = consulta.where("activo", "=", true);
      const filas = await consulta.orderBy("tipo").orderBy("nombre").orderBy("id").execute();
      return filas.map(aMedio);
    },

    async editar(empresa, id, versionEsperada, cambios) {
      const { pide } = cambios;
      if (cambios.nombre === undefined && pide === undefined) {
        throw new RangeError("editar un medio de pago exige al menos un cambio");
      }
      const fila = await actualizar(empresa, id, versionEsperada)
        .set({
          ...(cambios.nombre === undefined ? {} : { nombre: cambios.nombre }),
          ...(pide === undefined
            ? {}
            : {
                pide_cupon: pide.cupon,
                pide_ultimos4: pide.ultimos4,
                pide_marca: pide.marca,
                pide_cuotas: pide.cuotas,
                pide_dni: pide.dni,
              }),
        })
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aMedio(fila);
    },

    async cambiarActivo(empresa, id, versionEsperada, activo) {
      const fila = await actualizar(empresa, id, versionEsperada)
        .set({ activo })
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aMedio(fila);
    },
  };
}
