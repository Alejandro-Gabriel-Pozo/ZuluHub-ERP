/**
 * Veredicto del job `Gate` (el chequeo requerido de `main`) a partir de `toJSON(needs)`.
 *
 * Previene dos fallos opuestos: (1) que un job fallido, cancelado o saltado por culpa de otro job
 * caído cuente como verde (`skipped` solo vale donde el flujo lo prevé); (2) que la mutación
 * saltada porque el PR no toca ningún grupo bloquee el merge. Ese «saltado por filtro» se
 * distingue de cualquier otro por la salida `hay` del plan, que solo es `false` si el plan terminó bien.
 * El chequeo que falla si se quita: `test/arquitectura/evaluar-gate.test.ts`.
 */

/** Jobs que siempre tienen que terminar en `success`. */
const OBLIGATORIOS = [
  "estatico",
  "pruebas",
  "seguridad",
  "flujos",
  "mutacion-plan",
  "web",
  "componentes",
];
/** Jobs que solo corren en pull requests: en push a main quedan `skipped`. */
const SOLO_EN_PULL_REQUEST = ["dependencias", "estabilidad"];

/**
 * @param {Readonly<Record<string, { result?: string, outputs?: Record<string, string> }>>} needs
 * @returns {string[]} motivos por los que el Gate debe fallar (vacío = verde)
 */
function evaluarGate(needs) {
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
  return problemas;
}

function principal() {
  const problemas = evaluarGate(JSON.parse(process.env["NEEDS"] ?? "{}"));
  if (problemas.length > 0) {
    process.stderr.write(`Gate en rojo:\n${problemas.map((p) => `- ${p}`).join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write("Gate en verde.\n");
}

module.exports = { evaluarGate, OBLIGATORIOS, SOLO_EN_PULL_REQUEST };

if (require.main === module) principal();
