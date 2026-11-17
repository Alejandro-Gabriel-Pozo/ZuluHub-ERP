/**
 * Lee un REGISTRO que vive como UNA CARPETA con UN ARCHIVO POR ENTRADA (`<id>.json`), en vez de un solo array en un `registro.json`.
 *
 * Previene: el choque que se repetía entre sesiones en paralelo (4 veces en un día, 13/11/2026): dos ramas agregaban una entrada al final del mismo
 * array (mismas líneas) y, en decisiones, elegían el mismo `DEC-NNNN` «siguiente». Con un archivo por entrada, dos entradas distintas no se tocan
 * nunca; si dos ramas eligen el mismo id, Git marca «agregado en los dos» sobre el mismo archivo y el control de id único también falla (nunca pasa en silencio).
 * Chequeo: `test/arquitectura/decisiones-registro-en-carpeta.test.ts` (cada caso de abajo con su violación inyectada).
 *
 * Todo nace cerrado (falla ante la duda): un archivo que no es `<id>.json`, una subcarpeta, un JSON roto o que no es un objeto, un nombre que no coincide
 * con el `id` de adentro, o un `registro.json` suelto al lado de la carpeta es una falla, nunca algo que se ignora. La FORMA de cada entrada (campos, tipos)
 * no se juzga acá: la juzga cada control (`decisiones/forma.cjs`, `deuda/entradas.cjs`).
 *
 * El array viejo (`registro.json`) ya no se lee nunca: si reaparece (una rama que partió de antes del cambio, o alguien que lo recrea), es una falla que lo nombra.
 */
const { Buffer } = require("node:buffer");
const fs = require("node:fs");
const path = require("node:path");

const ENTRADA = /^([^/]+)\.json$/;

const texto = (contenido) => Buffer.from(contenido).toString("utf8");

/** El orden del registro: por id, byte a byte, igual en todas las máquinas (sin depender de la configuración regional). Los ids son únicos (el nombre del archivo es el id). */
const porId = (a, b) => Buffer.compare(Buffer.from(a.id), Buffer.from(b.id));

/**
 * Lee el registro de `arbol` (`{ rutas, leer }`). Devuelve `{ ausente: true }` si la carpeta no tiene entradas (y no hay un array viejo suelto),
 * `{ errores: [{ archivo, motivo }] }` si algo no cumple, o `{ valor: entradas ordenadas por id }`.
 */
function leerRegistroEnCarpeta({ arbol, carpeta, monolito }) {
  const prefijo = `${carpeta}/`;
  const propias = arbol.rutas.filter((ruta) => ruta.startsWith(prefijo));
  const hayMonolito = arbol.rutas.includes(monolito);
  const errores = [];
  if (hayMonolito) {
    errores.push({
      archivo: monolito,
      motivo: `el registro es la carpeta ${carpeta}/ (un archivo por entrada): ${monolito} no puede estar ahí.`,
    });
  }
  if (propias.length === 0) return errores.length > 0 ? { errores } : { ausente: true };
  const valor = [];
  for (const ruta of propias) {
    const nombre = ruta.slice(prefijo.length);
    const coincide = ENTRADA.exec(nombre);
    if (coincide === null) {
      errores.push({
        archivo: ruta,
        motivo: `no es un archivo de entrada: en ${carpeta}/ solo van archivos «<id>.json», sin subcarpetas ni otros archivos.`,
      });
      continue;
    }
    const resultado = leerEntrada(arbol, ruta, coincide[1]);
    if (resultado.error !== undefined) errores.push({ archivo: ruta, motivo: resultado.error });
    else valor.push(resultado.entrada);
  }
  if (errores.length > 0) return { errores };
  return { valor: valor.sort(porId) };
}

function leerEntrada(arbol, ruta, idDelNombre) {
  const contenido = arbol.leer(ruta);
  if (contenido === null) return { error: "no se puede leer (el archivo no existe)." };
  let entrada;
  try {
    entrada = JSON.parse(texto(contenido));
  } catch (error) {
    return { error: `no se puede leer (${error.message}).` };
  }
  if (entrada === null || typeof entrada !== "object" || Array.isArray(entrada)) {
    return { error: "tiene que ser un objeto (una sola entrada), no una lista ni otro valor." };
  }
  if (entrada.id !== idDelNombre) {
    return {
      error: `el nombre del archivo tiene que ser el id de la entrada («${idDelNombre}.json» trae id ${JSON.stringify(entrada.id)}).`,
    };
  }
  return { entrada };
}

/** El árbol `{ rutas, leer }` de lo que hay en el disco bajo `carpeta` (y el `monolito`, si existe), para quien lee el registro sin pasar por git. */
function arbolDelDisco(raiz, carpeta, monolito) {
  const base = path.join(raiz, carpeta);
  const rutas = fs.existsSync(base)
    ? fs
        .readdirSync(base, { recursive: true, withFileTypes: true })
        .filter((entrada) => entrada.isFile())
        .map(
          (entrada) =>
            `${carpeta}/${path.relative(base, path.join(entrada.parentPath, entrada.name)).split(path.sep).join("/")}`,
        )
    : [];
  if (fs.existsSync(path.join(raiz, monolito))) rutas.push(monolito);
  return {
    rutas,
    leer: (ruta) => {
      try {
        return fs.readFileSync(path.join(raiz, ruta));
      } catch {
        return null;
      }
    },
  };
}

module.exports = { arbolDelDisco, leerRegistroEnCarpeta };
