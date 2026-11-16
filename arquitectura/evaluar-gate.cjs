/**
 * Veredicto del job `Gate` (el chequeo requerido de `main`) a partir de `toJSON(needs)`.
 *
 * Previene dos fallos opuestos: (1) que un job fallido, cancelado o saltado por culpa de otro job
 * caído cuente como verde (`skipped` solo vale donde el flujo lo prevé); (2) que la mutación
 * saltada porque el PR no toca ningún grupo bloquee el merge. Ese «saltado por filtro» se
 * distingue de cualquier otro por la salida `hay` del plan, que solo es `false` si el plan terminó bien.
 * Con `estabilidad` (la integración repetida 12 veces) pasa lo mismo, con una condición más: solo se acepta
 * saltada en un pull request y si el plan terminó bien y dijo `estabilidad == "false"`. En push a `main` y en
 * la corrida nocturna tiene que dar `success`, diga lo que diga el plan.
 * El chequeo que falla si se quita: `test/arquitectura/evaluar-gate.test.ts`.
 */

/** Jobs que siempre tienen que terminar en `success`. */
const OBLIGATORIOS = [
  "estatico",
  "guardian",
  "pruebas",
  "seguridad",
  "flujos",
  "mutacion-plan",
  "web",
  "componentes",
  "recorrido",
];
/** Jobs que solo corren en pull requests: en push a main quedan `skipped`. */
const SOLO_EN_PULL_REQUEST = ["dependencias"];

/**
 * @param {Readonly<Record<string, { result?: string, outputs?: Record<string, string> }>>} needs
 * @param {string} [evento] el evento que disparó la corrida (`github.event_name`); sin él, nada se acepta saltado por filtro
 * @returns {string[]} motivos por los que el Gate debe fallar (vacío = verde)
 */
function evaluarGate(needs, evento) {
  const problemas = [];
  const resultado = (job) => needs[job]?.result;

  for (const job of OBLIGATORIOS) {
    if (resultado(job) !== "success") problemas.push(`${job}: ${resultado(job) ?? "ausente"}`);
  }
  for (const job of SOLO_EN_PULL_REQUEST) {
    if (resultado(job) !== "success" && resultado(job) !== "skipped") {
      problemas.push(`${job}: ${resultado(job) ?? "ausente"}`);
    }
  }
  const filtradoPorElPlan =
    resultado("mutacion-plan") === "success" &&
    needs["mutacion-plan"]?.outputs?.["hay"] === "false";
  const mutacionAceptable =
    resultado("mutacion") === "success" ||
    (filtradoPorElPlan && resultado("mutacion") === "skipped");
  if (!mutacionAceptable) problemas.push(`mutacion: ${resultado("mutacion") ?? "ausente"}`);

  const estabilidadFiltrada =
    evento === "pull_request" &&
    resultado("mutacion-plan") === "success" &&
    needs["mutacion-plan"]?.outputs?.["estabilidad"] === "false";
  const estabilidadAceptable =
    resultado("estabilidad") === "success" ||
    (estabilidadFiltrada && resultado("estabilidad") === "skipped");
  if (!estabilidadAceptable) {
    problemas.push(`estabilidad: ${resultado("estabilidad") ?? "ausente"}`);
  }
  return problemas;
}

/** Un SHA de git completo: lo único que se acepta como «cabeza» (lo que no tiene esta forma no cuenta, y el Gate evalúa normal). */
const SHA = /^[0-9a-f]{40}$/;

/**
 * ¿Esta corrida fue REEMPLAZADA por otra más nueva de la misma rama o PR? Solo si se cumplen TODAS: el evento es un pull request o un push (la
 * nocturna nunca), la cabeza actual de la rama y la de esta corrida son SHA válidos y DISTINTOS (la rama ya avanzó), ningún job FALLÓ, y al menos uno fue
 * cancelado (lo que hace `concurrency` al llegar un push nuevo). Cualquier duda (no se pudo leer la cabeza, mismo commit, un job fallido o ausente) da
 * `false`: el Gate evalúa normal y sigue en rojo.
 * Previene: 24 de 29 Gates rojos (13-15/11/2026) eran solo corridas reemplazadas; un rojo sobre un commit viejo parece una falla y esconde las reales.
 * NO se usa `!cancelled()`: con la corrida del head actual cancelada a mano, el Gate quedaría omitido, y un job omitido cuenta como éxito para
 * la protección de ramas. Con `always()` el Gate corre siempre y, con el commit vigente, cancelado o con timeout (el SHA no cambió), sigue en rojo.
 *
 * @param {{ needs: Readonly<Record<string, { result?: string }>>, evento?: string, actual?: string, deEstaCorrida?: string }} entrada
 * @returns {boolean}
 */
function corridaReemplazada({ needs, evento, actual = "", deEstaCorrida = "" }) {
  if (evento !== "pull_request" && evento !== "push") return false;
  if (!SHA.test(actual) || !SHA.test(deEstaCorrida) || actual === deEstaCorrida) return false;
  const resultados = Object.values(needs).map((job) => job?.result);
  if (
    resultados.some(
      (resultado) =>
        resultado !== "success" && resultado !== "cancelled" && resultado !== "skipped",
    )
  ) {
    return false;
  }
  return resultados.includes("cancelled");
}

function principal() {
  const needs = JSON.parse(process.env["NEEDS"] ?? "{}");
  const problemas = evaluarGate(needs, process.env["EVENTO"]);
  const reemplazada = corridaReemplazada({
    needs,
    evento: process.env["EVENTO"],
    actual: process.env["CABEZA_ACTUAL"],
    deEstaCorrida: process.env["CABEZA_DE_ESTA_CORRIDA"],
  });
  if (problemas.length > 0 && reemplazada) {
    process.stdout.write(
      `::notice::Corrida reemplazada: la rama ya avanzó a ${process.env["CABEZA_ACTUAL"]} y esta corrida (de ${process.env["CABEZA_DE_ESTA_CORRIDA"]}) se canceló. No es un resultado de este commit; el que cuenta es el de la corrida nueva.\n`,
    );
    return;
  }
  if (problemas.length > 0) {
    process.stderr.write(`Gate en rojo:\n${problemas.map((p) => `- ${p}`).join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write("Gate en verde.\n");
}

module.exports = { evaluarGate, corridaReemplazada, OBLIGATORIOS, SOLO_EN_PULL_REQUEST };

if (require.main === module) principal();
