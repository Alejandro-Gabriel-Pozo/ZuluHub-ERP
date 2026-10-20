import { esObjeto, leerJson } from "./json-seguro";
import { FORMA_DEL_CODIGO_DE_TOTP } from "./totp";

/**
 * Los pedidos y las respuestas de las rutas del segundo factor de la consola (h5-p8 §2.4 ter y §3). Funciones puras
 * sobre texto JSON.
 *
 * Pedidos: cada ruta acepta UN cuerpo exacto y nada más (como `cuerpoDeIngresoSocialValido`). La librería acepta
 * campos de más que cambian lo que pasa (`trustDevice` deja un dispositivo «de confianza» 30 días, `method: "otp"` o
 * `password` abren otros caminos): acá no llegan. Previene: un campo que una versión futura de la librería sume y
 * cambie el segundo factor sin que nadie lo revise.
 *
 * Respuestas: de lo que la librería devuelve solo se extrae lo que la pantalla necesita. El `token` de la sesión y el
 * usuario no salen (un script de la página los leería aunque la cookie sea `HttpOnly`).
 */

const LARGO_MAXIMO_DEL_CUERPO = 256;
export const FORMA_DEL_CODIGO_DE_RECUPERACION = /^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/;

function camposDe(cuerpo: string): Readonly<Record<string, unknown>> | null {
  if (cuerpo.length > LARGO_MAXIMO_DEL_CUERPO) return null;
  const datos = leerJson(cuerpo);
  if (!esObjeto(datos) || Array.isArray(datos)) return null;
  return datos as Readonly<Record<string, unknown>>;
}

function cuerpoSoloConCodigo(cuerpo: string, forma: RegExp): boolean {
  const campos = camposDe(cuerpo);
  if (campos === null) return false;
  const claves = Object.keys(campos);
  const codigo = campos["code"];
  return claves.length === 1 && typeof codigo === "string" && forma.test(codigo);
}

/** `{ "code": "123456" }` y nada más. */
export const cuerpoDeCodigoDeTotpValido = (cuerpo: string): boolean =>
  cuerpoSoloConCodigo(cuerpo, FORMA_DEL_CODIGO_DE_TOTP);

/** `{ "code": "abcde-12345" }` y nada más. */
export const cuerpoDeCodigoDeRecuperacionValido = (cuerpo: string): boolean =>
  cuerpoSoloConCodigo(cuerpo, FORMA_DEL_CODIGO_DE_RECUPERACION);

/** `{}`: enrolar y regenerar no llevan datos. */
export function cuerpoVacioValido(cuerpo: string): boolean {
  const campos = camposDe(cuerpo);
  return campos !== null && Object.keys(campos).length === 0;
}

/** El secreto (base32, el que se tipea a mano) de una dirección `otpauth://totp/...`, o `null` si no la trae. */
export function secretoDeLaDireccionOtpauth(direccion: string): string | null {
  try {
    const url = new URL(direccion);
    if (url.protocol !== "otpauth:") return null;
    // Un solo parámetro `secret`, y con la forma del base32: si trae dos (o ninguno) no se sabe cuál es el bueno.
    const todos = url.searchParams.getAll("secret");
    const validos = todos.filter((s) => /^[A-Z2-7]{16,128}$/.test(s));
    return todos.length === 1 && validos.length === 1 ? (validos[0] as string) : null;
  } catch {
    return null;
  }
}

function listaDeCodigos(valor: unknown): string[] | null {
  if (!Array.isArray(valor) || valor.length === 0) return null;
  const codigos: string[] = [];
  for (const c of valor as unknown[]) {
    if (typeof c !== "string" || !FORMA_DEL_CODIGO_DE_RECUPERACION.test(c)) return null;
    codigos.push(c);
  }
  return codigos;
}

/** La respuesta de `enable` de la librería: la dirección `otpauth` y los códigos de recuperación en claro. */
export type AltaDeSegundoFactorDeLaLibreria = Readonly<{
  direccion: string;
  secreto: string;
  codigos: readonly string[];
}>;

export function altaDeSegundoFactorDeLaLibreria(
  cuerpo: string,
): AltaDeSegundoFactorDeLaLibreria | null {
  const datos = leerJson(cuerpo);
  if (!esObjeto(datos)) return null;
  const direccion = "totpURI" in datos ? datos.totpURI : null;
  const codigos = "backupCodes" in datos ? listaDeCodigos(datos.backupCodes) : null;
  if (typeof direccion !== "string" || codigos === null) return null;
  const secreto = secretoDeLaDireccionOtpauth(direccion);
  return secreto === null ? null : { direccion, secreto, codigos };
}

/** La respuesta de `generate-backup-codes`: solo la lista de códigos en claro. */
export function codigosDeRecuperacionDeLaLibreria(cuerpo: string): readonly string[] | null {
  const datos = leerJson(cuerpo);
  return esObjeto(datos) && "backupCodes" in datos ? listaDeCodigos(datos.backupCodes) : null;
}
