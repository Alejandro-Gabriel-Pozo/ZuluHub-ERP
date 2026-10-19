import { esObjeto, leerJson } from "./json-seguro";

/**
 * El pedido «empezar el ingreso con Google» (`POST /api/auth/sign-in/social`) y su respuesta (S1 de la
 * revisión del PR #48).
 *
 * La librería acepta en ese mismo pedido un `idToken` (o un `accessToken`) armado por el cliente: con eso
 * abre una sesión SIN pasar por la pantalla de Google ni por el estado/CSRF del retorno, y devuelve el token
 * de sesión en el cuerpo (legible por cualquier script de la página). Acá se elimina esa ambigüedad:
 *
 *  - `cuerpoDeIngresoSocialValido`: el pedido solo puede traer `provider` (= `google`) y, si quiere, `callbackURL`
 *    (texto corto). Cualquier otro campo (`idToken`, `accessToken`, `disableRedirect`, `requestSignUp`…) lo vuelve
 *    inválido: la ruta responde 4xx. Si se quita, un campo nuevo de una versión futura de la librería
 *    cambiaría el comportamiento del ingreso sin que nadie lo revise.
 *  - `cuerpoPublicoDeIngresoSocial`: lo único que sale del ingreso es la dirección de Google. Nunca el
 *    `token` de sesión ni el usuario, aunque la librería los devolviera.
 */

const CAMPOS_PERMITIDOS: readonly string[] = ["provider", "callbackURL"];
const PROVEEDOR = "google";
const LARGO_MAXIMO_DEL_CUERPO = 2048;
const LARGO_MAXIMO_DE_LA_RUTA = 512;

export function cuerpoDeIngresoSocialValido(cuerpo: string): boolean {
  if (cuerpo.length > LARGO_MAXIMO_DEL_CUERPO) return false;
  const datos = leerJson(cuerpo);
  if (!esObjeto(datos) || Array.isArray(datos)) return false;
  const campos = datos as Readonly<Record<string, unknown>>;
  if (!Object.keys(campos).every((c) => CAMPOS_PERMITIDOS.includes(c))) return false;
  if (campos["provider"] !== PROVEEDOR) return false;
  const volver = campos["callbackURL"];
  return (
    volver === undefined || (typeof volver === "string" && volver.length <= LARGO_MAXIMO_DE_LA_RUTA)
  );
}

export type CuerpoPublicoDeIngresoSocial = Readonly<{ url: string; redirect: true }>;

/** La dirección de Google (`https:`) y nada más; `null` si la respuesta no trae una. */
export function cuerpoPublicoDeIngresoSocial(cuerpo: string): CuerpoPublicoDeIngresoSocial | null {
  const datos = leerJson(cuerpo);
  const url = esObjeto(datos) && "url" in datos ? datos.url : null;
  return typeof url === "string" && url.startsWith("https://") ? { url, redirect: true } : null;
}
