import type { Kysely } from "kysely";
import {
  esNivelDeControl,
  resolverNivel,
  type NivelDeControl,
} from "../../capacidades/controles/nivel";
import type { NivelesDeControl } from "../../capacidades/controles/niveles";

/**
 * Puerto `NivelesDeControl` sobre `nivel_de_control` (0007). Lee con la MISMA conexión de la
 * transacción del llamador y sin caché; la RLS limita a la empresa del contexto y el filtro por
 * empresa se repite a propósito (defensa en profundidad). Solo LEE: el nivel lo fija el gerente con
 * `controles.configurar`, que construye otro tramo (necesita los derechos de uso del plan).
 *
 * Una fila con `sucursal_id` nulo es el nivel de la empresa; la de la sucursal pedida, su endurecimiento.
 * La decisión de cuál rige es de `resolverNivel` (pura); acá solo se trae lo guardado.
 */
export type NivelesDeControlDb = {
  nivel_de_control: {
    empresa_id: string;
    sucursal_id: string | null;
    control: string;
    nivel: string;
  };
};

export function crearNivelesDeControlDePostgres<C extends string>(
  db: Kysely<NivelesDeControlDb>,
): NivelesDeControl<C> {
  return {
    async nivel(control, alcance, disponibleEnElPlan): Promise<NivelDeControl> {
      // Sin el control en el plan no hay nada que consultar: rige PERMITIR.
      if (!disponibleEnElPlan) {
        return resolverNivel({
          disponibleEnElPlan,
          nivelDeLaEmpresa: null,
          nivelDeLaSucursal: null,
        });
      }
      const filas = await db
        .selectFrom("nivel_de_control")
        .select(["sucursal_id", "nivel"])
        .where("empresa_id", "=", alcance.empresaId)
        .where("control", "=", control)
        .where((eb) =>
          alcance.sucursalId === null
            ? eb("sucursal_id", "is", null)
            : eb.or([eb("sucursal_id", "is", null), eb("sucursal_id", "=", alcance.sucursalId)]),
        )
        .execute();
      const guardado = (deLaSucursal: boolean): NivelDeControl | null => {
        const fila = filas.find((f) => (f.sucursal_id !== null) === deLaSucursal);
        if (fila === undefined) return null;
        // Un valor que el CHECK de la base no deja pasar: si llega otro, algo se rompió.
        if (!esNivelDeControl(fila.nivel)) {
          throw new RangeError(`nivel de control desconocido en la base: ${fila.nivel}`);
        }
        return fila.nivel;
      };
      return resolverNivel({
        disponibleEnElPlan,
        nivelDeLaEmpresa: guardado(false),
        nivelDeLaSucursal: guardado(true),
      });
    },
  };
}
