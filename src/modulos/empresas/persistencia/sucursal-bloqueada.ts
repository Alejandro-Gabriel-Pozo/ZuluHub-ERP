import type { Kysely } from "kysely";
import type { EmpresaId, SucursalId } from "../../../primitivas/identificadores/marca";
import { FORMA_DE_UUID, type EmpresasDb } from "./repositorios";

/**
 * La lectura de una sucursal con `FOR SHARE`, para quien decide algo que depende de que SIGA abierta (hoy: dar de alta un punto de
 * venta, módulo fiscal). Vive aparte de `RepositorioDeSucursales` (que ya pasó el tope de líneas de un archivo) y se arma sobre la
 * misma conexión de la transacción.
 *
 * Por qué hace falta: la clave foránea del punto de venta toma `FOR KEY SHARE` sobre la sucursal y el cierre (0005) es un `UPDATE` de
 * `activa` (`FOR NO KEY UPDATE`): no se esperan, y bajo serializable un alta que leyó la sucursal abierta puede confirmar DESPUÉS de que
 * su cierre confirmó. `FOR SHARE` choca con el `UPDATE`: el cierre concurrente espera a que esta transacción termine, o esta lee la
 * sucursal ya cerrada (la serializable repite). Mismo patrón que la emisión (`comprobante_validar_alta`, 0017).
 * Sin ciclos de espera: el cierre toma su bloqueo consultivo, la fila que cierra y `FOR SHARE` de las OTRAS sucursales activas de la
 * empresa, nunca algo que quien lee espere. El rol de la aplicación ya tiene `SELECT` y `UPDATE (nombre, activa)` sobre `sucursal`, que
 * es lo que `FOR SHARE` exige (0017, A2).
 * Previene: un punto de venta nuevo en una sucursal que se cerró a la vez. Chequeo: los dos órdenes de la carrera en
 * `test/integracion/fiscal-configuracion-concurrencia.test.ts`.
 */
export interface LecturaDeSucursalBloqueada {
  /** `null` si no existe o es de otra empresa (la RLS oculta las ajenas, igual que `obtener`). Solo dentro de una transacción. */
  obtenerBloqueandoElCierre(
    empresa: EmpresaId,
    id: SucursalId,
  ): Promise<Readonly<{ activa: boolean }> | null>;
}

export function crearLecturaDeSucursalBloqueada(
  db: Kysely<EmpresasDb>,
): LecturaDeSucursalBloqueada {
  return {
    async obtenerBloqueandoElCierre(empresa, id) {
      // Un texto que no es un UUID no puede ser el id de ninguna sucursal: la base lo rechazaría con un error de formato.
      if (!FORMA_DE_UUID.test(id)) return null;
      const fila = await db
        .selectFrom("sucursal")
        .select("activa")
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .forShare()
        .executeTakeFirst();
      return fila === undefined ? null : { activa: fila.activa };
    },
  };
}
