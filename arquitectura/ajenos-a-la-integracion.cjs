/**
 * Los archivos que `vitest run test/integracion` (el job `Estabilidad`) no lee: cambiarlos no puede alterar la integración. La lista es EXPLÍCITA y vive
 * en `ajenos-a-la-integracion.json` (globs); lo que no figura sigue siendo «no explicado» y corre (fail-closed).
 *
 * Previene: gastar ~50 min de máquina de Estabilidad en un PR que solo cambia una decisión o un dato de la mutación (16 de 61 disparos en 80 PR).
 * Si la integración llega a leer alguno, se saca de la lista. El chequeo que falla si se quita es `test/arquitectura/estabilidad-ajenos.test.ts`.
 */
const path = require("node:path");

/** Con la forma de un patrón (`test`) para usarse junto a las expresiones regulares de `planificar-mutacion.cjs`. */
module.exports = require("./ajenos-a-la-integracion.json").map((glob) => ({
  test: (cambio) => path.posix.matchesGlob(cambio, glob),
}));
