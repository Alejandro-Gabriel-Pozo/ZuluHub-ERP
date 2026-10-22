import {
  armarActivarPuntoDeVenta,
  armarDesactivarPuntoDeVenta,
} from "./activar-y-desactivar-punto-de-venta";
import { armarConfirmarDatosFiscales } from "./confirmar-datos-fiscales";
import { armarConfirmarReglaDeEmisor } from "./confirmar-regla-de-emisor";
import type { DependenciasDeConfiguracionFiscal } from "./contrato-de-configuracion";
import { armarCrearPuntoDeVenta, armarEditarPuntoDeVenta } from "./crear-y-editar-punto-de-venta";
import type { DECLARACIONES_DE_CONFIGURACION } from "./declaraciones-de-configuracion";
import { armarGuardarBorradorDeDatosFiscales } from "./guardar-borrador-de-datos-fiscales";

/**
 * Los casos de uso de configuración fiscal del gerente (H7, T5), listos para que la composición los ofrezca. El
 * `satisfies` exige que sean EXACTAMENTE los que declara `DECLARACIONES_DE_CONFIGURACION` (qué acción exige cada
 * uno): un caso de uso nuevo sin declarar, o una declaración sin caso de uso, no compila.
 */
export function crearCasosDeUsoDeConfiguracionFiscal(
  dependencias: DependenciasDeConfiguracionFiscal,
) {
  return {
    guardarBorradorDeDatosFiscales: armarGuardarBorradorDeDatosFiscales(dependencias),
    confirmarDatosFiscales: armarConfirmarDatosFiscales(dependencias),
    crearPuntoDeVenta: armarCrearPuntoDeVenta(dependencias),
    editarPuntoDeVenta: armarEditarPuntoDeVenta(dependencias),
    activarPuntoDeVenta: armarActivarPuntoDeVenta(dependencias),
    desactivarPuntoDeVenta: armarDesactivarPuntoDeVenta(dependencias),
    confirmarReglaDeEmisor: armarConfirmarReglaDeEmisor(dependencias),
  } satisfies Record<keyof typeof DECLARACIONES_DE_CONFIGURACION, unknown>;
}

export type CasosDeUsoDeConfiguracionFiscal = ReturnType<
  typeof crearCasosDeUsoDeConfiguracionFiscal
>;
