import { crearAceptarInvitacion } from "./aceptar-invitacion";
import { crearApagarMembresia } from "./apagar-membresia";
import type { DependenciasDeIdentidad } from "./contrato";
import { crearInvitarUsuario } from "./invitar-usuario";
import { crearReenviarInvitacion } from "./reenviar-invitacion";

/** Los cuatro casos de uso de identidad (H3), listos para que la composición los ofrezca. */
export function crearCasosDeUsoDeIdentidad(dependencias: DependenciasDeIdentidad) {
  return {
    aceptarInvitacion: crearAceptarInvitacion(dependencias),
    invitarUsuario: crearInvitarUsuario(dependencias),
    apagarMembresia: crearApagarMembresia(dependencias),
    reenviarInvitacion: crearReenviarInvitacion(dependencias),
  };
}

export type CasosDeUsoDeIdentidad = ReturnType<typeof crearCasosDeUsoDeIdentidad>;
