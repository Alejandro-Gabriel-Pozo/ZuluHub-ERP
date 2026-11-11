import type { Kysely } from "kysely";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import type { ComprasDb } from "./esquema";
import { esUuid } from "./filas";

export type PresentacionGuardada = Readonly<{
  id: string;
  productoId: string;
  nombre: string;
  nombreClave: string;
  /** Texto decimal de 4 decimales, en la unidad base del producto (en peso variable es solo el aproximado). */
  cantidad: string;
  dePesoVariable: boolean;
  activa: boolean;
  version: number;
}>;

export type AltaDePresentacion = Readonly<{
  productoId: string;
  nombre: string;
  nombreClave: string;
  cantidad: string;
  dePesoVariable: boolean;
}>;

/** Las presentaciones de compra de un producto (E9 §3.2): la cantidad nunca cambia («otra cantidad es otra presentación»); se renombran y se apagan. */
export interface RepositorioDePresentaciones {
  obtener(empresa: EmpresaId, id: string): Promise<PresentacionGuardada | null>;
  bloquear(empresa: EmpresaId, id: string): Promise<PresentacionGuardada | null>;
  porNombre(
    empresa: EmpresaId,
    productoId: string,
    nombreClave: string,
  ): Promise<PresentacionGuardada | null>;
  /** Las del producto, por nombre; las apagadas solo si se piden. */
  delProducto(
    empresa: EmpresaId,
    productoId: string,
    incluirApagadas: boolean,
  ): Promise<readonly PresentacionGuardada[]>;
  insertar(empresa: EmpresaId, alta: AltaDePresentacion): Promise<PresentacionGuardada>;
  /** `null` si la versión ya no es la esperada. */
  actualizar(
    empresa: EmpresaId,
    id: string,
    versionEsperada: number,
    cambios: Readonly<{ nombre: string; nombreClave: string; activa: boolean }>,
  ): Promise<PresentacionGuardada | null>;
}

const COLUMNAS = [
  "id",
  "producto_id",
  "nombre",
  "nombre_clave",
  "cantidad",
  "de_peso_variable",
  "activa",
  "version",
] as const;

type Fila = {
  id: string;
  producto_id: string;
  nombre: string;
  nombre_clave: string;
  cantidad: string;
  de_peso_variable: boolean;
  activa: boolean;
  version: number;
};

const aPresentacion = (f: Fila): PresentacionGuardada => ({
  id: f.id,
  productoId: f.producto_id,
  nombre: f.nombre,
  nombreClave: f.nombre_clave,
  cantidad: f.cantidad,
  dePesoVariable: f.de_peso_variable,
  activa: f.activa,
  version: f.version,
});

export function crearRepositorioDePresentaciones(
  db: Kysely<ComprasDb>,
): RepositorioDePresentaciones {
  async function leer(empresa: EmpresaId, id: string, bloquear: boolean) {
    if (!esUuid(id)) return null;
    let consulta = db
      .selectFrom("presentacion_de_producto")
      .select(COLUMNAS)
      .where("empresa_id", "=", empresa)
      .where("id", "=", id);
    if (bloquear) consulta = consulta.forUpdate();
    const fila = await consulta.executeTakeFirst();
    return fila === undefined ? null : aPresentacion(fila);
  }
  return {
    obtener: (empresa, id) => leer(empresa, id, false),
    bloquear: (empresa, id) => leer(empresa, id, true),
    async porNombre(empresa, productoId, nombreClave) {
      if (!esUuid(productoId)) return null;
      const fila = await db
        .selectFrom("presentacion_de_producto")
        .select(COLUMNAS)
        .where("empresa_id", "=", empresa)
        .where("producto_id", "=", productoId)
        .where("nombre_clave", "=", nombreClave)
        .executeTakeFirst();
      return fila === undefined ? null : aPresentacion(fila);
    },
    async delProducto(empresa, productoId, incluirApagadas) {
      if (!esUuid(productoId)) return [];
      let consulta = db
        .selectFrom("presentacion_de_producto")
        .select(COLUMNAS)
        .where("empresa_id", "=", empresa)
        .where("producto_id", "=", productoId);
      if (!incluirApagadas) consulta = consulta.where("activa", "=", true);
      const filas = await consulta.orderBy("nombre_clave").orderBy("id").execute();
      return filas.map(aPresentacion);
    },
    async insertar(empresa, alta) {
      const fila = await db
        .insertInto("presentacion_de_producto")
        .values({
          empresa_id: empresa,
          producto_id: alta.productoId,
          nombre: alta.nombre,
          nombre_clave: alta.nombreClave,
          cantidad: alta.cantidad,
          de_peso_variable: alta.dePesoVariable,
        })
        .returning(COLUMNAS)
        .executeTakeFirstOrThrow();
      return aPresentacion(fila);
    },
    async actualizar(empresa, id, versionEsperada, cambios) {
      const fila = await db
        .updateTable("presentacion_de_producto")
        .set({ nombre: cambios.nombre, nombre_clave: cambios.nombreClave, activa: cambios.activa })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("version", "=", versionEsperada)
        .returning(COLUMNAS)
        .executeTakeFirst();
      return fila === undefined ? null : aPresentacion(fila);
    },
  };
}
