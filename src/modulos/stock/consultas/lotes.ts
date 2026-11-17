import type { ContextoOperativo } from "../../../contexto/contexto";
import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import { sucursalId as aSucursalId } from "../../../primitivas/identificadores/marca";
import {
  lotesDelArticulo,
  lotesQueVencen,
  trazabilidadDe,
  type LoteQueVence,
  type LotesDeUnArticulo,
  type TrazabilidadDeLote,
} from "../casos-de-uso/lectura-de-lotes";
import { esUuid } from "../persistencia/filas";
import { type Lector, type RDeConsulta } from "./comun";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

export type {
  LoteDeLista,
  LoteQueVence,
  LotesDeUnArticulo,
  TrazabilidadDeLote,
} from "../casos-de-uso/lectura-de-lotes";

/** El horizonte máximo de «vence en N días»: un año de jornadas (más allá no es una alerta). */
export const MAXIMO_DE_DIAS_POR_VENCER = 365;

/**
 * Las consultas de lotes (E6 §3.5): los lotes de un artículo con su vencimiento, calidad, existencia y DISPONIBLE (orden: el «sin asignar» al
 * final, vence antes primero), lo que vence o venció con existencia y la trazabilidad de un lote. Guard `lotes.ver` (los tres roles); el
 * operador solo ve los depósitos de sus sucursales. El importe que «se pierde» de lo vencido viaja solo con `costos.ver`. Un id mal formado,
 * ajeno o inexistente da `null`/lista vacía (indistinguibles: la RLS). Las cuentas están en `casos-de-uso/lectura-de-lotes.ts` (ADR-005).
 */
export function armarConsultasDeLotes(leer: Lector, reglas: ReglasDeEmpresa) {
  return {
    lotesDeArticulo: (
      contexto: ContextoOperativo,
      entrada: Readonly<{ articuloId: string; depositoId?: string | undefined }>,
    ): Promise<RDeConsulta<LotesDeUnArticulo | null>> =>
      leer(contexto, DECLARACIONES_DE_CONSULTAS.lotesDeArticulo.accion, async (tx, alcance) => {
        if (
          typeof entrada.articuloId !== "string" ||
          !esUuid(entrada.articuloId) ||
          (entrada.depositoId !== undefined &&
            (typeof entrada.depositoId !== "string" || !esUuid(entrada.depositoId)))
        ) {
          return null;
        }
        const articulo = (
          await tx.articulosDeStock.porIds(contexto.empresaId, [entrada.articuloId.toLowerCase()])
        )[0];
        if (articulo === undefined) return null;
        return lotesDelArticulo(
          tx,
          contexto,
          alcance,
          articulo.id,
          entrada.depositoId?.toLowerCase(),
        );
      }),

    vencimientosProximos: (
      contexto: ContextoOperativo,
      entrada: Readonly<{ dias: number; sucursalId?: string | undefined }>,
    ): Promise<RDeConsulta<readonly LoteQueVence[]>> =>
      leer(
        contexto,
        DECLARACIONES_DE_CONSULTAS.vencimientosProximos.accion,
        async (tx, alcance) => {
          if (
            typeof entrada.dias !== "number" ||
            !Number.isInteger(entrada.dias) ||
            entrada.dias < 0 ||
            entrada.dias > MAXIMO_DE_DIAS_POR_VENCER ||
            (entrada.sucursalId !== undefined &&
              (typeof entrada.sucursalId !== "string" || !esUuid(entrada.sucursalId)))
          ) {
            return [];
          }
          const conCostos = (
            await exigirAccion(reglas, "costos.ver", () => tx.autorizacion.delActor(contexto))
          ).ok;
          return lotesQueVencen(tx, contexto, alcance, {
            sucursalId:
              entrada.sucursalId === undefined
                ? undefined
                : aSucursalId(entrada.sucursalId.toLowerCase()),
            dias: entrada.dias,
            conCostos,
          });
        },
      ),

    trazabilidadDeLote: (
      contexto: ContextoOperativo,
      entrada: Readonly<{ loteId: string }>,
    ): Promise<RDeConsulta<TrazabilidadDeLote | null>> =>
      leer(contexto, DECLARACIONES_DE_CONSULTAS.trazabilidadDeLote.accion, async (tx, alcance) => {
        if (typeof entrada.loteId !== "string" || !esUuid(entrada.loteId)) return null;
        return trazabilidadDe(tx, contexto, alcance, entrada.loteId.toLowerCase());
      }),
  };
}
