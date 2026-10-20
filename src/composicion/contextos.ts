import type {
  ActorDePlataforma,
  ContextoDeInvitacion,
  ContextoDePlataforma,
  ContextoDeSesion,
  ContextoOperativo,
} from "../contexto/contexto";
import type {
  EmpresaId,
  MarcaComercialId,
  PersonaId,
  UsuarioAuthId,
} from "../primitivas/identificadores/marca";

/**
 * El ÚNICO lugar que arma contextos con persona o con invitación (regla R-W3; web-armazon §3.2).
 * Previene: un contexto con una empresa o una marca que mandó el navegador. Quien llama pasa lo que
 * ya resolvió el servidor (la empresa elegida entre las de la persona, la marca que salió del host);
 * acá no se decide nada, solo se arma. El contexto NO se firma acá: lo firma el adaptador de
 * transacciones con la clave del servidor, en cada intento (ADR-011).
 *
 * `ahora` entra como dato y se toma una sola vez por pedido (ADR-004, regla G4); una fecha inválida
 * se rechaza antes de que llegue a la base.
 */

function exigirFechaValida(ahora: Date): void {
  if (Number.isNaN(ahora.getTime())) throw new RangeError("ahora debe ser una fecha válida");
}

export type DatosDeContextoOperativo = Readonly<{
  empresaId: EmpresaId;
  personaId: PersonaId;
  /** La marca por cuya puerta entró la persona: la que resolvió el servidor desde el host. */
  marcaDeEntrada: MarcaComercialId;
  ahora: Date;
}>;

/** Una persona actúa en una empresa, entrando por la puerta de una marca. */
export function contextoOperativo(datos: DatosDeContextoOperativo): ContextoOperativo {
  exigirFechaValida(datos.ahora);
  return {
    tipo: "OPERATIVO",
    empresaId: datos.empresaId,
    personaId: datos.personaId,
    marcaDeEntrada: datos.marcaDeEntrada,
    ahora: datos.ahora,
  };
}

export type DatosDeContextoDeInvitacion = Readonly<{
  /** sha256 en hexadecimal del token del enlace (`Tokens.hash`); el token en sí no viaja. */
  tokenHash: string;
  /** El usuario que ya ingresó con ese enlace (la sesión); `null` si todavía no. */
  usuarioAuth: UsuarioAuthId | null;
  ahora: Date;
}>;

/** Alguien llega con un enlace de invitación (con su cuenta, si ya ingresó). */
export function contextoDeInvitacion(datos: DatosDeContextoDeInvitacion): ContextoDeInvitacion {
  exigirFechaValida(datos.ahora);
  return {
    tipo: "INVITACION",
    tokenHash: datos.tokenHash,
    usuarioAuth: datos.usuarioAuth,
    ahora: datos.ahora,
  };
}

export type DatosDeContextoDeSesion = Readonly<{
  /** El usuario de la sesión de este pedido (la que resolvió el servidor, atada al host). */
  usuarioAuth: UsuarioAuthId;
  ahora: Date;
}>;

/** Alguien con sesión que todavía no eligió empresa: solo puede leer lo suyo. */
export function contextoDeSesion(datos: DatosDeContextoDeSesion): ContextoDeSesion {
  exigirFechaValida(datos.ahora);
  return { tipo: "SESION", usuarioAuth: datos.usuarioAuth, ahora: datos.ahora };
}

export type DatosDeContextoDePlataforma = Readonly<{
  /** Quién actúa: el administrador que identificó el script, o un proceso del sistema (el barrido). */
  actor: ActorDePlataforma;
  ahora: Date;
}>;

/**
 * Un administrador de plataforma (o un proceso del sistema) actúa. Solo lo arma la puerta de scripts de
 * plataforma, con el administrador que ella misma encontró en la base: nunca un id que mandó el navegador.
 */
export function contextoDePlataforma(datos: DatosDeContextoDePlataforma): ContextoDePlataforma {
  exigirFechaValida(datos.ahora);
  return { tipo: "PLATAFORMA", actor: datos.actor, ahora: datos.ahora };
}
