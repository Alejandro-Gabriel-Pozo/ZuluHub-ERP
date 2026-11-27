/**
 * El fragmento de la suite que corre este proceso de pruebas, desde `PEDERNAL_FRAGMENTO` (`indice/total`, p. ej. `2/3`): lo lee `vitest.config.ts` y lo pasa a la opción `shard` de Vitest,
 * que reparte los archivos de prueba por el hash de su ruta en tramos parejos. Lo fija el CI en el job `pruebas`, que corre la suite en cuatro fragmentos en paralelo (cada uno con su propio Postgres).
 *
 * Previene: el timeout de un job monolítico al borde del límite (run 43989591478 del 17/11/2026: 20 min 16 s y 20 min 5 s cancelados) y que un fragmento mal escrito se ignore y corra la
 * suite entera (o nada): lo que no es exactamente `indice/total` con 1 <= indice <= total <= 99 hace fallar la carga de la configuración. Vacío o ausente = sin fragmentos (la suite entera, como en local).
 * Se usa la configuración y no `--shard` en el comando para que el paso del CI siga siendo `npm test` (lo que el guardián de contratos exige y fija en su matriz).
 * Chequeo que falla si se quita: `test/arquitectura/pruebas-en-shards.test.ts`.
 */
const FORMA = /^([1-9]\d?)\/([1-9]\d?)$/;

/** El valor para la opción `shard` de Vitest (`"i/n"`), o `undefined` si no se pidió ningún fragmento. Lanza si el valor no es `indice/total` válido. */
function fragmentoDeLaCorrida(valor) {
  if (valor === undefined || valor === "") return undefined;
  const m = FORMA.exec(valor);
  if (m === null || Number(m[1]) > Number(m[2])) {
    throw new Error(
      "PEDERNAL_FRAGMENTO tiene que ser `indice/total` con 1 <= indice <= total <= 99, por ejemplo 2/3.",
    );
  }
  return valor;
}

module.exports = { fragmentoDeLaCorrida };
