// Con extensión `.ts` a propósito: lo carga `scripts/migrar-base.ts` directamente con Node.
import { textoDeErrorSeguro } from "../trabajos/error-seguro.ts";
import { ErrorDeMigracion } from "./migraciones.ts";

/**
 * Cómo se cuenta una falla de la base en un lugar público (el registro de GitHub Actions) sin filtrar
 * la cadena de conexión. Dos defensas, porque un error de red o de autenticación repite por su cuenta
 * el host o el usuario:
 *
 * 1. Las fallas de conexión (red, credenciales, base inexistente) se cuentan por su CÓDIGO, con un
 *    texto propio: nunca se repite el mensaje original, que es donde viajan el host y el usuario.
 * 2. El resto (lo que dice una migración que falla, un `RAISE EXCEPTION`) se muestra, pero antes se le
 *    tapa todo lo que sea de la cadena: ella entera, la contraseña (también decodificada), el usuario,
 *    el host y su primera etiqueta, y después `textoDeErrorSeguro` (enlaces y tiras largas).
 *
 * Nunca se imprime la pila de la excepción. Si la cadena no se deja leer como URL, solo se tapa ella
 * entera.
 */

const MARCA = "***";
/** Un fragmento más corto que esto no se tapa: borraría letras sueltas de cualquier mensaje. */
const LARGO_MINIMO_DE_FRAGMENTO = 3;

function decodificar(texto: string): string {
  try {
    return decodeURIComponent(texto);
  } catch {
    return texto;
  }
}

/** Todo trozo de la cadena que no debe aparecer en un mensaje, del más largo al más corto. */
export function fragmentosSecretos(cadena: string | undefined): string[] {
  if (cadena === undefined) return [];
  const encontrados = new Set<string>([cadena, cadena.trim()]);
  try {
    // `new URL` ignora los espacios y saltos de línea de los extremos (un secreto pegado con uno).
    const url = new URL(cadena);
    for (const trozo of [url.password, url.username, url.hostname, url.href]) {
      encontrados.add(trozo);
      encontrados.add(decodificar(trozo));
    }
    encontrados.add(url.hostname.split(".")[0] as string);
  } catch {
    // No es una URL: queda solo la cadena entera.
  }
  return [...encontrados]
    .filter((fragmento) => fragmento.length >= LARGO_MINIMO_DE_FRAGMENTO)
    .sort((a, b) => b.length - a.length);
}

export function ocultarSecretos(texto: string, cadena: string | undefined): string {
  let salida = texto;
  for (const fragmento of fragmentosSecretos(cadena)) {
    salida = salida.split(fragmento).join(MARCA);
  }
  return salida;
}

/** Lo que agregan `pg` y Node a un `Error` (llegan como texto; si no están, `undefined`). */
type ConCodigo = { code?: string; detail?: string; hint?: string };

const CODIGOS_DE_RED: ReadonlySet<string | undefined> = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

/** SQLSTATE de fallas de conexión → qué decirle a quien cargó la cadena. */
const ESTADOS_DE_CONEXION: ReadonlyMap<string | undefined, string> = new Map([
  ["28P01", "la base rechazó el usuario o la contraseña de la cadena de conexión"],
  ["28000", "la base rechazó el usuario o la contraseña de la cadena de conexión"],
  ["3D000", "la base que nombra la cadena de conexión no existe en ese servidor"],
  ["57P03", "la base no aceptó la conexión en este momento (está arrancando o apagándose)"],
  ["53300", "la base no aceptó la conexión: ya hay demasiadas conexiones abiertas"],
]);

/**
 * El texto para mostrar de una falla. `cadena` es la de conexión que se estaba usando (sirve para
 * taparla; no se imprime nunca).
 */
export function describirFallaDeBase(error: unknown, cadena: string | undefined): string {
  if (error instanceof ErrorDeMigracion) {
    return textoDeErrorSeguro(ocultarSecretos(error.message, cadena));
  }
  if (!(error instanceof Error)) return "falla inesperada que no es un Error";

  const { code, detail, hint } = error as Error & ConCodigo;
  if (CODIGOS_DE_RED.has(code)) {
    return (
      `no se pudo conectar con el servidor de la base (${code}): revisá que la cadena guardada ` +
      "como secreto sea la correcta y que la base esté activa"
    );
  }
  const deConexion = ESTADOS_DE_CONEXION.get(code);
  if (deConexion !== undefined) return `${deConexion} (${code})`;
  if (code === "ERR_INVALID_URL") return "la cadena de conexión no tiene un formato válido";

  // Los errores de `pg` se llaman «error» (en minúscula): el prefijo no dice nada y confunde.
  const partes = [error.name === "error" ? error.message : `${error.name}: ${error.message}`];
  if (detail !== undefined && detail !== "") partes.push(`detalle: ${detail}`);
  if (hint !== undefined && hint !== "") partes.push(`pista: ${hint}`);
  if (code !== undefined) partes.push(`[${code}]`);
  return textoDeErrorSeguro(ocultarSecretos(partes.join(" "), cadena));
}
