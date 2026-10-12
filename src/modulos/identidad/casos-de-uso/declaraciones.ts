import type { DeclaracionDeCaso } from "../../../capacidades/permisos/declaracion";

export type { DeclaracionDeCaso };

/**
 * Cada caso de uso declara QUÉ acción del catálogo exige (cruce X1 de ADR-003), o por qué no pasa por
 * el guard. Un caso de uso sin declaración no compila (`casos-de-uso.ts` exige que las claves de
 * acá sean exactamente los casos de uso); una acción que no existe en el catálogo tampoco.
 */

export const DECLARACIONES = {
  invitarUsuario: { accion: "usuarios.invitar" },
  reenviarInvitacion: { accion: "usuarios.reenviar_invitacion" },
  apagarMembresia: { accion: "usuarios.apagar" },
  revocarInvitacion: { accion: "usuarios.revocar_invitacion" },
  asignarSucursales: { accion: "usuarios.asignar_sucursales" },
  proponerTraspaso: { accion: "gerencia.proponer_traspaso" },
  cancelarTraspaso: { accion: "gerencia.cancelar_traspaso" },
  aceptarTraspaso: { accion: "gerencia.aceptar_traspaso" },
  rechazarTraspaso: { accion: "gerencia.rechazar_traspaso" },
  aceptarInvitacion: {
    sinGuard:
      "El invitado todavía no es miembro: autorizan el hash del token (contexto INVITACION), la RLS y el email de la invitación",
  },
} as const satisfies Record<string, DeclaracionDeCaso>;
