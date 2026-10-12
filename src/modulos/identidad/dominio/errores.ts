import type { EmpresaNoOpera } from "../../../contexto/estados";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";

/**
 * Errores previstos del módulo de identidad (ADR-004). Son textos con el código, salvo
 * `EMPRESA_NO_OPERA` (definido en `contexto/estados`), que además informa cuál empresa no opera y
 * por qué. Los rechazos de permisos (`SIN_PERMISO` y los demás motivos del guard) no son del
 * dominio: los devuelve el guard y se suman al error de cada caso de uso.
 */

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
  | "YA_ES_MIEMBRO";

/**
 * Revocación de una invitación de usuario desde la empresa (H6): no existe (o no la ve esta
 * empresa), ya la aceptaron, o es el alta del gerente, que la revoca la plataforma y no la empresa.
 */
export type ErrorDeRevocacion =
  "INVITACION_NO_ENCONTRADA" | "INVITACION_ACEPTADA" | "REVOCACION_NO_PERMITIDA";

/**
 * Invitar con sucursales (H6, D12): una sucursal desactivada no se asigna a quien se invita.
 */
export type ErrorDeSucursalesDeInvitacion = "SUCURSAL_INACTIVA";

/**
 * Reenvío de la invitación del alta del gerente (plataforma, H5): la empresa ya no está en alta
 * (`ALTA_NO_PENDIENTE`, el mismo código que usa la aceptación), el email nuevo es de un administrador
 * de plataforma (que no puede ser gerente) y los errores al armar la invitación nueva.
 */
export type ErrorDeReenvioDeAlta =
  "ALTA_NO_PENDIENTE" | "EMAIL_DE_ADMIN_PLATAFORMA" | ErrorDeInvitacion;

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
export type ErrorDeMembresia = "MEMBRESIA_NO_ENCONTRADA" | "ES_EL_GERENTE" | "ULTIMO_ADMIN";
