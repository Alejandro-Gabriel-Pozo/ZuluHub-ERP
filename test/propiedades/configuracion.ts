import fc from "fast-check";

/**
 * Configuración común de las pruebas de propiedades. En el CI la semilla es aleatoria y fast-check
 * la imprime ante una falla (se reproduce con `FC_SEMILLA=<n>`). La mutación fija una semilla para
 * que dos corridas comparen lo mismo.
 */
const semilla = process.env["FC_SEMILLA"];

fc.configureGlobal({
  numRuns: 300,
  ...(semilla === undefined ? {} : { seed: Number.parseInt(semilla, 10) }),
});
