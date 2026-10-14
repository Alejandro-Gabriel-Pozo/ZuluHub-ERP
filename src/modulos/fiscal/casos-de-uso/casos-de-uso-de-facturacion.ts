import type { DependenciasDeFacturacion } from "./contrato-de-facturacion";
import type { DECLARACIONES_DE_FACTURACION } from "./declaraciones-de-facturacion";
import { armarDescartarComprobante, armarReintentarComprobante } from "./descartar-y-reintentar";
import {
  armarEmitirComprobanteManual,
  armarEmitirNotaDeCredito,
  armarEmitirNotaDeDebito,
} from "./emitir-comprobante";
import { armarReconciliarComprobantes } from "./reconciliar-comprobantes";
import {
  armarCambiarAmbienteDePuntoDeVenta,
  armarResincronizarSerie,
} from "./resincronizar-y-ambiente";
import { armarValidarComprobante } from "./validar-comprobante";

/**
 * Los casos de uso de facturación (H7 facturación, F5), listos para que la composición los ofrezca. El
 * `satisfies` exige que sean EXACTAMENTE los que declara `DECLARACIONES_DE_FACTURACION`: un caso nuevo sin
 * declarar, o una declaración sin caso, no compila. Los dos trabajos (validar y reconciliar) están también como
 * manejadores de la cola (`crearManejadorDeValidarComprobante`, `crearManejadorDeReconciliar`).
 */
export function crearCasosDeUsoDeFacturacion(dependencias: DependenciasDeFacturacion) {
  return {
    emitirComprobanteManual: armarEmitirComprobanteManual(dependencias),
    emitirNotaDeCredito: armarEmitirNotaDeCredito(dependencias),
    emitirNotaDeDebito: armarEmitirNotaDeDebito(dependencias),
    descartarComprobante: armarDescartarComprobante(dependencias),
    reintentarComprobante: armarReintentarComprobante(dependencias),
    resincronizarSerie: armarResincronizarSerie(dependencias),
    cambiarAmbienteDePuntoDeVenta: armarCambiarAmbienteDePuntoDeVenta(dependencias),
    validarComprobante: armarValidarComprobante(dependencias),
    reconciliarComprobantes: armarReconciliarComprobantes(dependencias),
  } satisfies Record<keyof typeof DECLARACIONES_DE_FACTURACION, unknown>;
}

export type CasosDeUsoDeFacturacion = ReturnType<typeof crearCasosDeUsoDeFacturacion>;
