import type { DependenciasDeSalon } from "./contrato";
import type { DECLARACIONES } from "./declaraciones";
import { armarCambioDeMesa } from "./cambio-de-mesa";
import { armarCobro } from "./cobro";
import { armarEnvios } from "./envios";
import { armarMesas } from "./mesas";
import { armarPedido } from "./pedido";
import { armarUnion } from "./unir";

/**
 * Los casos de uso del salón, listos para que la composición los ofrezca. El `satisfies` exige que sean EXACTAMENTE los que declara `DECLARACIONES`: uno
 * nuevo sin declarar, o una declaración sin caso de uso, no compila.
 */
export function crearCasosDeUsoDeSalon(dependencias: DependenciasDeSalon) {
  return {
    ...armarMesas(dependencias),
    ...armarPedido(dependencias),
    ...armarCambioDeMesa(dependencias),
    ...armarCobro(dependencias),
    ...armarEnvios(dependencias),
    ...armarUnion(dependencias),
  } satisfies Record<keyof typeof DECLARACIONES, unknown>;
}

export type CasosDeUsoDeSalon = ReturnType<typeof crearCasosDeUsoDeSalon>;
