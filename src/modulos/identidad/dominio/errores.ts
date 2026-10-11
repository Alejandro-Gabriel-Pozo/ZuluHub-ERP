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

/**
 * Falla de `ROL_DISTINTO_AL_ANTERIOR`: la persona ya tuvo una membresía (apagada) en esa empresa con
 * otro rol. Reactivarla con un rol distinto no se soporta por ahora (el rol de una membresía no se
 * cambia: ningún rol de base tiene permiso para actualizarlo).
 */
export type RolDistintoAlAnterior = Readonly<{
  codigo: "ROL_DISTINTO_AL_ANTERIOR";
  empresaId: EmpresaId;
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
  // Invitar a quien ya es miembro activo de la empresa.
  | "YA_ES_MIEMBRO"
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
  | EmpresaNoOpera
  | RolDistintoAlAnterior;

/** Apagado de una membresía. */
export type ErrorDeMembresia =
  "MEMBRESIA_NO_ENCONTRADA" | "ES_EL_GERENTE" | "ULTIMO_ADMIN" | "SIN_PERMISO";
