import type { ContextoOperativo } from "../../../contexto/contexto";
import { importeAJson, type ImporteJson } from "../../../primitivas/dinero/importe";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { ClaseDeMovimiento } from "../estados";
import type { MedioYCuentaConNombre } from "../persistencia/base-de-la-jornada";
import { exigirPermisoDeConsulta } from "./comun";
import type { DependenciasDeConsultasDeCaja } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";
import {
  jornadaParaMirar,
  type EntradaDeJornadaDeCaja,
  type ErrorDeConsultaDeJornada,
} from "./jornada-comun";

export type EntradaDeMovimientosManualesDeLaJornada = EntradaDeJornadaDeCaja;

/** Tope de movimientos por pedido: una jornada tiene unos pocos ingresos, egresos, ajustes y anulaciones; si hubiera más, `hayMas`. */
export const MAXIMO_DE_MOVIMIENTOS_MANUALES_POR_PEDIDO = 500;

export type MovimientoManualVisto = MedioYCuentaConNombre &
  Readonly<{
    id: string;
    sesionId: string;
    clase: ClaseDeMovimiento;
    /** Con signo: entra > 0, sale < 0. */
    importe: ImporteJson;
    motivo: string | null;
    /** La anulación lleva el id del movimiento que anula. */
    anulaA: string | null;
    /** `YYYY-MM-DD`: el ajuste que explica una jornada ya cerrada (e3 §3.11.3). */
    corrigeJornada: string | null;
    registradoEn: string;
    registradoPor: string;
  }>;

export type MovimientosManualesDeLaJornada = Readonly<{
  movimientos: readonly MovimientoManualVisto[];
  hayMas: boolean;
}>;

export type ErrorAlVerLosMovimientosManuales = ErrorDeConsultaDeJornada | ErrorDePersistencia;

/**
 * Los ingresos, egresos, ajustes y anulaciones de la jornada (e3b §4.5), con su motivo, quién y `corrigeJornada`: el detalle de
 * `caja.ajustes_a_jornadas_cerradas`. `cajas.ver`, `read committed`, alcance de la sucursal.
 */
export function armarMovimientosManualesDeLaJornada({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeCaja) {
  return async function movimientosManualesDeLaJornada(
    contexto: ContextoOperativo,
    entrada: EntradaDeMovimientosManualesDeLaJornada,
  ): Promise<Resultado<MovimientosManualesDeLaJornada, ErrorAlVerLosMovimientosManuales>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx): Promise<Resultado<MovimientosManualesDeLaJornada, ErrorDeConsultaDeJornada>> => {
        const permiso = await exigirPermisoDeConsulta(
          tx,
          contexto,
          reglas,
          DECLARACIONES_DE_CONSULTAS.movimientosManualesDeLaJornada.accion,
        );
        if (!permiso.ok) return permiso;
        const jornada = await jornadaParaMirar(tx, contexto, entrada);
        if (!jornada.ok) return jornada;
        // Una fila de más: si vuelve, hay más de las que se devuelven.
        const filas = await tx.laJornada.movimientosManuales(
          contexto.empresaId,
          jornada.valor.sucursal,
          jornada.valor.fecha,
          MAXIMO_DE_MOVIMIENTOS_MANUALES_POR_PEDIDO + 1,
        );
        return ok({
          movimientos: filas.slice(0, MAXIMO_DE_MOVIMIENTOS_MANUALES_POR_PEDIDO).map((m) => ({
            ...m,
            importe: importeAJson(m.importe),
            registradoEn: m.registradoEn.toISOString(),
          })),
          hayMas: filas.length > MAXIMO_DE_MOVIMIENTOS_MANUALES_POR_PEDIDO,
        });
      },
    );
  };
}
