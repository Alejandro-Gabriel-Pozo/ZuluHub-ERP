/**
 * Empaqueta los grupos de mutación que el plan eligió en JOBS del CI: los grupos chicos van juntos en un mismo job y los grandes quedan solos.
 *
 *     node arquitectura/empaquetar-mutacion.cjs        (en el job `mutacion-plan`, después de `planificar-mutacion.cjs`)
 *
 * Previene: pagar el arranque de un job (checkout, Node, `npm ci`, cierre: ~1 min medido) por cada uno de los ~97 grupos, la mitad de los cuales dura menos de
 * 3 minutos (13-15/11/2026: 6.497 min de arranque sobre 37.983 de mutación, y 97 jobs compitiendo por ~40 máquinas). Agrupados en paquetes de hasta
 * `TOPE_DE_MINUTOS_DECLARADOS` min declarados salen ~44 jobs en lugar de 97 y el camino crítico no cambia (sigue siendo el grupo más largo, que va solo).
 *
 * NO cambia qué se muta ni con qué pruebas: cada grupo conserva su `--mutate`, su filtro de pruebas y el umbral de 100 % (`correr-paquete-de-mutacion.cjs` corre una
 * vez Stryker por grupo, una tras otra). Todo grupo del plan sale en exactamente un paquete (se comprueba antes de escribir la salida); un grupo sin minutos
 * conocidos corre solo, y primero (lo desconocido se supone largo). Lee `grupos=` de `$GITHUB_OUTPUT` (el plan) y agrega `paquetes=`.
 * Chequeo que falla si se quita: `test/arquitectura/empaquetar-mutacion.test.ts`.
 */
const fs = require("node:fs");
const path = require("node:path");
const { cargarLosGrupos } = require("./grupos-de-mutacion.cjs");

/** Minutos DECLARADOS (`arquitectura/mutacion/*.json`) que suma como máximo un paquete. Con los datos del 13-15/11/2026: 44 jobs, el más largo = el grupo más largo. */
const TOPE_DE_MINUTOS_DECLARADOS = 8;

/** El nombre del job: el primer grupo y, si hay más, cuántos van con él. Cada grupo igual se nombra en el log, en el resumen y en cada falla. */
const etiquetaDe = (grupos) =>
  grupos.length === 1 ? grupos[0].grupo : `${grupos[0].grupo} y ${grupos.length - 1} más`;

const esMinutosValido = (m) => typeof m === "number" && Number.isFinite(m) && m > 0;

/**
 * @param {readonly { grupo: string, archivos: string, pruebas: string }[]} grupos los que eligió el plan
 * @param {ReadonlyMap<string, number>} minutosDe minutos declarados por nombre de grupo
 * @param {number} [tope]
 * @returns {{ etiqueta: string, grupos: { grupo: string, archivos: string, pruebas: string }[] }[]}
 */
function empaquetar(grupos, minutosDe, tope = TOPE_DE_MINUTOS_DECLARADOS) {
  const solos = [];
  const conocidos = [];
  for (const grupo of grupos) {
    const minutos = minutosDe.get(grupo.grupo);
    if (!esMinutosValido(minutos) || minutos > tope) solos.push([grupo]);
    else conocidos.push({ grupo, minutos });
  }
  // Primero el más largo (First-Fit Decreasing); el orden estable conserva el del plan en los empates.
  conocidos.sort((a, b) => b.minutos - a.minutos);
  const paquetes = [];
  for (const { grupo, minutos } of conocidos) {
    const cabe = paquetes.find((p) => p.minutos + minutos <= tope);
    if (cabe === undefined) paquetes.push({ minutos, grupos: [grupo] });
    else {
      cabe.minutos += minutos;
      cabe.grupos.push(grupo);
    }
  }
  const minutosDelPaquete = (p) => p.reduce((s, g) => s + (minutosDe.get(g.grupo) ?? 0), 0);
  return [...solos, ...paquetes.map((p) => p.grupos)]
    .sort((a, b) => {
      // Los desconocidos primero, después por minutos descendentes: el job largo arranca antes y no deja la cola al final.
      const desconocido = (p) => (p.some((g) => !esMinutosValido(minutosDe.get(g.grupo))) ? 1 : 0);
      return desconocido(b) - desconocido(a) || minutosDelPaquete(b) - minutosDelPaquete(a);
    })
    .map((p) => ({ etiqueta: etiquetaDe(p), grupos: p }));
}

/** Los grupos que dejó el plan en el archivo de salidas del job (la última línea `grupos=`). Falla si no está o no es una lista. */
function gruposDelPlan(texto) {
  const linea = texto
    .split("\n")
    .filter((l) => l.startsWith("grupos="))
    .at(-1);
  if (linea === undefined) throw new Error("el plan no dejó `grupos=` en $GITHUB_OUTPUT.");
  const valor = JSON.parse(linea.slice("grupos=".length));
  if (!Array.isArray(valor)) throw new Error("`grupos=` del plan no es una lista.");
  return valor;
}

function principal() {
  const salida = process.env["GITHUB_OUTPUT"];
  if (salida === undefined || salida === "") {
    process.stderr.write("Falta $GITHUB_OUTPUT: este paso corre dentro del job `mutacion-plan`.\n");
    process.exit(2);
  }
  const plan = gruposDelPlan(fs.readFileSync(salida, "utf8"));
  const minutosDe = new Map(
    cargarLosGrupos(path.resolve(".")).grupos.map((g) => [g.grupo, g.minutos]),
  );
  const paquetes = empaquetar(plan, minutosDe);
  const enPaquetes = paquetes.flatMap((p) => p.grupos.map((g) => g.grupo)).sort();
  const delPlan = plan.map((g) => g.grupo).sort();
  if (JSON.stringify(enPaquetes) !== JSON.stringify(delPlan)) {
    throw new Error(
      "los paquetes no tienen exactamente los grupos del plan: no se escribe la salida.",
    );
  }
  fs.appendFileSync(salida, `paquetes=${JSON.stringify(paquetes)}\n`);
  process.stdout.write(
    [
      `Mutación: ${plan.length} grupo(s) del plan en ${paquetes.length} job(s).`,
      ...paquetes.map((p, i) => `- job ${i + 1}: ${p.grupos.map((g) => g.grupo).join(" | ")}`),
    ].join("\n") + "\n",
  );
}

module.exports = { empaquetar, etiquetaDe, gruposDelPlan, TOPE_DE_MINUTOS_DECLARADOS };

if (require.main === module) principal();
