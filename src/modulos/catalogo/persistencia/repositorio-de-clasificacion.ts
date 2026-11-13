import { sql, type Kysely } from "kysely";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import {
  clasificacionDelProducto,
  type ClasificacionDelProducto,
} from "../dominio/clasificacion-de-producto";
import type { CatalogoDb } from "./esquema";
import { FORMA_DE_UUID } from "./filas";

export type NodoGuardado = Readonly<{
  id: string;
  /** `null` = departamento (primer nivel). */
  padreId: string | null;
  nombre: string;
  nombreClave: string;
  activo: boolean;
  version: number;
}>;

export type AltaDeNodo = Readonly<{
  id: string;
  padreId: string | null;
  nombre: string;
  nombreClave: string;
}>;

/** Una fila de `clasificacion_de_producto`: desde cuándo el producto está en ese nodo (`null` = «Sin elegir»). */
export type VinculoGuardado = Readonly<{
  id: string;
  productoId: string;
  nodoId: string | null;
  vigenteDesde: Date;
}>;

export type AltaDeVinculo = Readonly<{
  id: string;
  productoId: string;
  nodoId: string | null;
  vigenteDesde: Date;
  cargadoPor: string;
}>;

export type CambiosDeNodo = Partial<
  Readonly<{ padreId: string; nombre: string; nombreClave: string; activo: boolean }>
>;

/**
 * El árbol de clasificación comercial de la empresa (0045). Todo filtra por empresa y corre en la transacción de quien llama (que autoriza y audita). Un nodo no se
 * borra: se desactiva. Toda escritura empieza por `bloquearArbol`: el mismo candado que toma el disparador de la base, así dos movimientos a la vez se serializan y
 * cada uno decide leyendo el árbol que dejó el anterior (sin eso, A bajo B y B bajo A, válidos por separado, harían un ciclo).
 */
export interface RepositorioDeClasificacion {
  /** Toma el candado de la transacción sobre el árbol de la empresa (se libera al confirmar o deshacer). */
  bloquearArbol(empresa: EmpresaId): Promise<void>;
  /** TODOS los nodos, activos o no, por nombre: la lista de la pantalla y la foto que usan las reglas. */
  todos(empresa: EmpresaId): Promise<readonly NodoGuardado[]>;
  obtener(empresa: EmpresaId, id: string): Promise<NodoGuardado | null>;
  insertar(empresa: EmpresaId, alta: AltaDeNodo): Promise<NodoGuardado>;
  /** `null` si la versión ya no es la esperada (o el nodo no es de la empresa). */
  cambiar(
    empresa: EmpresaId,
    id: string,
    versionEsperada: number,
    cambios: CambiosDeNodo,
  ): Promise<NodoGuardado | null>;
  /** Un vínculo por su id (la clave de idempotencia del cambio), o `null`. */
  vinculo(empresa: EmpresaId, id: string): Promise<VinculoGuardado | null>;
  /**
   * Lo que rige para el producto en `ahora` y lo programado (regla de `clasificacionDelProducto`, la misma de la vigencia del precio). Lee todos los vínculos del producto y
   * resuelve acá, en la persistencia, para que las consultas no importen el dominio (ADR-005).
   */
  clasificacionDelProducto(
    empresa: EmpresaId,
    productoId: string,
    ahora: Date,
  ): Promise<ClasificacionDelProducto<VinculoGuardado>>;
  /** Agrega un vínculo (solo inserción). */
  insertarVinculo(empresa: EmpresaId, alta: AltaDeVinculo): Promise<VinculoGuardado>;
}

const COLUMNAS = ["id", "padre_id", "nombre", "nombre_clave", "activo", "version"] as const;

type Fila = {
  id: string;
  padre_id: string | null;
  nombre: string;
  nombre_clave: string;
  activo: boolean;
  version: number;
};

const COLUMNAS_DE_VINCULO = ["id", "producto_id", "nodo_id", "vigente_desde"] as const;

const aVinculo = (f: {
  id: string;
  producto_id: string;
  nodo_id: string | null;
  vigente_desde: Date;
}): VinculoGuardado => ({
  id: f.id,
  productoId: f.producto_id,
  nodoId: f.nodo_id,
  vigenteDesde: f.vigente_desde,
});

const aNodo = (f: Fila): NodoGuardado => ({
  id: f.id,
  padreId: f.padre_id,
  nombre: f.nombre,
  nombreClave: f.nombre_clave,
  activo: f.activo,
  version: f.version,
});

export function crearRepositorioDeClasificacion(
  db: Kysely<CatalogoDb>,
): RepositorioDeClasificacion {
  return {
    async bloquearArbol(empresa) {
      // La misma clave que `nodo_de_clasificacion_validar` (0045): `hashtextextended('clasificacion:' || empresa_id, 0)`.
      await sql`select pg_advisory_xact_lock(hashtextextended(${`clasificacion:${empresa}`}, 0))`.execute(
        db,
      );
    },
    async todos(empresa) {
      const filas = await db
        .selectFrom("nodo_de_clasificacion")
        .select(COLUMNAS)
        .where("empresa_id", "=", empresa)
        .orderBy("nombre_clave")
        .orderBy("id")
        .execute();
      return filas.map(aNodo);
    },
    async obtener(empresa, id) {
      if (!FORMA_DE_UUID.test(id)) return null;
      const fila = await db
        .selectFrom("nodo_de_clasificacion")
        .select(COLUMNAS)
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .executeTakeFirst();
      return fila === undefined ? null : aNodo(fila);
    },
    async insertar(empresa, alta) {
      const fila = await db
        .insertInto("nodo_de_clasificacion")
        .values({
          id: alta.id,
          empresa_id: empresa,
          padre_id: alta.padreId,
          nombre: alta.nombre,
          nombre_clave: alta.nombreClave,
        })
        .returning(COLUMNAS)
        .executeTakeFirstOrThrow();
      return aNodo(fila);
    },
    async cambiar(empresa, id, versionEsperada, cambios) {
      if (!FORMA_DE_UUID.test(id)) return null;
      const fila = await db
        .updateTable("nodo_de_clasificacion")
        .set({
          ...(cambios.padreId === undefined ? {} : { padre_id: cambios.padreId }),
          ...(cambios.nombre === undefined ? {} : { nombre: cambios.nombre }),
          ...(cambios.nombreClave === undefined ? {} : { nombre_clave: cambios.nombreClave }),
          ...(cambios.activo === undefined ? {} : { activo: cambios.activo }),
        })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("version", "=", versionEsperada)
        .returning(COLUMNAS)
        .executeTakeFirst();
      return fila === undefined ? null : aNodo(fila);
    },
    async vinculo(empresa, id) {
      if (!FORMA_DE_UUID.test(id)) return null;
      const fila = await db
        .selectFrom("clasificacion_de_producto")
        .select(COLUMNAS_DE_VINCULO)
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .executeTakeFirst();
      return fila === undefined ? null : aVinculo(fila);
    },
    async clasificacionDelProducto(empresa, productoId, ahora) {
      if (!FORMA_DE_UUID.test(productoId)) return { vigente: null, programados: [] };
      const filas = await db
        .selectFrom("clasificacion_de_producto")
        .select(COLUMNAS_DE_VINCULO)
        .where("empresa_id", "=", empresa)
        .where("producto_id", "=", productoId)
        .orderBy("vigente_desde", "desc")
        .execute();
      return clasificacionDelProducto(filas.map(aVinculo), ahora);
    },
    async insertarVinculo(empresa, alta) {
      const fila = await db
        .insertInto("clasificacion_de_producto")
        .values({
          id: alta.id,
          empresa_id: empresa,
          producto_id: alta.productoId,
          nodo_id: alta.nodoId,
          vigente_desde: alta.vigenteDesde,
          cargado_por: alta.cargadoPor,
        })
        .returning(COLUMNAS_DE_VINCULO)
        .executeTakeFirstOrThrow();
      return aVinculo(fila);
    },
  };
}
