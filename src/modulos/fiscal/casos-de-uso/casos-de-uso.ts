import { armarCerrarReservaDeNumero } from "./cerrar-reserva";
import type { DependenciasDeNumeracion } from "./contrato";
import type { DECLARACIONES } from "./declaraciones";
import { armarReconciliarSerie } from "./reconciliar-serie";
import { armarReconciliarSeriesVencidas } from "./reconciliar-series-vencidas";
import { armarReservarNumeroDeComprobante } from "./reservar-numero";

/**
 * Los casos de uso de numeración de comprobantes (H7 T6), listos para que la composición los ofrezca.
 * El `satisfies` exige que sean EXACTAMENTE los que declara `DECLARACIONES` (qué acción exige cada
 * uno): un caso de uso nuevo sin declarar, o una declaración sin caso de uso, no compila.
 */
export function crearCasosDeUsoDeNumeracion(dependencias: DependenciasDeNumeracion) {
  const reservarNumeroDeComprobante = armarReservarNumeroDeComprobante(dependencias);
  const cerrarReservaDeNumero = armarCerrarReservaDeNumero(dependencias);
  const reconciliarSerie = armarReconciliarSerie(dependencias);
  return {
    reservarNumeroDeComprobante,
    cerrarReservaDeNumero,
    reconciliarSerie,
    reconciliarSeriesVencidas: armarReconciliarSeriesVencidas(dependencias, reconciliarSerie),
  } satisfies Record<keyof typeof DECLARACIONES, unknown>;
}

export type CasosDeUsoDeNumeracion = ReturnType<typeof crearCasosDeUsoDeNumeracion>;
