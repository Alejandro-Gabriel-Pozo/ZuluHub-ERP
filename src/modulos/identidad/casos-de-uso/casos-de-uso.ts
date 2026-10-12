import { crearAceptarInvitacion } from "./aceptar-invitacion";
import { crearAceptarTraspaso } from "./aceptar-traspaso";
import { crearApagarMembresia } from "./apagar-membresia";
import { crearAsignarSucursales } from "./asignar-sucursales";
import { crearCancelarTraspaso } from "./cancelar-traspaso";
import type { DependenciasDeIdentidad } from "./contrato";
import type { DECLARACIONES } from "./declaraciones";
import { crearInvitarUsuario } from "./invitar-usuario";
import { crearProponerTraspaso } from "./proponer-traspaso";
import { crearRechazarTraspaso } from "./rechazar-traspaso";
import { crearReenviarInvitacion } from "./reenviar-invitacion";
import { crearRevocarInvitacion } from "./revocar-invitacion";

/**
 * Los casos de uso de identidad (H3 y H6), listos para que la composición los ofrezca. El
 * `satisfies` exige que sean EXACTAMENTE los que declara `DECLARACIONES` (qué acción exige cada
 * uno): un caso de uso nuevo sin declarar, o una declaración sin caso de uso, no compila.
 */
export function crearCasosDeUsoDeIdentidad(dependencias: DependenciasDeIdentidad) {
  return {
    aceptarInvitacion: crearAceptarInvitacion(dependencias),
    invitarUsuario: crearInvitarUsuario(dependencias),
    apagarMembresia: crearApagarMembresia(dependencias),
    reenviarInvitacion: crearReenviarInvitacion(dependencias),
    // H6: administración de usuarios (T3a, T3b) y traspaso de gerencia (T4).
    revocarInvitacion: crearRevocarInvitacion(dependencias),
    asignarSucursales: crearAsignarSucursales(dependencias),
    proponerTraspaso: crearProponerTraspaso(dependencias),
    cancelarTraspaso: crearCancelarTraspaso(dependencias),
    aceptarTraspaso: crearAceptarTraspaso(dependencias),
    rechazarTraspaso: crearRechazarTraspaso(dependencias),
  } satisfies Record<keyof typeof DECLARACIONES, unknown>;
}

export type CasosDeUsoDeIdentidad = ReturnType<typeof crearCasosDeUsoDeIdentidad>;
