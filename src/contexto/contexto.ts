import type {
  AdminPlataformaId,
  EmpresaId,
  MarcaComercialId,
  PersonaId,
  TenantId,
  UsuarioAuthId,
} from "../primitivas/identificadores/marca";

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
  /**
   * Por la puerta de qué marca entró la persona (marcas y planes, §B.2.4): la marca que resolvió el
   * servidor a partir del host de la solicitud, nunca un dato que mande el navegador. La carga de
   * autorización la compara con la marca del tenant de la empresa: si no coincide, no hay rol y todo
   * da `SIN_PERMISO`. `null` solo para el sistema (trabajos, `personaId: null`), que no entra por
   * ninguna puerta. Es obligatorio a propósito: un contexto armado sin decidir la marca no compila.
   * La marca NO viaja en el token firmado (no es frontera de aislamiento, §B.10).
   */
  marcaDeEntrada: MarcaComercialId | null;
  ahora: Date;
}>;

export type ContextoDeGrupo = Readonly<{
  tipo: "GRUPO";
  tenantId: TenantId;
  personaId: PersonaId;
  ahora: Date;
}>;

/**
 * Quién actúa en la plataforma. Viaja FIRMADO en el token del contexto (claim `a`) y la base lo usa
 * en sus políticas: un administrador de plataforma (con su id; su rol, ADMIN o SOPORTE, lo lee la
 * base de `admin_plataforma`, no viaja) o el sistema (el barrido de altas vencidas, que no es una
 * persona). `proceso` nombra al proceso para la auditoría; no se firma.
 */
export type ActorDePlataforma =
  | Readonly<{ tipo: "ADMIN"; id: AdminPlataformaId }>
  | Readonly<{ tipo: "SISTEMA"; proceso: string }>;

export type ContextoDePlataforma = Readonly<{
  tipo: "PLATAFORMA";
  actor: ActorDePlataforma;
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
  /**
   * El usuario autenticado que abrió el enlace (claim firmado `s`); `null` si todavía no ingresó. Con él la
   * base deja vincular a la persona del email de la invitación con ESE usuario (y solo con ese).
   */
  usuarioAuth: UsuarioAuthId | null;
  ahora: Date;
}>;

/**
 * Alguien que ya ingresó (tiene sesión) y todavía no eligió empresa: la base solo le muestra lo suyo,
 * por lectura (su persona, sus membresías activas, sus empresas y los tenants de estas). Viaja firmado
 * en el claim `s`; no lleva empresa ni persona ni marca. Entra por el rol de la aplicación; ninguna
 * política le deja escribir (web-armazon §3.3).
 */
export type ContextoDeSesion = Readonly<{
  tipo: "SESION";
  usuarioAuth: UsuarioAuthId;
  ahora: Date;
}>;

export type Contexto =
  | ContextoOperativo
  | ContextoDeGrupo
  | ContextoDePlataforma
  | ContextoDeTrabajos
  | ContextoDeInvitacion
  | ContextoDeSesion;

export type TipoDeContexto = Contexto["tipo"];
