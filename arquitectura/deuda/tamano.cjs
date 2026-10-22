/**
 * El tamaño de un archivo de código (contratos-arquitectonicos.md §10, G5): un archivo que pasa del tope de líneas
 * es deuda (`archivo-grande`). Es puro: recibe la ruta, el texto y las opciones.
 *
 * QUÉ SE MIDE. Código que escribe una persona: los archivos de programa (`.ts .tsx .mts .cts .js .jsx .mjs .cjs`)
 * de `src/`, `apps/` y los `.cjs` de `arquitectura/`. Quedan fuera, a propósito:
 *  - las pruebas (`*.test.*` y `test/`): son suites largas por naturaleza, y medirlas sumaría casi doscientos
 *    archivos de línea base; sumarlas es una decisión del dueño, no un detalle del detector;
 *  - los archivos de datos (`.json`, `.sql`, `.css`, los bloqueos y generados): no son programa;
 *  - los archivos de datos escritos en TypeScript, que no se distinguen por la extensión: una lista EXPLÍCITA en
 *    `configuracion.json` (`excluidosDelTope`, cada una con su motivo) que la vigilancia no deja crecer.
 *
 * CÓMO SE CUENTA. Una línea por cada salto de línea, más la última si el texto no termina en salto (como `wc -l`
 * redondeado hacia arriba); un archivo vacío mide 0.
 */

/** El tope de líneas por archivo con el que arranca el control (el valor vigente lo trae `configuracion.json`). */
const TOPE_DE_LINEAS = 400;

/** Las opciones con las que se mide si nadie dice otra cosa: el tope de arranque y ninguna exclusión. */
const OPCIONES_POR_DEFECTO = Object.freeze({ topeDeLineas: TOPE_DE_LINEAS, excluidos: new Set() });

const ES_CODIGO_MEDIDO = /^(?:(?:src|apps)\/.+\.[cm]?[jt]sx?|arquitectura\/.+\.cjs)$/;
const ES_DE_PRUEBA = /\.test\.[cm]?[jt]sx?$/;

/** Cuántas líneas tiene el texto. */
function lineasDe(texto) {
  const saltos = texto.split("\n").length - 1;
  return texto === "" || texto.endsWith("\n") ? saltos : saltos + 1;
}

/**
 * Si el archivo pasa del tope: `{ linea, tamano }` con la primera línea de más (`tope + 1`) y su tamaño; si no
 * (o si no se mide), `null`.
 *
 * @param {string} ruta Relativa a la raíz, con `/`.
 * @param {string} texto
 * @param {{ topeDeLineas: number, excluidos: ReadonlySet<string> }} opciones
 */
function tamanoExcedido(ruta, texto, { topeDeLineas, excluidos }) {
  if (!ES_CODIGO_MEDIDO.test(ruta) || ES_DE_PRUEBA.test(ruta) || excluidos.has(ruta)) {
    return null;
  }
  const tamano = lineasDe(texto);
  return tamano > topeDeLineas ? { linea: topeDeLineas + 1, tamano } : null;
}

module.exports = { OPCIONES_POR_DEFECTO, TOPE_DE_LINEAS, lineasDe, tamanoExcedido };
