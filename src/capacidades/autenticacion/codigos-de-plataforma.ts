/**
 * Los códigos públicos de error del ingreso de la consola de plataforma (h5-p8 §3). Lista CERRADA, en minúsculas porque
 * salen por el canal `?error=` de la librería, como los de empresa. La web los traduce a su forma pública y a su
 * texto. Para quien mira de afuera, «no es personal habilitado» y «cualquier otro fallo del ingreso» son LO MISMO
 * (`no_habilitado`): si no, la pantalla de ingreso diría quién es personal de la plataforma (un oráculo).
 */
export const CODIGOS_DE_PLATAFORMA = [
  "no_habilitado",
  "segundo_factor_requerido",
  "segundo_factor_a_enrolar",
  "codigo_invalido",
  "demasiados_intentos",
  "segundo_factor_reciente_requerido",
  "sesion_vencida",
] as const;

export type CodigoDePlataforma = (typeof CODIGOS_DE_PLATAFORMA)[number];

/** El código genérico: el de la cuenta que no es personal habilitado y el de cualquier fallo que no tiene otro. */
export const CODIGO_DE_PLATAFORMA_GENERICO: CodigoDePlataforma = "no_habilitado";

const esCodigoDePlataforma = (codigo: string | null): codigo is CodigoDePlataforma =>
  (CODIGOS_DE_PLATAFORMA as readonly (string | null)[]).includes(codigo);

/**
 * El código que sale en `?error=` cuando falla el retorno de Google. Todo lo que la librería o Google devuelvan
 * (`access_denied`, `state_mismatch`, `unable_to_create_user`, un código nuevo de una versión futura…) se vuelve
 * `no_habilitado`: la persona no puede distinguir «no sos personal» de «falló otra cosa». Un código que ya es uno de
 * la lista pasa tal cual.
 */
export function codigoPublicoDeIngresoDePlataforma(codigo: string | null): CodigoDePlataforma {
  return esCodigoDePlataforma(codigo) ? codigo : CODIGO_DE_PLATAFORMA_GENERICO;
}

/**
 * Códigos que la propia aplicación pone en los errores que lanza desde sus ganchos (en mayúsculas, como los de la
 * librería, para que viajen igual por su respuesta de error).
 */
export const CODIGO_DE_SEGUNDO_FACTOR_RECIENTE = "SEGUNDO_FACTOR_RECIENTE_REQUERIDO";
export const CODIGO_DE_ENROLAMIENTO_VENCIDO = "ENROLAMIENTO_VENCIDO";
export const CODIGO_DE_DEMASIADOS_INTENTOS = "DEMASIADOS_INTENTOS";
export const CODIGO_DE_SESION_NO_VIGENTE = "SESION_NO_VIGENTE";

/** El código (de la librería o propio) → el público. Lo que no está acá es `no_habilitado`. */
const POR_CODIGO_DE_LA_LIBRERIA: Readonly<Record<string, CodigoDePlataforma>> = Object.freeze({
  INVALID_CODE: "codigo_invalido",
  INVALID_BACKUP_CODE: "codigo_invalido",
  TOTP_NOT_ENABLED: "segundo_factor_a_enrolar",
  BACKUP_CODES_NOT_ENABLED: "segundo_factor_a_enrolar",
  TWO_FACTOR_NOT_ENABLED: "segundo_factor_a_enrolar",
  TOTP_ALREADY_ENABLED: "segundo_factor_requerido",
  [CODIGO_DE_SEGUNDO_FACTOR_RECIENTE]: "segundo_factor_reciente_requerido",
  [CODIGO_DE_ENROLAMIENTO_VENCIDO]: "sesion_vencida",
  [CODIGO_DE_SESION_NO_VIGENTE]: "sesion_vencida",
  UNAUTHORIZED: "sesion_vencida",
  INVALID_TWO_FACTOR_COOKIE: "sesion_vencida",
  [CODIGO_DE_DEMASIADOS_INTENTOS]: "demasiados_intentos",
});

/**
 * El código público de una respuesta de error de las rutas del segundo factor. El estado manda en dos casos: 429 (el
 * límite de pedidos de la librería o el nuestro) es `demasiados_intentos`, y 409 (dos pedidos a la vez gastaron el
 * mismo código de recuperación, y la librería deja pasar a uno solo) es `codigo_invalido`. Lo demás sale del código
 * de la librería; lo que no se conoce es el genérico: nunca se reenvía texto de la librería.
 */
export function codigoPublicoDeErrorDePlataforma(
  estado: number,
  codigo: string,
): CodigoDePlataforma {
  if (estado === 429) return "demasiados_intentos";
  if (estado === 409) return "codigo_invalido";
  return Object.hasOwn(POR_CODIGO_DE_LA_LIBRERIA, codigo)
    ? (POR_CODIGO_DE_LA_LIBRERIA[codigo] as CodigoDePlataforma)
    : CODIGO_DE_PLATAFORMA_GENERICO;
}
