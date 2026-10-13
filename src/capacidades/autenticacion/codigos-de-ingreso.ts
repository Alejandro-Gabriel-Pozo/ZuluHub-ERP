/**
 * Los códigos con que el ingreso devuelve a la persona a la pantalla de ingreso cuando algo sale mal
 * (`?error=<código>`). Lista CERRADA: la librería arma la redirección con el código que le llega del
 * proveedor o de una validación (y, a veces, una descripción libre); nada de eso sale tal cual (ADR-016:
 * ningún error interno sale con detalle). Un código que no está en la lista se vuelve el genérico, y la
 * descripción se descarta. Los mensajes en castellano son de la pantalla de ingreso, no de acá.
 */
export const CODIGOS_DE_INGRESO = [
  "access_denied",
  "account_already_linked_to_different_user",
  "account_not_linked",
  "email_does_not_match",
  "email_no_verificado",
  "email_not_found",
  "email_not_verified",
  "internal_server_error",
  "invalid_callback_request",
  "invalid_code",
  "issuer_mismatch",
  "no_callback_url",
  "no_code",
  "nonce_binding_missing",
  "oauth_provider_not_found",
  "please_restart_the_process",
  "signup_disabled",
  "state_generation_error",
  "state_mismatch",
  "state_not_found",
  "unable_to_create_session",
  "unable_to_create_user",
  "unable_to_get_user_info",
  "unable_to_link_account",
  "validation_failed",
] as const;

export const CODIGO_DE_INGRESO_GENERICO = "error_de_ingreso";

export function codigoPublicoDeIngreso(codigo: string | null): string {
  return (CODIGOS_DE_INGRESO as readonly (string | null)[]).includes(codigo)
    ? (codigo as string)
    : CODIGO_DE_INGRESO_GENERICO;
}

/**
 * Si `ubicacion` (el `Location` de una redirección de la librería) lleva un `error`, la devuelve
 * reducida a ese código público: misma ruta, solo `?error=`, sin descripción ni otros parámetros ni
 * fragmento. Si no lleva `error`, la devuelve igual. Una ubicación que no se puede interpretar se
 * vuelve la raíz del origen: nunca se deja pasar un texto que no se entiende.
 */
export function sanearUbicacionDeError(ubicacion: string, origen: string): string {
  try {
    const url = new URL(ubicacion, origen);
    if (!url.searchParams.has("error")) return ubicacion;
    const reducida = `${url.pathname}?error=${codigoPublicoDeIngreso(url.searchParams.get("error"))}`;
    return ubicacion.startsWith("/") ? reducida : `${url.origin}${reducida}`;
  } catch {
    return origen;
  }
}

export const CODIGO_DE_SOLICITUD_GENERICO = "SOLICITUD_INVALIDA";

const CODIGO_DE_LA_LIBRERIA = /^[A-Z][A-Z0-9_]{0,63}$/;

/**
 * El código estable de una respuesta JSON de error de la librería (`{ "code": "INVALID_ORIGIN", ... }`),
 * sin su mensaje ni ningún otro campo. Si el cuerpo no es JSON, no trae `code` o el `code` no tiene la
 * forma de un código (mayúsculas y guiones bajos), el genérico: nunca se reenvía texto que no se conoce.
 */
export function codigoPublicoDeSolicitud(cuerpo: string): string {
  try {
    const datos: unknown = JSON.parse(cuerpo);
    if (typeof datos === "object" && datos !== null && "code" in datos) {
      const { code } = datos;
      if (typeof code === "string" && CODIGO_DE_LA_LIBRERIA.test(code)) return code;
    }
  } catch {
    // No es JSON: cae en el genérico.
  }
  return CODIGO_DE_SOLICITUD_GENERICO;
}
