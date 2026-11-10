import { armarControlarArticulo, armarDejarDeControlar } from "./articulos";
import type { DependenciasDeStock } from "./contrato";
import type { DECLARACIONES } from "./declaraciones";
import {
  armarCrearDeposito,
  armarDesactivarDeposito,
  armarEditarDeposito,
  armarReactivarDeposito,
} from "./depositos";

/**
 * Los casos de uso de stock, listos para que la composición los ofrezca. El `satisfies` exige que sean EXACTAMENTE los que declara
 * `DECLARACIONES` (qué acción exige cada uno y cómo se repite): uno nuevo sin declarar, o una declaración sin caso de uso, no compila.
 */
export function crearCasosDeUsoDeStock(dependencias: DependenciasDeStock) {
  return {
    // depósitos y artículos (E5-T4)
    crearDeposito: armarCrearDeposito(dependencias),
    editarDeposito: armarEditarDeposito(dependencias),
    desactivarDeposito: armarDesactivarDeposito(dependencias),
    reactivarDeposito: armarReactivarDeposito(dependencias),
    controlarArticulo: armarControlarArticulo(dependencias),
    dejarDeControlar: armarDejarDeControlar(dependencias),
  } satisfies Record<keyof typeof DECLARACIONES, unknown>;
}

export type CasosDeUsoDeStock = ReturnType<typeof crearCasosDeUsoDeStock>;
