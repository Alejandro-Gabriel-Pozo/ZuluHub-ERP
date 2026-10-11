import type { EstadoEfectivo } from "../../../contexto/estados";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";

/**
 * Errores previstos del módulo de identidad (ADR-004). Son textos con el código, salvo
 * `EMPRESA_NO_OPERA`, que además informa cuál empresa no opera y por qué (unión discriminada
 * por `codigo`).
 */

/** Falla de `EMPRESA_NO_OPERA`: la primera empresa de la invitación que no opera, y el motivo. */
export type EmpresaNoOpera = Readonly<{
  codigo: "EMPRESA_NO_OPERA";
  empresaId: EmpresaId;
  motivo: Exclude<EstadoEfectivo, "OPERA">;
}>;

/** Creación, reenvío y consulta de invitaciones. */
export type ErrorDeInvitacion =
  | "INVITACION_NO_ENCONTRADA"
  | "INVITACION_REVOCADA"
  | "INVITACION_NO_PENDIENTE"
  | "EMAIL_INVALIDO"
  | "ROL_NO_INVITABLE"
  | "INVITACION_SIN_EMPRESAS"
  | "EMPRESA_REPETIDA"
  // El alta del primer gerente exige exactamente una empresa con rol GERENTE. La especificación
  // no nombraba el error de esta regla; se agrega este código.
  | "ALTA_INVALIDA"
  // Solo se reenvían las invitaciones de usuario; el reenvío del alta es de plataforma (H5).
  | "REENVIO_NO_PERMITIDO"
  | "ALTA_YA_TIENE_INVITACION"
  | "SIN_PERMISO";

/** Aceptación de una invitación. */
export type ErrorDeAceptacion =
  | "INVITACION_NO_ENCONTRADA"
  | "ALTA_NO_PENDIENTE"
  | "INVITACION_REVOCADA"
  | "INVITACION_NO_PENDIENTE"
  | "INVITACION_VENCIDA"
  | "INVITACION_DE_OTRO_EMAIL"
  | "PERSONA_SUSPENDIDA"
  | "YA_ES_MIEMBRO"
  | EmpresaNoOpera;

/** Apagado de una membresía. */
export type ErrorDeMembresia =
  "MEMBRESIA_NO_ENCONTRADA" | "ES_EL_GERENTE" | "ULTIMO_ADMIN" | "SIN_PERMISO";
