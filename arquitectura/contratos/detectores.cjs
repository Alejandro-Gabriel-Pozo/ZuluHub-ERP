/**
 * Detectores de texto para el registro de contratos: una expresión regular evaluada línea por línea.
 *
 * LÍMITES (valen para todo detector hecho con `porPatron`; cada contrato los repite en `limites` y
 * dice cómo se cubre lo que acá no se ve):
 *  - Mira UNA línea por vez: un uso partido en varias líneas (un import multilínea, una llamada
 *    cuyos argumentos están abajo) solo se ve si el patrón cae entera en una de ellas.
 *  - No distingue código de comentarios ni de cadenas: un comentario o un texto que contenga el
 *    patrón cuenta como uso (falso positivo); se corrige afinando el patrón, no silenciando.
 *  - No sigue valores: alias (`const { x: y } = …`), re-exportaciones, concatenaciones de texto,
 *    claves calculadas (`obj[nombre]`), `import()` dinámico ni código generado en tiempo de ejecución.
 *    Eso se cubre con una prueba de ejecución o de navegador, o se declara `limite: manual`.
 *  - Es independiente de dependency-cruiser y de TypeScript: el análisis es solo texto.
 */

/**
 * @param {{ tipo: "uso" | "definicion", clases: string[], patron: RegExp, nombre?: string }} datos
 */
function porPatron({ tipo, clases, patron, nombre }) {
  if (!(patron instanceof RegExp)) throw new Error("porPatron: «patron» tiene que ser una RegExp");
  // Sin banderas «g» ni «y»: con ellas `test` guarda estado entre líneas y salta coincidencias.
  const expresion = new RegExp(patron.source, patron.flags.replace(/[gy]/g, ""));
  return {
    tipo,
    clases,
    nombre: nombre ?? `patrón ${String(expresion)}`,
    reconoce(contenido) {
      const coincidencias = [];
      contenido.split(/\r\n|\n/).forEach((texto, indice) => {
        if (expresion.test(texto)) coincidencias.push({ linea: indice + 1, texto });
      });
      return coincidencias;
    },
  };
}

module.exports = { porPatron };
