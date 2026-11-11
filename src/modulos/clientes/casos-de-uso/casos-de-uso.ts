import type { DependenciasDeClientes } from "./contrato";
import type { DECLARACIONES } from "./declaraciones";
import {
  armarCrearParte,
  armarDesactivarParte,
  armarEditarParte,
  armarReactivarParte,
} from "./partes";
import {
  armarCambiarRolesDeParte,
  armarDesvincularContacto,
  armarVincularContacto,
} from "./roles-y-vinculos";

/**
 * Los casos de uso del directorio, listos para que la composición los ofrezca. El `satisfies` exige que sean EXACTAMENTE los que declara
 * `DECLARACIONES` (qué acción exige cada uno y cómo se repite): uno nuevo sin declarar, o una declaración sin caso de uso, no compila.
 */
export function crearCasosDeUsoDeClientes(dependencias: DependenciasDeClientes) {
  return {
    crearParte: armarCrearParte(dependencias),
    editarParte: armarEditarParte(dependencias),
    desactivarParte: armarDesactivarParte(dependencias),
    reactivarParte: armarReactivarParte(dependencias),
    cambiarRolesDeParte: armarCambiarRolesDeParte(dependencias),
    vincularContacto: armarVincularContacto(dependencias),
    desvincularContacto: armarDesvincularContacto(dependencias),
  } satisfies Record<keyof typeof DECLARACIONES, unknown>;
}

export type CasosDeUsoDeClientes = ReturnType<typeof crearCasosDeUsoDeClientes>;
