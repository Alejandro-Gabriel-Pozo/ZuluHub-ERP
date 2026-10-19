import {
  CODIGO_DE_INGRESO_GENERICO,
  type CODIGOS_DE_INGRESO,
} from "../autenticacion/codigos-de-ingreso";
import type { ClaveDeTexto } from "../vocabulario/catalogo";

/**
 * El texto de cada código con que el ingreso devuelve a la pantalla de ingreso (`/ingreso?error=<código>`).
 * La lista de códigos es CERRADA (`CODIGOS_DE_INGRESO`, W3b): `Record` sobre ella no compila si se suma un
 * código sin su texto. Varios códigos técnicos comparten un texto: a la persona no le sirve distinguir un
 * `state_mismatch` de un `no_code`, sí saber qué puede hacer (reintentar, cambiar de cuenta). Previene: un
 * error de ingreso sin explicación, o con el código técnico a la vista. Chequeo: `errores-de-ingreso.test.ts`.
 */
type CodigoDeIngreso = (typeof CODIGOS_DE_INGRESO)[number] | typeof CODIGO_DE_INGRESO_GENERICO;

const CLAVE_DE_ERROR_DE_INGRESO: Readonly<Record<CodigoDeIngreso, ClaveDeTexto>> = Object.freeze({
  access_denied: "ingreso.error.cancelado",
  email_no_verificado: "ingreso.error.email_no_verificado",
  email_not_verified: "ingreso.error.email_no_verificado",
  account_already_linked_to_different_user: "ingreso.error.cuenta_no_valida",
  account_not_linked: "ingreso.error.cuenta_no_valida",
  email_does_not_match: "ingreso.error.cuenta_no_valida",
  email_not_found: "ingreso.error.cuenta_no_valida",
  unable_to_link_account: "ingreso.error.cuenta_no_valida",
  signup_disabled: "ingreso.error.cuenta_no_valida",
  invalid_callback_request: "ingreso.error.interrumpido",
  nonce_binding_missing: "ingreso.error.interrumpido",
  no_callback_url: "ingreso.error.interrumpido",
  no_code: "ingreso.error.interrumpido",
  please_restart_the_process: "ingreso.error.interrumpido",
  state_generation_error: "ingreso.error.interrumpido",
  state_mismatch: "ingreso.error.interrumpido",
  state_not_found: "ingreso.error.interrumpido",
  internal_server_error: "ingreso.error.generico",
  invalid_code: "ingreso.error.generico",
  issuer_mismatch: "ingreso.error.generico",
  oauth_provider_not_found: "ingreso.error.generico",
  unable_to_create_session: "ingreso.error.generico",
  unable_to_create_user: "ingreso.error.generico",
  unable_to_get_user_info: "ingreso.error.generico",
  validation_failed: "ingreso.error.generico",
  error_de_ingreso: "ingreso.error.generico",
});

/** La clave del texto del `?error=` de la pantalla de ingreso; `null` si no hay error. Un código raro es el genérico. */
export function claveDeErrorDeIngreso(codigo: string | null | undefined): ClaveDeTexto | null {
  if (codigo === null || codigo === undefined || codigo === "") return null;
  return Object.hasOwn(CLAVE_DE_ERROR_DE_INGRESO, codigo)
    ? CLAVE_DE_ERROR_DE_INGRESO[codigo as CodigoDeIngreso]
    : CLAVE_DE_ERROR_DE_INGRESO[CODIGO_DE_INGRESO_GENERICO];
}
