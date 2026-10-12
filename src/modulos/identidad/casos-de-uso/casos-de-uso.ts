import { crearAceptarInvitacion } from "./aceptar-invitacion";
import { crearApagarMembresia } from "./apagar-membresia";
import type { DependenciasDeIdentidad } from "./contrato";
import type { DECLARACIONES } from "./declaraciones";
import { crearInvitarUsuario } from "./invitar-usuario";
import { crearReenviarInvitacion } from "./reenviar-invitacion";

/**
 * Los cuatro casos de uso de identidad (H3), listos para que la composición los ofrezca. El
 * `satisfies` exige que sean EXACTAMENTE los que declara `DECLARACIONES` (qué acción exige cada
 * uno): un caso de uso nuevo sin declarar, o una declaración sin caso de uso, no compila.
 */
export function crearCasosDeUsoDeIdentidad(dependencias: DependenciasDeIdentidad) {
  return {
    aceptarInvitacion: crearAceptarInvitacion(dependencias),
    invitarUsuario: crearInvitarUsuario(dependencias),
    apagarMembresia: crearApagarMembresia(dependencias),
    reenviarInvitacion: crearReenviarInvitacion(dependencias),
  } satisfies Record<keyof typeof DECLARACIONES, unknown>;
}

export type CasosDeUsoDeIdentidad = ReturnType<typeof crearCasosDeUsoDeIdentidad>;
