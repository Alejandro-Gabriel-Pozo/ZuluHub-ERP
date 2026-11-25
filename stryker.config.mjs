import { createRequire } from "node:module";
import process from "node:process";

const require = createRequire(import.meta.url);
const { cargarLosGrupos } = require("./arquitectura/grupos-de-mutacion.cjs");

/** El umbral de esta corrida: el del nivel del grupo (variable) o, sin ella, 100. Un valor que no es un entero de 1 a 100 lanza: no se corre con otro. */
function umbralDeLaCorrida(texto) {
  if (texto === undefined || texto === "") return 100;
  const umbral = /^[0-9]{1,3}$/.test(texto) ? Number(texto) : Number.NaN;
  if (!(Number.isInteger(umbral) && umbral >= 1 && umbral <= 100)) {
    throw new Error("PEDERNAL_UMBRAL_DE_MUTACION tiene que ser un entero de 1 a 100.");
  }
  return umbral;
}

/**
 * La configuración de Stryker. `mutate` NO se escribe acá: lo deriva `arquitectura/grupos-de-mutacion.cjs` de los grupos de `arquitectura/mutacion/` (un archivo por grupo),
 * así hay una sola lista y un grupo nuevo no toca este archivo (previene los choques entre sesiones en paralelo; ver el encabezado del cargador). El CI corre cada grupo con
 * `--mutate "<sus archivos>"` y el umbral de su nivel en `PEDERNAL_UMBRAL_DE_MUTACION` (`arquitectura/niveles-de-mutacion.json`: CRITICO 100 %, SERVIDOR 90 %, PANTALLA 70 %);
 * sin esa variable (la corrida completa local, `npm run mutacion`) exige 100 %, el más estricto: nunca se relaja por omisión.
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
  thresholds: {
    high: 100,
    low: 95,
    break: umbralDeLaCorrida(process.env.PEDERNAL_UMBRAL_DE_MUTACION),
  },
  ignorePatterns: [".claude", "reports", ".stryker-tmp"],
};
