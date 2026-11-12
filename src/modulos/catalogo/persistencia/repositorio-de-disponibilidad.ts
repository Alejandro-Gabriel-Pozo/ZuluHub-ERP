import type { Kysely } from "kysely";
import type { EmpresaId, PersonaId, SucursalId } from "../../../primitivas/identificadores/marca";
import type { Disponibilidad } from "../dominio/carta-publica";
import type { CatalogoDb } from "./esquema";
import { aDisponibilidad } from "./filas-de-carta";
import { FORMA_DE_UUID } from "./filas";

const esUuid = (texto: string): boolean => FORMA_DE_UUID.test(texto);

export type FijarDisponibilidad = Readonly<{
  productoId: string;
  /** `null` = toda la empresa. */
  sucursalId: SucursalId | null;
  oculto: boolean;
  actualizadoPor: PersonaId | null;
  /** El instante lo pone quien llama (el reloj de la composición), no `now()` de la base. */
  actualizadoEn: Date;
}>;

/**
 * El botón «Ocultar» (carta real §3.2b): una fila por (producto, alcance); sin fila = visible. Todo filtra por empresa y corre en la transacción de quien
 * llama (que es quien autoriza, mira la existencia de stock y audita). La regla de lectura («oculto en el local S si la empresa o S lo ocultan») vive una
 * vez, en `ocultoPor` del dominio: acá solo se leen las filas que la alimentan.
 */
export interface RepositorioDeDisponibilidad {
  /** La fila de ese alcance (`sucursal` nula = la de la empresa), o `null` si nunca se tocó. */
  obtener(
    empresa: EmpresaId,
    productoId: string,
    sucursal: string | null,
  ): Promise<Disponibilidad | null>;
  /** Como `obtener`, tomando la fila (`FOR UPDATE`). Si no existe no hay nada que tomar: la carrera con otro alta la resuelve `fijar`. */
  bloquear(
    empresa: EmpresaId,
    productoId: string,
    sucursal: string | null,
  ): Promise<Disponibilidad | null>;
  /** Todas las filas del producto (empresa y locales): para la pantalla de «Oculto» y su historia. */
  delProducto(empresa: EmpresaId, productoId: string): Promise<readonly Disponibilidad[]>;
  /** Solo las que cuentan en el local: la de la empresa y la de ese local (nunca las de otros). Se las pasa a `ocultoPor`. */
  queAlcanzanAlLocal(
    empresa: EmpresaId,
    productoId: string,
    sucursal: string,
  ): Promise<readonly Disponibilidad[]>;
  /**
   * Fija el ESTADO (no alterna) del alcance: crea la fila o pisa la que haya. Repetir lo mismo deja el mismo estado. Dos personas a la vez no pueden dejar dos
   * filas: la base tiene una única por (empresa, producto, alcance). Es `INSERT … ON CONFLICT DO NOTHING` y, si ya había fila, un `UPDATE` en la misma
   * transacción (no `DO UPDATE`: la regla de lint del repositorio prohíbe el upsert que pisa en silencio; acá pisar es lo pedido, y quien llama ya tomó el
   * producto y comparó el estado vigente).
   */
  fijar(empresa: EmpresaId, cambio: FijarDisponibilidad): Promise<Disponibilidad>;
}

export function crearRepositorioDeDisponibilidad(
  db: Kysely<CatalogoDb>,
): RepositorioDeDisponibilidad {
  async function leer(
    empresa: EmpresaId,
    productoId: string,
    sucursal: string | null,
    bloquear: boolean,
  ) {
    if (!esUuid(productoId) || (sucursal !== null && !esUuid(sucursal))) return null;
    let consulta = db
      .selectFrom("disponibilidad_de_producto")
      .selectAll()
      .where("empresa_id", "=", empresa)
      .where("producto_id", "=", productoId);
    consulta =
      sucursal === null
        ? consulta.where("sucursal_id", "is", null)
        : consulta.where("sucursal_id", "=", sucursal);
    if (bloquear) consulta = consulta.forUpdate();
    const fila = await consulta.executeTakeFirst();
    return fila === undefined ? null : aDisponibilidad(fila);
  }
  return {
    obtener: (empresa, productoId, sucursal) => leer(empresa, productoId, sucursal, false),
    bloquear: (empresa, productoId, sucursal) => leer(empresa, productoId, sucursal, true),
    async delProducto(empresa, productoId) {
      if (!esUuid(productoId)) return [];
      const filas = await db
        .selectFrom("disponibilidad_de_producto")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("producto_id", "=", productoId)
        .orderBy("sucursal_id", "asc")
        .execute();
      return filas.map(aDisponibilidad);
    },
    async queAlcanzanAlLocal(empresa, productoId, sucursal) {
      if (!esUuid(productoId) || !esUuid(sucursal)) return [];
      const filas = await db
        .selectFrom("disponibilidad_de_producto")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("producto_id", "=", productoId)
        .where((eb) => eb.or([eb("sucursal_id", "is", null), eb("sucursal_id", "=", sucursal)]))
        .orderBy("sucursal_id", "asc")
        .execute();
      return filas.map(aDisponibilidad);
    },
    async fijar(empresa, cambio) {
      const valores = {
        oculto: cambio.oculto,
        actualizado_por: cambio.actualizadoPor,
        actualizado_en: cambio.actualizadoEn,
      };
      const insertada = await db
        .insertInto("disponibilidad_de_producto")
        .values({
          empresa_id: empresa,
          producto_id: cambio.productoId,
          sucursal_id: cambio.sucursalId,
          ...valores,
        })
        .onConflict((oc) => oc.doNothing())
        .returningAll()
        .executeTakeFirst();
      if (insertada !== undefined) return aDisponibilidad(insertada);
      let cambiar = db
        .updateTable("disponibilidad_de_producto")
        .set(valores)
        .where("empresa_id", "=", empresa)
        .where("producto_id", "=", cambio.productoId);
      cambiar =
        cambio.sucursalId === null
          ? cambiar.where("sucursal_id", "is", null)
          : cambiar.where("sucursal_id", "=", cambio.sucursalId);
      return aDisponibilidad(await cambiar.returningAll().executeTakeFirstOrThrow());
    },
  };
}
