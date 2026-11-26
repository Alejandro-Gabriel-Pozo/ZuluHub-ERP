import { armarCambiarCondicionesDeLaCuenta } from "./cambiar-condiciones";
import { armarReactivarCuentaDelCliente, armarSuspenderCuentaDelCliente } from "./cambiar-estado";
import type { DependenciasDeCuentaCorriente } from "./contrato";
import type { DECLARACIONES } from "./declaraciones";
import { armarHabilitarCuentaDelCliente } from "./habilitar";

/**
 * Los casos de uso de la ficha de cuenta corriente, listos para que la composición los ofrezca. El `satisfies` exige que sean EXACTAMENTE los que declara
 * `DECLARACIONES` (qué acción exige cada uno y cómo se repite): uno nuevo sin declarar, o una declaración sin caso de uso, no compila.
 */
export function crearCasosDeUsoDeCuentaCorriente(dependencias: DependenciasDeCuentaCorriente) {
  return {
    habilitarCuentaDelCliente: armarHabilitarCuentaDelCliente(dependencias),
    suspenderCuentaDelCliente: armarSuspenderCuentaDelCliente(dependencias),
    reactivarCuentaDelCliente: armarReactivarCuentaDelCliente(dependencias),
    cambiarCondicionesDeLaCuenta: armarCambiarCondicionesDeLaCuenta(dependencias),
  } satisfies Record<keyof typeof DECLARACIONES, unknown>;
}

export type CasosDeUsoDeCuentaCorriente = ReturnType<typeof crearCasosDeUsoDeCuentaCorriente>;
