/**
 * Matcher de globs mínimo del guardián de contratos (sin dependencias nuevas).
 *
 * Sintaxis soportada, y nada más:
 *  - `*`  cualquier cantidad de caracteres que no sean `/` (dentro de un solo segmento);
 *  - `?`  exactamente un carácter que no sea `/`;
 *  - `**` solo como segmento completo: `**` / (cero o más carpetas) al principio o en el medio, y
 *    `/**` al final (todo lo que cuelga de la carpeta, al menos un archivo).
 *
 * Todo lo demás es literal. Los puntos no son especiales: `*.md` calza `.claude/x.md` y `.md`.
 * Las llaves, los corchetes, los paréntesis y la negación (`!`) NO existen: un patrón que los usa
 * se rechaza al compilar, en vez de interpretarse mal en silencio. La comparación distingue
 * mayúsculas. Las rutas son relativas a la raíz del repositorio y usan `/`.
 */

const CARACTERES_PROHIBIDOS = /[{}[\]()!\\]/;
// Todos los metacaracteres de RegExp que pueden llegar como literales a `segmentoARegexp`
// (`*` y `?` ya se tratan antes como comodines del glob). `compilar` rechaza antes `\ { } [ ] ( )`,
// pero el escapado no depende de eso: es defensa en profundidad.
const ESPECIALES_DE_REGEXP = /[.+^$|\\{}()[\]]/g;

/**
 * Convierte un segmento sin `**` en su expresión regular (sin anclas). Se exporta para probar el
 * escapado directo, también con los caracteres que `compilar` rechaza antes de llegar acá.
 */
function segmentoARegexp(segmento) {
  let salida = "";
  for (const caracter of segmento) {
    if (caracter === "*") salida += "[^/]*";
    else if (caracter === "?") salida += "[^/]";
    else salida += caracter.replace(ESPECIALES_DE_REGEXP, "\\$&");
  }
  return salida;
}

/** Compila un glob a RegExp. Lanza `Error` si el patrón está mal formado. */
function compilar(glob) {
  if (typeof glob !== "string" || glob.trim() === "") {
    throw new Error("el glob está vacío");
  }
  if (CARACTERES_PROHIBIDOS.test(glob)) {
    throw new Error(
      `el glob «${glob}» usa llaves, corchetes, paréntesis, «!» o «\\»: no se soportan`,
    );
  }
  const segmentos = glob.split("/");
  let expresion = "^";
  segmentos.forEach((segmento, indice) => {
    const ultimo = indice === segmentos.length - 1;
    if (segmento === "") {
      throw new Error(`el glob «${glob}» tiene un segmento vacío (barra inicial, final o doble)`);
    }
    if (segmento === "**") {
      expresion += ultimo ? ".+" : "(?:[^/]+/)*";
      return;
    }
    if (segmento.includes("**")) {
      throw new Error(
        `el glob «${glob}» usa «**» dentro de un segmento: solo vale como segmento entero`,
      );
    }
    expresion += segmentoARegexp(segmento) + (ultimo ? "" : "/");
  });
  return new RegExp(`${expresion}$`);
}

/**
 * `true` si el texto es una ruta de archivo exacta: sin comodines (`*`, `?`, llaves) ni formas
 * ambiguas. Los corchetes y paréntesis son literales a propósito: las carpetas de Next.js los usan
 * (`[...todo]`, `(entrada)`) y una ruta exacta se compara por igualdad, nunca como patrón.
 */
function esRutaExacta(ruta) {
  if (typeof ruta !== "string" || ruta.trim() === "" || ruta !== ruta.trim()) return false;
  if (/[*?{}\\]/.test(ruta)) return false;
  if (ruta.startsWith("/") || ruta.endsWith("/") || ruta.includes("//")) return false;
  return !ruta.split("/").some((segmento) => segmento === "." || segmento === "..");
}

module.exports = { compilar, esRutaExacta, segmentoARegexp };
