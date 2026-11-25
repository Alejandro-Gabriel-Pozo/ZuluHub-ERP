/**
 * Veredicto del job `Gate` (el chequeo requerido de `main`) a partir de `toJSON(needs)`.
 *
 * Previene dos fallos opuestos: (1) que un job fallido, cancelado o saltado por culpa de otro job
 * caído cuente como verde (`skipped` solo vale donde el flujo lo prevé); (2) que la mutación
 * saltada porque el PR no toca ningún grupo bloquee el merge. Ese «saltado por filtro» se
 * distingue de cualquier otro por la salida `hay` del plan, que solo es `false` si el plan terminó bien.
 * Con `estabilidad` (la integración repetida: 3 veces en un pull request, 12 en la nocturna y a pedido) pasa lo mismo, con una condición más: solo se acepta
 * saltada en un pull request y si el plan terminó bien y dijo `estabilidad == "false"`. En la corrida nocturna y a
 * pedido tiene que dar `success`, diga lo que diga el plan.
 * En push a `main` corre solo lo rápido: el plan, la mutación y Estabilidad se aceptan SALTADOS (`SALTABLES_EN_PUSH`) y solo ahí;
 * si corrieron tienen que dar `success`, y todo lo demás (estático, guardián, pruebas, seguridad, flujos, web, componentes,
 * recorrido) sigue siendo obligatorio. Previene: ~795 min de máquina por merge repitiendo lo que ya corrió en el PR (28 % del
 * consumo medido el 13-16/11/2026) sin dejar pasar un push a main con las pruebas en rojo ni con un job saltado por otra causa.
 * CI liviano (dueño, 25/11/2026): en un pull request hacia la rama de integración (`BASE_DE_INTEGRACION`) la mutación, Estabilidad y, si el cambio no toca la web
 * (`toca_web == "false"`), la compilación de la web, los componentes y el recorrido corren solo de noche. Se aceptan SALTADOS únicamente si se cumplen las cuatro:
 * evento `pull_request`, base exacta de integración (`BASE_DEL_PR`, del contexto de GitHub, no de una salida), el plan terminó bien y dijo `liviano == "true"` y,
 * para los tres de la web, dijo `toca_web == "false"`. Cualquier otra combinación (un pull request hacia `main`, un `toca_web` vacío o `true`, un plan caído, la
 * nocturna) los deja en rojo (fail-closed). Previene: 60 chequeos y 30 a 60 minutos por pull request con muchas sesiones en paralelo, sin que un salto por otra causa
 * pase por verde. El chequeo que falla si se quita: `test/arquitectura/evaluar-gate.test.ts`.
 */

/** La rama de integración (misma constante que `planificar-mutacion.cjs`: una sola fuente). */
const { BASE_DE_INTEGRACION } = require("./planificar-mutacion.cjs");

/** Jobs de la web: en el CI liviano se aceptan saltados si el cambio no toca la web. */
const DE_LA_WEB = ["web", "componentes", "recorrido"];

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
/** Jobs que en push a `main` NO corren (`if: github.event_name != 'push'`); en cualquier otro evento tienen que correr y dar `success`. */
const SALTABLES_EN_PUSH = ["mutacion-plan", "mutacion", "estabilidad"];

/**
 * @param {Readonly<Record<string, { result?: string, outputs?: Record<string, string> }>>} needs
 * @param {string} [evento] el evento que disparó la corrida (`github.event_name`); sin él, nada se acepta saltado por filtro
 * @param {string} [base] la rama base del pull request (`github.base_ref`); sin ella, el CI liviano no se reconoce
 * @returns {string[]} motivos por los que el Gate debe fallar (vacío = verde)
 */
function evaluarGate(needs, evento, base) {
  const problemas = [];
  const resultado = (job) => needs[job]?.result;
  // Solo con el evento `push` y solo para los tres jobs declarados, y solo `skipped` (un `failure` o un `cancelled` siguen en rojo).
  const saltadoEnPush = (job) =>
    evento === "push" && SALTABLES_EN_PUSH.includes(job) && resultado(job) === "skipped";

  const planTerminoBien = resultado("mutacion-plan") === "success";
  const salidaDelPlan = (nombre) => needs["mutacion-plan"]?.outputs?.[nombre];
  const liviano =
    evento === "pull_request" &&
    base === BASE_DE_INTEGRACION &&
    planTerminoBien &&
    salidaDelPlan("liviano") === "true";
  const webSaltada = (job) =>
    liviano &&
    salidaDelPlan("toca_web") === "false" &&
    DE_LA_WEB.includes(job) &&
    resultado(job) === "skipped";

  for (const job of OBLIGATORIOS) {
    if (resultado(job) !== "success" && !saltadoEnPush(job) && !webSaltada(job)) {
      problemas.push(`${job}: ${resultado(job) ?? "ausente"}`);
    }
  }
  for (const job of SOLO_EN_PULL_REQUEST) {
    if (resultado(job) !== "success" && resultado(job) !== "skipped") {
      problemas.push(`${job}: ${resultado(job) ?? "ausente"}`);
    }
  }
  const filtradoPorElPlan = planTerminoBien && salidaDelPlan("hay") === "false";
  const mutacionAceptable =
    resultado("mutacion") === "success" ||
    saltadoEnPush("mutacion") ||
    (filtradoPorElPlan && resultado("mutacion") === "skipped");
  if (!mutacionAceptable) problemas.push(`mutacion: ${resultado("mutacion") ?? "ausente"}`);

  const estabilidadFiltrada =
    evento === "pull_request" && planTerminoBien && salidaDelPlan("estabilidad") === "false";
  const estabilidadAceptable =
    resultado("estabilidad") === "success" ||
    saltadoEnPush("estabilidad") ||
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
  const problemas = evaluarGate(needs, process.env["EVENTO"], process.env["BASE_DEL_PR"]);
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

module.exports = {
  evaluarGate,
  DE_LA_WEB,
  corridaReemplazada,
  OBLIGATORIOS,
  SOLO_EN_PULL_REQUEST,
  SALTABLES_EN_PUSH,
};

if (require.main === module) principal();
