import { caminoDeRutaPropia } from "./ruta-propia";

/**
 * A dónde vuelve la persona después de ingresar (`/ingreso?volver=<ruta>`). Solo una ruta DE LA PROPIA
 * aplicación: cualquier otra cosa vuelve al inicio. Previene la redirección abierta (`//sitio-ajeno`,
 * `/\sitio-ajeno`, `https://…`), que convertiría el ingreso en un trampolín de phishing, y el bucle
 * (volver a `/ingreso`). Chequeo: `ruta-de-retorno.test.ts` y su propiedad.
 *
 * FICHA DEL DATO: RUTA DE RETORNO. LISTA DE PERMITIDOS (decisión del dueño, 2026-11-06): se declara lo que pasa y todo lo demás
 * vuelve al inicio.
 * - Fuente: la arma `ProveedorDeSesion` con `window.location.pathname + search` (el camino ya viene escrito con `%XX` y la consulta
 *   con `URLSearchParams`, ver `direccionDelListado`) y la lee la pantalla de ingreso desde `?volver=`; la manda el navegador, así
 *   que se trata como dato hostil.
 * - Qué permite: hasta `LARGO_MAXIMO` (512) caracteres; el CAMINO (lo anterior a `?` o `#`) es el de una ruta propia
 *   (`ruta-propia.ts`, su ficha); lo que sigue (consulta y fragmento) tiene solo `? # / & = % + * . _ ~ -`, letras y dígitos
 *   ASCII, que es lo que escribe `URLSearchParams` (el `+` es un espacio y el `*` queda sin codificar; sin ellos se perdería el
 *   retorno de un listado con texto buscado, p. ej. `?texto=Hotel+Sol`).
 * - Qué rechaza: todo lo demás (`:` `@` `,` `;` `'` `!` `(` `)` `$`, espacios, controles, `\`, letras de otros alfabetos, barras
 *   y puntos Unicode); un camino que no sea de la propia aplicación; `/s…` (internas), `/api…` y `/ingreso…` (bucle).
 * - Ejemplos que pasan: `/`, `/facturacion/comprobantes?periodo=mes&texto=Hotel+Sol`, `/a/b#parte`. Se rechazan: `//evil.com`,
 *   `/\evil.com`, `/%2f%2fevil.com`, `https://evil.com`, `/ingreso`, `/ventas?x=a:b`.
 */
const RUTA_DE_INICIO = "/";
const LARGO_MAXIMO = 512;
/** Consulta y fragmento: lo que escribe `URLSearchParams` más `? # /` de los separadores y del fragmento. */
const CONSULTA_Y_FRAGMENTO = /^[?#][A-Za-z0-9/?#%&=+*._~-]*$/;

/** Rutas que no se usan de destino: las internas de Next, la API y el propio ingreso. */
const NO_ES_DESTINO = /^\/(s|api|ingreso)(\/|\?|#|$)/i;

export function rutaDeRetorno(candidata: string | null | undefined): string {
  if (typeof candidata !== "string" || candidata.length > LARGO_MAXIMO) {
    return RUTA_DE_INICIO;
  }
  const corte = candidata.search(/[?#]/);
  const camino = corte === -1 ? candidata : candidata.slice(0, corte);
  const resto = corte === -1 ? "" : candidata.slice(corte);
  const decodificado = caminoDeRutaPropia(camino);
  if (decodificado === null) return RUTA_DE_INICIO;
  if (resto !== "" && !CONSULTA_Y_FRAGMENTO.test(resto)) return RUTA_DE_INICIO;
  if (NO_ES_DESTINO.test(candidata) || NO_ES_DESTINO.test(decodificado)) return RUTA_DE_INICIO;
  return candidata;
}
