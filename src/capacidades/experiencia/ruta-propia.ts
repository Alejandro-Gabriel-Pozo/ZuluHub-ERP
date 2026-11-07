/**
 * FICHA DEL DATO: CAMINO DE UNA RUTA PROPIA (la parte de una dirección de la aplicación que va antes de `?` y `#`). Lo comparten
 * `ruta-de-retorno.ts` (a dónde vuelve la persona después de ingresar) y `puerta.ts` (qué ruta se antepone al prefijo interno
 * `/s/<superficie>`): un solo conjunto de caracteres, escrito una vez acá.
 *
 * LISTA DE PERMITIDOS (todo nace cerrado, decisión del dueño 2026-11-06): se declara lo que SÍ puede tener una ruta; cualquier otro
 * carácter se rechaza, sin enumerar los peligrosos (barras invertidas, controles, invisibles, barras y puntos de otros alfabetos
 * como `／ ∕ ⁄ ․`, marcas de dirección `‮`, `@`, `:`, espacios). Previene la redirección abierta (`//sitio-ajeno`, `/\sitio-ajeno`,
 * `/%2f%2fsitio-ajeno`, `/%5csitio-ajeno`: el ingreso convertido en trampolín de phishing), subir de nivel (`/a/../b`, `/a/%2e%2e/b`)
 * y entrar a `/s/…` desde afuera. Fallo real que cierra: `/[\u0000- \u007f]/` y `includes("//")` listaban lo prohibido y dejaban
 * pasar lo que nadie pensó en prohibir.
 *
 * - Fuente del conjunto: las rutas reales del producto (`apps/web/app/**`: letras minúsculas, guiones, un identificador o UUID por
 *   segmento) y lo que escribe el navegador al recibir una dirección (`URL.pathname` ya viene escrito con `%XX`). Una prueba recorre
 *   todas las rutas de `apps/web/app` y exige que pasen. Los tests existentes de la puerta fijan además `/ñ`, `/a%20b`, `/a%7e`,
 *   `/%41`, `/.well-known/x`.
 * - Crudo (como llega): empieza con `/`; letras latinas (A-Z, a-z y las acentuadas de Latin-1 sin `×` ni `÷`), dígitos y `/ - _ . ~ %`.
 * - Decodificado (`decodeURIComponent`, una sola vez): empieza con `/`; letras latinas, dígitos, espacio y `/ - _ . ~`. Así `%XX`
 *   solo vale para escribir uno de esos signos o un espacio; un `%` que sobreviva (`%252f`, doble codificación), un control
 *   (`%00`, `%0a`), una barra invertida (`%5c`), un `@` o un `?` escrito como `%40` / `%3f` se rechazan.
 * - Estructura: ni `//` en ningún lugar de la ruta decodificada (cubre `//sitio`, `/%2f%2fsitio`, `///`, `/.//x`), ni segmentos
 *   `.` o `..` (tampoco escritos `%2e`), y una codificación `%XX` mal formada (`/%E0%A4%A`) se rechaza.
 * - Ejemplos que pasan: `/`, `/facturacion/comprobantes/3f2a…-uuid`, `/configuracion-fiscal/certificado-de-arca/homologacion`,
 *   `/archivo.pdf`, `/a/.oculto/b`, `/v1.2/x`, `/ñ`, `/a%20b`.
 *   Ejemplos que se rechazan: `//evil.com`, `/\evil.com`, `/%2f%2fevil.com`, `/%5cevil.com`, `/\t/evil.com`, `/\n/evil.com`,
 *   `https:evil.com`, `javascript:alert(1)`, `/／evil.com`, `/∕evil.com`, `/⁄evil.com`, `/․․/x`, `/‮x`, `/a%00b`, `/%252f`, `///`,
 *   `/.//evil`, `/@evil.com`, `/a/../b`.
 * - Cambia de comportamiento respecto de antes solo para direcciones que ninguna pantalla genera: una ruta con `,` `:` `;` `@` `!`
 *   `'` `(` `)` `$` `*` `+` `=` `&` escritos sin codificar en el camino, o un `%XX` que decodifica a algo fuera del conjunto
 *   (`%2B`, `%3A`, `%D0%B0`). Los enlaces del producto no los llevan.
 *
 * Chequeo: `ruta-propia.test.ts` (vectores de ataque, rutas reales y una violación inyectada por cada parte del conjunto) y la
 * mutación del archivo. El largo máximo de la dirección de retorno vive en `ruta-de-retorno.ts` (es del retorno, no de la ruta).
 * Puro: sin reloj ni azar.
 */

/** Letras latinas: Latin-1 sin `×` ni `÷` (la `ñ` de una ruta en español). */
const LETRAS = "A-Za-zÀ-ÖØ-öø-ÿ";
const DIGITOS = "0-9";

const CAMINO_CRUDO = new RegExp(`^/[${LETRAS}${DIGITOS}/._~%-]*$`);
const CAMINO_DECODIFICADO = new RegExp(`^/[${LETRAS}${DIGITOS} /._~-]*$`);

/**
 * Si `camino` (sin `?` ni `#`) es el de una ruta propia, devuelve su forma decodificada (`decodeURIComponent`, una vez), que es la
 * que miran quienes la usan para reconocer rutas reservadas (`/s`, `/ingreso`); si no lo es, `null`. Ver la ficha de arriba.
 */
export function caminoDeRutaPropia(camino: string): string | null {
  if (!CAMINO_CRUDO.test(camino)) return null;
  let decodificado: string;
  try {
    decodificado = decodeURIComponent(camino);
  } catch {
    return null;
  }
  if (decodificado.split("/").some((segmento) => segmento === "." || segmento === ".."))
    return null;
  if (decodificado.includes("//")) return null;
  return CAMINO_DECODIFICADO.test(decodificado) ? decodificado : null;
}
