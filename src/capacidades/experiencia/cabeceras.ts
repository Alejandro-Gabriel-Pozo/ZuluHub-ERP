/**
 * Cabeceras de seguridad y de indexación de cada respuesta de la puerta (armazón web P-3 y P-4; marca,
 * metadatos y SEO §5.1). Funciones puras: el nonce y si el despliegue es de producción entran como dato.
 * El encabezado `X-Robots-Tag` va en la respuesta, y no solo la etiqueta `<meta>`, porque Next puede
 * mandar los metadatos al final del `<body>` y un único encabezado en un solo lugar elimina la
 * categoría de falla «una página se olvidó del noindex».
 */

/** Con qué cara responde la puerta. `NEUTRA` es la de todo host que no se sirve. */
export type SuperficieDeRespuesta = "APP" | "LANDING" | "CARTA" | "NEUTRA";

/** Un nonce en base64 de al menos 16 bytes (22 caracteres): nada que pueda cortar la política con `;`. */
const NONCE_VALIDO = /^[A-Za-z0-9+/]{22,}={0,2}$/;

export const BYTES_DE_UN_NONCE = 16;

export const esNonceValido = (nonce: string): boolean => NONCE_VALIDO.test(nonce);

/** El nonce de un pedido a partir de bytes al azar (los sortea quien llama: acá no hay azar). */
export function nonceDe(aleatorio: Uint8Array): string {
  if (aleatorio.length < BYTES_DE_UN_NONCE) {
    throw new RangeError(`el nonce necesita al menos ${BYTES_DE_UN_NONCE} bytes de azar`);
  }
  return btoa(String.fromCharCode(...aleatorio));
}

/**
 * La CSP de la web: scripts solo propios con nonce (`strict-dynamic` deja cargar lo que ellos cargan),
 * estilos propios o con nonce (el tema de marca va en un `<style nonce>`), nada de objetos ni de
 * `<base>`, y la página no se puede enmarcar. Un nonce que no sea base64 es un defecto de quien llama:
 * se lanza antes de ponerlo en una cabecera.
 */
export function politicaDeContenido(nonce: string): string {
  if (!esNonceValido(nonce)) throw new RangeError("nonce inválido para la política de contenido");
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * ¿Se deja indexar? Solo la landing y solo en producción. La app y la neutra nunca; la carta tampoco por
 * ahora (en un host compartido no se indexa; en uno dedicado sí, pero esa diferencia llega con la carta:
 * hasta entonces se falla cerrado). Fuera de producción nada, sea cual sea la superficie.
 */
export const esIndexable = (superficie: SuperficieDeRespuesta, produccion: boolean): boolean =>
  produccion && superficie === "LANDING";

/** Las cabeceras de toda respuesta de la puerta, de cualquier superficie. */
export function cabecerasDe(
  superficie: SuperficieDeRespuesta,
  nonce: string,
  opciones: Readonly<{ produccion: boolean }>,
): Readonly<Record<string, string>> {
  return Object.freeze({
    "Content-Security-Policy": politicaDeContenido(nonce),
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cache-Control": "private, no-store",
    ...(esIndexable(superficie, opciones.produccion) ? {} : { "X-Robots-Tag": "noindex" }),
  });
}
