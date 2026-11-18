/**
 * Cabeceras de seguridad y de indexación de cada respuesta de la puerta (armazón web P-3 y P-4; marca,
 * metadatos y SEO §5.1). Funciones puras: el nonce y si el despliegue es de producción entran como dato.
 * El encabezado `X-Robots-Tag` va en la respuesta, y no solo la etiqueta `<meta>`, porque Next puede
 * mandar los metadatos al final del `<body>` y un único encabezado en un solo lugar elimina la
 * categoría de falla «una página se olvidó del noindex».
 */

/**
 * Con qué cara responde la puerta. `NEUTRA` es la de todo host que no se sirve; `SISTEMA` la de las rutas de
 * sistema (el cron y la salud), que responden en cualquier host y nunca se indexan.
 */
export type SuperficieDeRespuesta = "APP" | "LANDING" | "CARTA" | "NEUTRA" | "SISTEMA";

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
    // `data:` solo para imágenes: el QR fiscal llega como SVG dibujado en el servidor y se muestra en un `<img data:>`
    // (dentro de `<img>` un SVG no ejecuta scripts ni carga recursos). Previene: el QR roto por la CSP (RG 4291).
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * De quién es el host que responde: de una marca (host COMPARTIDO por todas sus empresas) o de una empresa (host dedicado,
 * el dominio propio). Es el mismo valor que `DuenioDeLaPuerta["tipo"]`; se repite acá solo para no importar `puerta.ts` (que importa este archivo).
 */
export type TipoDeDuenioDeHost = "MARCA" | "EMPRESA";

/**
 * Si la carta se deja indexar según de quién es el host. ÚNICO lugar de esta regla (la cabecera `X-Robots-Tag` y la etiqueta `<meta robots>` salen de `esIndexable`).
 * Dueño, 16/11/2026: las cartas del host compartido siguen «no indexar» hasta que exista dominio propio. Hoy AMBAS entradas están cerradas (nace cerrado: la de
 * `EMPRESA` se abre cuando el dueño lo decida y haya dominio propio ACTIVO, cambiando esa única línea y su prueba; no hay perilla ni texto que lo active).
 * Previene: indexar por error las cartas del host compartido (códigos largos, duplicados al sumar el dominio propio, cartas que el cliente quiso discretas).
 */
export const CARTA_INDEXABLE_SEGUN_DUENIO: Readonly<Record<TipoDeDuenioDeHost, boolean>> =
  Object.freeze({
    MARCA: false,
    EMPRESA: false,
  });

/** La tabla de quién deja indexar su carta, como dato: `esIndexable` y `cabecerasDe` la reciben para poder probar la regla con la tabla abierta mientras la de producción sigue cerrada. */
type TablaDeCartaIndexable = Readonly<Record<TipoDeDuenioDeHost, boolean>>;

/**
 * ¿Se deja indexar? La landing en producción; la carta solo en producción y según el dueño del host (tabla de arriba: hoy nunca). La app y la neutra nunca.
 * Fuera de producción nada, sea cual sea la superficie. Sin dueño conocido (`null`) o con uno que la tabla no conoce, se cierra.
 */
export const esIndexable = (
  superficie: SuperficieDeRespuesta,
  produccion: boolean,
  duenio: TipoDeDuenioDeHost | null,
  tabla: TablaDeCartaIndexable = CARTA_INDEXABLE_SEGUN_DUENIO,
): boolean => {
  if (!produccion) return false;
  if (superficie === "LANDING") return true;
  return superficie === "CARTA" && duenio !== null && tabla[duenio] === true;
};

/**
 * HSTS: solo el host que responde, SIN `includeSubDomains`. Los hosts son dominios de CLIENTES (APP, CARTA,
 * LANDING y las rutas de sistema en cualquiera de ellos): un cliente puede tener subdominios que no
 * controlamos (su correo, un sitio viejo sin https), y obligarlos a https desde acá los rompería sin
 * aviso. Si se quita esta decisión, un navegador que visitó un host nuestro deja de aceptar http en
 * TODOS los subdominios del cliente.
 */
const HSTS = "max-age=31536000";

/** Las cabeceras de toda respuesta de la puerta, de cualquier superficie. */
export function cabecerasDe(
  superficie: SuperficieDeRespuesta,
  nonce: string,
  /** `duenio` solo importa para la carta; si falta, se cierra (nunca indexable). */
  opciones: Readonly<{
    produccion: boolean;
    duenio?: TipoDeDuenioDeHost | null;
    tabla?: TablaDeCartaIndexable;
  }>,
): Readonly<Record<string, string>> {
  return Object.freeze({
    "Content-Security-Policy": politicaDeContenido(nonce),
    "Strict-Transport-Security": HSTS,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cache-Control": "private, no-store",
    ...(esIndexable(superficie, opciones.produccion, opciones.duenio ?? null, opciones.tabla)
      ? {}
      : { "X-Robots-Tag": "noindex" }),
  });
}
