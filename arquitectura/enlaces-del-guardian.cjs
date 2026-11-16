/**
 * El guardián dentro del grafo de importaciones del plan de mutación (sale de `planificar-mutacion.cjs`, que pasaba del tope de líneas de
 * `arquitectura/deuda`): qué archivos lee el guardián y cómo se enlazan a sus pruebas.
 */
const fs = require("node:fs");
const path = require("node:path");
const { ARCHIVO_DE_CI } = require("./analizar-ci.cjs");

/**
 * Lo que el grafo de importaciones NO ve del guardián: lo que sus pruebas copian a carpetas temporales, lanzan con `node` o leen como texto
 * (datos `*.json`, `.cjs` que solo corren como CLI, `evaluar-gate.cjs`, `reglas.cjs`, `ci.yml`). El código del guardián también se muta, así que
 * el mapa es EXPLÍCITO y grueso a propósito: toda prueba o auxiliar del guardián depende de TODOS esos archivos. Solo AGREGA dependencias.
 * El registro de decisiones (`DEC-NNNN.json`) entra acá: además de las del guardián lo leen solo `decisiones-*`, `nombre-del-producto`,
 * `grupos-de-mutacion` y `planificar-mutacion` (medido con `strace`); antes cada decisión nueva corría los ~97 grupos. Borrarla corre todo.
 */
const PRUEBAS_DEL_GUARDIAN =
  /^test\/arquitectura\/(?:guardian-|decisiones-|nombre-del-producto\.|grupos-de-mutacion\.|planificar-mutacion\.)[^/]*\.ts$/;
/** Las carpetas del guardián: el código de los contratos, el control de deuda técnica y el registro de decisiones. */
const CARPETAS_DEL_GUARDIAN = [
  "arquitectura/contratos",
  "arquitectura/deuda",
  "arquitectura/decisiones/registro",
];
const OTROS_ARCHIVOS_DEL_GUARDIAN = [
  "arquitectura/evaluar-gate.cjs",
  "arquitectura/reglas.cjs",
  // Sus pruebas leen el `ci.yml` real (el trabajo `guardian`, el `needs` del Gate) y lo alteran en memoria.
  ARCHIVO_DE_CI,
];

/**
 * Agrega al grafo los archivos que lee el guardián (para que un cambio en ellos no sea «desconocido») y la
 * dependencia de cada prueba o auxiliar del guardián sobre todos ellos.
 *
 * @param {Readonly<Record<string, readonly string[]>>} dependencias
 * @param {readonly string[]} archivosDelGuardian
 * @returns {Record<string, string[]>}
 */
function conEnlacesDelGuardian(dependencias, archivosDelGuardian) {
  const grafo = Object.fromEntries(
    Object.entries(dependencias).map(([archivo, importados]) => [archivo, [...importados]]),
  );
  for (const archivo of archivosDelGuardian) grafo[archivo] ??= [];
  for (const archivo of Object.keys(grafo)) {
    if (PRUEBAS_DEL_GUARDIAN.test(archivo)) {
      grafo[archivo] = [...new Set([...grafo[archivo], ...archivosDelGuardian])];
    }
  }
  return grafo;
}

/**
 * Los archivos que el guardián lee: las carpetas de arriba (los informes que generan no cuentan) y los otros archivos de `arquitectura/` que su verificador carga. Un archivo que falta en disco no se inventa.
 */
function leerArchivosDelGuardian(raiz) {
  const presentes = (archivo) =>
    fs.statSync(path.join(raiz, archivo), { throwIfNoEntry: false })?.isFile() === true;
  return [
    ...CARPETAS_DEL_GUARDIAN.flatMap((carpeta) => fs.globSync(`${carpeta}/**/*`, { cwd: raiz }))
      .map((archivo) => archivo.split(path.sep).join("/"))
      .filter((archivo) => !archivo.endsWith("/informe.json")),
    ...OTROS_ARCHIVOS_DEL_GUARDIAN,
  ]
    .filter(presentes)
    .sort();
}

module.exports = { conEnlacesDelGuardian, leerArchivosDelGuardian };
