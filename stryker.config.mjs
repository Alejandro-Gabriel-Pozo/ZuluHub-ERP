import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { cargarLosGrupos } = require("./arquitectura/grupos-de-mutacion.cjs");

/**
 * La configuración de Stryker. `mutate` NO se escribe acá: lo deriva `arquitectura/grupos-de-mutacion.cjs` de los grupos de `arquitectura/mutacion/` (un archivo por grupo),
 * así hay una sola lista y un grupo nuevo no toca este archivo (previene los choques entre sesiones en paralelo; ver el encabezado del cargador). El CI corre cada grupo con
 * `--mutate "<sus archivos>"`; la corrida completa (`npm run mutacion`) usa la lista derivada. Cada grupo exige 100 % (`thresholds.break`).
 * Es `.mjs` y no `.json` porque Stryker encuentra primero el `.json` si están los dos.
 */
export default {
  testRunner: "command",
  commandRunner: {
    command:
      "PEDERNAL_SIN_INTEGRACION=1 npx vitest run --project node --reporter=dot --bail=1 $PEDERNAL_FILTRO_PRUEBAS",
  },
  mutate: cargarLosGrupos(import.meta.dirname).mutate,
  coverageAnalysis: "off",
  reporters: ["clear-text", "progress", "html"],
  htmlReporter: { fileName: "reports/mutation/index.html" },
  tempDirName: ".stryker-tmp",
  cleanTempDir: true,
  timeoutMS: 30000,
  thresholds: { high: 100, low: 95, break: 100 },
  ignorePatterns: [".claude", "reports", ".stryker-tmp"],
};
