import type { ContextoDeInvitacion, ContextoOperativo } from "../contexto/contexto";
import type { EmpresaId, MarcaComercialId, PersonaId } from "../primitivas/identificadores/marca";

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
  ahora: Date;
}>;

/** Alguien sin cuenta llega con un enlace de invitación. */
export function contextoDeInvitacion(datos: DatosDeContextoDeInvitacion): ContextoDeInvitacion {
  exigirFechaValida(datos.ahora);
  return { tipo: "INVITACION", tokenHash: datos.tokenHash, ahora: datos.ahora };
}
