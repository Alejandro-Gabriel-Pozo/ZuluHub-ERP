import fc from "fast-check";
import { vi } from "vitest";

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

/**
 * Las pruebas de propiedades generan cientos de casos por prueba y con la máquina cargada pasan de los
 * 5 s por defecto de vitest: falla por tiempo, no por el código (pasó con `activos.propiedades` en
 * cada gate). Cada archivo que importa esta configuración sube su tope a 30 s; la regla que verifican
 * no cambia.
 */
vi.setConfig({ testTimeout: 30_000 });
