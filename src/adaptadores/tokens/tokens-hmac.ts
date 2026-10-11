import { createHash, createHmac, randomUUID } from "node:crypto";
import type { Tokens } from "../../puertos/tokens";
import { invitacionId, type InvitacionId } from "../../primitivas/identificadores/marca";
import { ErrorDeConfiguracion } from "../postgres/errores";

/**
 * Tokens de invitación con HMAC-SHA256 (ADR-007, diseño §6.3).
 *
 * - El token es `base64url(HMAC-SHA256(secreto, "invitacion/v1/" + id))`: se deriva del id de la
 *   invitación, así que el mail se puede armar de nuevo sin guardarlo (la base guarda solo el hash).
 * - El hash que se guarda es el sha256 del token en hexadecimal minúscula (64 caracteres).
 * - El secreto lo carga el dueño en el entorno (`ZULUHUB_SECRETO_INVITACIONES`); acá solo se lee el
 *   NOMBRE. Falla cerrado: sin secreto, o con uno corto, no se construye el adaptador.
 */

/** NOMBRE de la variable de entorno con el secreto (hexadecimal de 64 o más dígitos). */
export const ZULUHUB_SECRETO_INVITACIONES = "ZULUHUB_SECRETO_INVITACIONES";

const BYTES_MINIMOS = 32;

/**
 * Parsea el valor de `ZULUHUB_SECRETO_INVITACIONES`: hexadecimal de al menos 64 dígitos (32 bytes) y
 * cantidad par. No lee `process.env`. Si falta o es inválido lanza `ErrorDeConfiguracion` con un
 * mensaje que NUNCA incluye el valor recibido.
 */
export function leerSecretoDeInvitaciones(valor: string | undefined): Buffer {
  const invalido = (motivo: string) =>
    new ErrorDeConfiguracion(
      `${ZULUHUB_SECRETO_INVITACIONES} inválido: ${motivo} (formato esperado: hexadecimal de ${BYTES_MINIMOS * 2} o más dígitos)`,
    );
  const texto = valor?.trim() ?? "";
  if (texto === "") throw invalido("falta");
  if (!/^[0-9a-fA-F]+$/.test(texto)) throw invalido("no es hexadecimal");
  if (texto.length % 2 !== 0) throw invalido("tiene una cantidad impar de dígitos");
  if (texto.length < BYTES_MINIMOS * 2) {
    throw invalido(`necesita al menos ${BYTES_MINIMOS * 2} dígitos`);
  }
  return Buffer.from(texto, "hex");
}

const sha256Hex = (texto: string): string =>
  createHash("sha256").update(texto, "utf8").digest("hex");

export function crearTokensHmac(
  secreto: Buffer,
  /** Solo para las pruebas: el generador de ids. */
  generarId: () => string = randomUUID,
): Tokens {
  // Falla cerrado también si llega un Buffer corto armado a mano.
  if (!Buffer.isBuffer(secreto) || secreto.length < BYTES_MINIMOS) {
    throw new ErrorDeConfiguracion(
      `falta el secreto de invitaciones (de ${BYTES_MINIMOS} bytes o más)`,
    );
  }
  // Copia: que nadie cambie el secreto desde afuera después de construir el adaptador.
  const clave = Buffer.from(secreto);

  const derivar = (id: InvitacionId): string =>
    createHmac("sha256", clave).update(`invitacion/v1/${id}`, "utf8").digest("base64url");

  return {
    emitir() {
      const id = invitacionId(generarId());
      const token = derivar(id);
      return { invitacionId: id, token, tokenHash: sha256Hex(token) };
    },
    hash: sha256Hex,
    derivar,
  };
}
