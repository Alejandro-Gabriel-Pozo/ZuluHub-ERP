import {
  listarDevolucionesDentro,
  obtenerDevolucionDentro,
  type DevolucionDeDetalle,
  type DevolucionDeLista,
  type EntradaDeListarDevoluciones,
  type PaginaDeDevoluciones,
} from "../casos-de-uso/lectura-devoluciones";
import { esUuid } from "../persistencia/filas";
import { err } from "../../../primitivas/resultado/resultado";
import { type Lector, type RDeConsulta } from "./comun";

export type {
  DevolucionDeDetalle,
  DevolucionDeLista,
  EntradaDeListarDevoluciones,
  PaginaDeDevoluciones,
};

export function armarConsultasDeDevoluciones(leer: Lector) {
  return {
    /** Las devoluciones al proveedor con su estado, de la más nueva a la más vieja, paginadas por cursor (guard `devoluciones_a_proveedor.ver`, en el alcance de sucursales de quien pide). */
    listarDevoluciones(
      contexto: Parameters<Lector>[0],
      entrada: EntradaDeListarDevoluciones = {},
    ): Promise<RDeConsulta<PaginaDeDevoluciones>> {
      return leer(contexto, ["devoluciones_a_proveedor.ver"], (tx) =>
        listarDevolucionesDentro(tx, contexto, entrada),
      ).then((r) => (r.ok ? r.valor : r));
    },
    /** El detalle de una devolución con sus líneas (guard `devoluciones_a_proveedor.ver`); `null` si no existe o no es del alcance de quien pide. */
    obtenerDevolucion(
      contexto: Parameters<Lector>[0],
      entrada: Readonly<{ devolucionId: string }>,
    ): Promise<RDeConsulta<DevolucionDeDetalle | null>> {
      if (!esUuid(entrada.devolucionId)) return Promise.resolve(err("IDENTIFICADOR_INVALIDO"));
      return leer(contexto, ["devoluciones_a_proveedor.ver"], (tx) =>
        obtenerDevolucionDentro(tx, contexto, { devolucionId: entrada.devolucionId }),
      );
    },
  };
}
