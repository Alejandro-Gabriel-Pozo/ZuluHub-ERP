import type { EmpresaId, PersonaId, TenantId } from "../primitivas/identificadores/marca";

/**
 * Quién actúa y desde qué puerta (diseno-inicial §5). Es una unión discriminada: cada puerta usa su
 * propio rol de base y su propio catálogo de permisos, y no se mezclan.
 *
 * `ahora` entra como dato: ni el dominio ni la persistencia leen el reloj (ADR-004, regla G4).
 */
export type ContextoOperativo = Readonly<{
  tipo: "OPERATIVO";
  empresaId: EmpresaId;
  /** `null`: lo hace el sistema (por ejemplo, un trabajo programado). */
  personaId: PersonaId | null;
  ahora: Date;
}>;

export type ContextoDeGrupo = Readonly<{
  tipo: "GRUPO";
  tenantId: TenantId;
  personaId: PersonaId;
  ahora: Date;
}>;

export type ContextoDePlataforma = Readonly<{
  tipo: "PLATAFORMA";
  /** Identificador del administrador de plataforma (identidad propia, distinta de `Persona`). */
  administrador: string;
  ahora: Date;
}>;

/** El cron que avanza la cola de trabajos: no ve datos de negocio. */
export type ContextoDeTrabajos = Readonly<{ tipo: "TRABAJOS"; ahora: Date }>;

/**
 * Alguien que todavía no tiene cuenta y llega con un enlace de invitación. Entra por el rol de la
 * aplicación, pero sin empresa ni persona: lo único que el contexto firmado declara es el hash del
 * token, y las políticas del tramo de invitaciones (H3) muestran solo la invitación que le
 * corresponde. `tokenHash` es el sha256 en hexadecimal (64 caracteres) del token: el token en sí
 * nunca viaja a la base.
 */
export type ContextoDeInvitacion = Readonly<{
  tipo: "INVITACION";
  tokenHash: string;
  ahora: Date;
}>;

export type Contexto =
  | ContextoOperativo
  | ContextoDeGrupo
  | ContextoDePlataforma
  | ContextoDeTrabajos
  | ContextoDeInvitacion;

export type TipoDeContexto = Contexto["tipo"];
