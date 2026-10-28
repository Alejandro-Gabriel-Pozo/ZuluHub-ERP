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

function principal() {
  const problemas = evaluarGate(JSON.parse(process.env["NEEDS"] ?? "{}"), process.env["EVENTO"]);
  if (problemas.length > 0) {
    process.stderr.write(`Gate en rojo:\n${problemas.map((p) => `- ${p}`).join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write("Gate en verde.\n");
}

module.exports = { evaluarGate, OBLIGATORIOS, SOLO_EN_PULL_REQUEST };

if (require.main === module) principal();
