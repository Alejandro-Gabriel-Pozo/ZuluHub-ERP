import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { sucursalId as aSucursalId } from "../../../primitivas/identificadores/marca";
import {
  fichaDeLaOrden,
  ordenesDeLaLista,
  type FichaDeOrden,
  type OrdenDeLista,
} from "../casos-de-uso/lectura-de-ordenes";
import { esUuid } from "../dominio/identificadores";
import type { EstadoDeOrden } from "../dominio/orden";
import { type Lector, type RDeConsulta } from "./comun";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

export type {
  FichaDeOrden,
  OrdenDeLista,
  RenglonDeFichaDeOrden,
} from "../casos-de-uso/lectura-de-ordenes";

const ESTADOS: readonly string[] = ["ABIERTA", "CERRADA", "CANCELADA", "ANULADA"];

/**
 * Las consultas de órdenes (E6 §3.5): la lista (de la más nueva a la más vieja, hasta un tope) y la ficha con lo esperado y lo real, la merma de lote,
 * el lote, `recetaCambiada` y, con `costos.ver`, el costo congelado. Guard `transformaciones.ver`; solo ve las órdenes cuyos DOS depósitos están en
 * su alcance. Un id mal formado, ajeno o inexistente da `null`/lista vacía (indistinguibles: la RLS); un filtro mal formado, lista vacía.
 */
export function armarConsultasDeOrdenes(leer: Lector, reglas: ReglasDeEmpresa) {
  return {
    listarOrdenes: (
      contexto: ContextoOperativo,
      entrada: Readonly<{ estado?: string | undefined; sucursalId?: string | undefined }> = {},
    ): Promise<RDeConsulta<readonly OrdenDeLista[]>> =>
      leer(contexto, DECLARACIONES_DE_CONSULTAS.listarOrdenes.accion, async (tx, alcance) => {
        if (
          (entrada.estado !== undefined &&
            (typeof entrada.estado !== "string" || !ESTADOS.includes(entrada.estado))) ||
          (entrada.sucursalId !== undefined &&
            (typeof entrada.sucursalId !== "string" || !esUuid(entrada.sucursalId)))
        ) {
          return [];
        }
        return ordenesDeLaLista(tx, contexto, alcance, {
          estado: entrada.estado as EstadoDeOrden | undefined,
          sucursalId:
            entrada.sucursalId === undefined
              ? undefined
              : aSucursalId(entrada.sucursalId.toLowerCase()),
        });
      }),

    fichaDeOrden: (
      contexto: ContextoOperativo,
      entrada: Readonly<{ ordenId: string }>,
    ): Promise<RDeConsulta<FichaDeOrden | null>> =>
      leer(contexto, DECLARACIONES_DE_CONSULTAS.fichaDeOrden.accion, async (tx, alcance) => {
        if (typeof entrada.ordenId !== "string" || !esUuid(entrada.ordenId)) return null;
        const orden = await tx.ordenesDeProduccion.obtener(
          contexto.empresaId,
          entrada.ordenId.toLowerCase(),
        );
        if (orden === null) return null;
        // Solo la ve quien tiene los dos depósitos en su alcance.
        const visibles = await tx.ordenesDeProduccion.listar(contexto.empresaId, {
          alcance,
          ordenId: orden.id,
          limite: 1,
        });
        if (!visibles.some((o) => o.id === orden.id)) return null;
        const conCostos = (
          await exigirAccion(reglas, "costos.ver", () => tx.autorizacion.delActor(contexto))
        ).ok;
        return fichaDeLaOrden(tx, contexto, orden, conCostos);
      }),
  };
}
