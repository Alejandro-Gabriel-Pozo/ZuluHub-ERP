import type { ClaveAccion } from "../../../capacidades/modulos/catalogo";

/**
 * Cada caso de uso declara QUÉ acción del catálogo exige (cruce X1 de ADR-003), o por qué no pasa por
 * el guard. Un caso de uso sin declaración no compila (`casos-de-uso.ts` exige que las claves de
 * acá sean exactamente los casos de uso); una acción que no existe en el catálogo tampoco.
 */
export type DeclaracionDeCaso = Readonly<{ accion: ClaveAccion }> | Readonly<{ sinGuard: string }>;

export const DECLARACIONES = {
  invitarUsuario: { accion: "usuarios.invitar" },
  reenviarInvitacion: { accion: "usuarios.reenviar_invitacion" },
  apagarMembresia: { accion: "usuarios.apagar" },
  aceptarInvitacion: {
    sinGuard:
      "El invitado todavía no es miembro: autorizan el hash del token (contexto INVITACION), la RLS y el email de la invitación",
  },
} as const satisfies Record<string, DeclaracionDeCaso>;
