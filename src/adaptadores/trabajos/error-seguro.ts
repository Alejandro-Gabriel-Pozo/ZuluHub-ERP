/**
 * Texto de error apto para guardar en `trabajo.ultimo_error` y en los registros (ADR-007): sin
 * secretos. Es una red de seguridad por FORMA, no una garantía: los manejadores arman sus mensajes
 * sin tokens ni enlaces desde el principio; esto tapa lo que se cuele (por ejemplo, el mensaje de
 * una excepción de red que repite una dirección).
 */
export const LARGO_MAXIMO_DE_ERROR = 500;

const ENLACE = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;
// Tokens, claves y hashes: tiras largas de caracteres de base64, base64url o hexadecimal.
const TIRA_LARGA = /[A-Za-z0-9_\-+/=]{32,}/g;
// Un identificador (uuid) no es un secreto y sirve para diagnosticar: se deja pasar.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ESPACIOS = /\s+/g;

export function textoDeErrorSeguro(texto: string): string {
  const limpio = texto
    .replace(ENLACE, "[enlace]")
    .replace(TIRA_LARGA, (tira) => (UUID.test(tira) ? tira : "[oculto]"))
    .replace(ESPACIOS, " ")
    .trim();
  if (limpio === "") return "error sin detalle";
  return limpio.length <= LARGO_MAXIMO_DE_ERROR
    ? limpio
    : `${limpio.slice(0, LARGO_MAXIMO_DE_ERROR - 1)}…`;
}

/** El texto seguro de cualquier cosa lanzada: nombre y mensaje de un `Error`, o un texto genérico. */
export function textoDeExcepcionSegura(error: unknown): string {
  return error instanceof Error
    ? textoDeErrorSeguro(`${error.name}: ${error.message}`)
    : "excepción que no es un Error";
}
