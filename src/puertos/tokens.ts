import type { InvitacionId } from "../primitivas/identificadores/marca";

/**
 * Puerto de tokens de invitación (ADR-007: el token no se guarda ni viaja en los trabajos; se
 * recalcula cuando hace falta).
 *
 * El token se DERIVA del id de la invitación con un secreto del servidor: la base guarda solo su
 * hash (sha256 en hexadecimal minúscula) y el mail se arma recalculando el token con `derivar`.
 */
export type TokenEmitido = Readonly<{
  invitacionId: InvitacionId;
  token: string;
  tokenHash: string;
}>;

export interface Tokens {
  /**
   * Una invitación nueva: su id (al azar), el token derivado de ese id y el hash del token. Usa
   * azar, así que se llama FUERA de la transacción: el reintento de una transacción reutiliza el
   * mismo id y el mismo token (ADR-004: el trabajo no tiene azar).
   */
  emitir(): TokenEmitido;
  /** sha256 en hexadecimal minúscula (64 caracteres) del token, como lo guarda la base. */
  hash(token: string): string;
  /** El token de una invitación ya emitida: el mismo id siempre da el mismo token. */
  derivar(id: InvitacionId): string;
}
