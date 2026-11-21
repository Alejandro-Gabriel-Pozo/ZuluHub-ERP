/**
 * Los grupos de mutación del guardián (los que mutan SOLO `arquitectura/*.cjs`: «guardián (…)», ~150 min declarados) no corren en un
 * pull request salvo que el PR toque el guardián; la nocturna, el push a `main` y el disparo manual corren TODOS (decisión del dueño,
 * 2026-11-17, opción A: parar la línea si la nocturna se pone roja).
 *
 * Previene: gastar ~150 min de máquina de mutación del guardián en PR que solo suman un DEC (26 % de los últimos 70 merges) o tocan
 * producto, donde el guardián no cambió. Un cambio en el guardián, en sus datos (contratos, deuda) o en sus pruebas SÍ los enciende.
 * Un DEC nuevo NO cuenta: es dato. Lo que el planificador no sabe clasificar sigue corriendo todo (fail-closed, ver `planificar`).
 * El chequeo que falla si se quita es `test/arquitectura/guardian-en-pr.test.ts`.
 */

/** Lo que cuenta como «tocar el guardián»: lista de lo que SÍ enciende los grupos (el resto no). */
const TOCAN_EL_GUARDIAN = [
  /^arquitectura\/.*\.cjs$/,
  /^arquitectura\/contratos\//,
  /^arquitectura\/deuda\//,
  /^test\/arquitectura\//,
  /^\.github\/workflows\//,
];

/** Un grupo es del guardián si TODO lo que muta vive en `arquitectura/`. */
const esDelGuardian = ({ expandidos }) =>
  expandidos.length > 0 && expandidos.every((entrada) => entrada.startsWith("arquitectura/"));

/** Los grupos que entran al plan de un PR: sin los del guardián si el PR no lo toca. */
function gruposDelPlan(grupos, cambios) {
  if (cambios.some((cambio) => TOCAN_EL_GUARDIAN.some((patron) => patron.test(cambio))))
    return grupos;
  return grupos.filter((grupo) => !esDelGuardian(grupo));
}

module.exports = { gruposDelPlan };
