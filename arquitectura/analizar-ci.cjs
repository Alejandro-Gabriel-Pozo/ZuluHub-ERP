/**
 * Lectura y análisis del `ci.yml` para el plan de mutación (sale de `planificar-mutacion.cjs`, que pasaba del tope de líneas de
 * `arquitectura/deuda`): partir el archivo en cabecera y jobs, decidir si un cambio de CI puede afectar la mutación y leer sus dos
 * versiones (la de la base del PR y la del árbol). Es texto: no carga YAML.
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ARCHIVO_DE_CI = ".github/workflows/ci.yml";

/**
 * Un `ci.yml` partido en su cabecera (todo lo que no es un job: `on`, `permissions`, `concurrency`…) y el texto
 * de cada job. Es un análisis de TEXTO que entiende el estilo que Prettier impone al archivo (jobs a 2 espacios).
 * Devuelve `null` si no lo entiende (job duplicado, indentación rara, anclas o alias de YAML): quien llama lo
 * trata como «no se puede decir que no afecta», es decir, corre todo.
 *
 * @param {string} texto
 * @returns {{ cabecera: string, jobs: Map<string, string> } | null}
 */
function partirCi(texto) {
  const lineas = texto.replaceAll("\r", "").split("\n");
  const inicio = lineas.findIndex((linea) => /^jobs:\s*$/.test(linea));
  if (inicio < 0) return null;
  const conAnclas = lineas.some(
    (linea) =>
      /^\s*<<:/.test(linea) ||
      /:\s+[&*][A-Za-z0-9_-]+\s*(#.*)?$/.test(linea) ||
      /^\s*-\s+[&*][A-Za-z0-9_-]+\s*(#.*)?$/.test(linea),
  );
  if (conAnclas) return null;

  const cabecera = lineas.slice(0, inicio + 1);
  const bloques = new Map();
  let actual;
  for (const linea of lineas.slice(inicio + 1)) {
    if (/^\S/.test(linea)) {
      // Otra sección de primer nivel después de `jobs:`: cuenta como cabecera.
      cabecera.push(linea);
      actual = undefined;
      continue;
    }
    const abre = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(linea);
    if (abre?.[1] !== undefined) {
      if (bloques.has(abre[1])) return null;
      actual = [];
      bloques.set(abre[1], actual);
    } else if (linea.trim() === "" || linea.trimStart().startsWith("#")) {
      (actual ?? cabecera).push(linea);
    } else if (/^ {1,3}\S/.test(linea) || actual === undefined) {
      return null;
    } else {
      actual.push(linea);
    }
  }
  const sinFinal = (partes) => partes.join("\n").replace(/\s+$/, "");
  return {
    cabecera: sinFinal(cabecera),
    jobs: new Map([...bloques].map(([id, cuerpo]) => [id, sinFinal(cuerpo)])),
  };
}

/**
 * Jobs de `ci.yml` cuyo cambio NO puede alterar el resultado de la mutación de `src/` ni de
 * `arquitectura/contratos/`: cada uno corre una verificación distinta y nada de lo que hace llega a un grupo.
 * Quedan afuera a propósito `mutacion-plan` y `mutacion` (deciden y ejecutan la mutación) y cualquier job que
 * no figure acá (uno nuevo o renombrado se considera desconocido).
 */
const JOBS_AJENOS_A_LA_MUTACION = [
  "estatico",
  "guardian",
  "pruebas",
  "seguridad",
  "flujos",
  "dependencias",
  "estabilidad",
  "web",
  "componentes",
  "gate",
];

/**
 * ¿El cambio de `ci.yml` puede afectar lo que decide `ajenos`? Sí (`true`) si no se pueden leer las dos versiones,
 * si cambió la cabecera (eventos, permisos, concurrencia, variables globales) o si cambió, se agregó o se quitó
 * un job que no está en `ajenos`. Lo único que da `false` es un cambio confinado a jobs de `ajenos` (o ninguno).
 *
 * @param {{ antes: string | null, despues: string | null } | undefined} ci
 * @param {readonly string[]} ajenos
 */
function cambioDeCiAfecta(ci, ajenos) {
  if (ci === undefined || typeof ci.antes !== "string" || typeof ci.despues !== "string")
    return true;
  const antes = partirCi(ci.antes);
  const despues = partirCi(ci.despues);
  if (antes === null || despues === null) return true;
  if (antes.cabecera !== despues.cabecera) return true;
  const ids = new Set([...antes.jobs.keys(), ...despues.jobs.keys()]);
  for (const id of ids) {
    if (antes.jobs.get(id) !== despues.jobs.get(id) && !ajenos.includes(id)) return true;
  }
  return false;
}

/**
 * Las dos versiones de `ci.yml` que compara el plan: la de la base del PR (primer padre del commit de merge) y la
 * del árbol. `null` si no se puede leer una (por ejemplo, el archivo no existía en la base): quien decide lo
 * trata como un cambio que puede afectar.
 */
function leerCi(raiz) {
  const leer = (obtener) => {
    try {
      return obtener();
    } catch {
      return null;
    }
  };
  return {
    antes: leer(() =>
      execFileSync("git", ["show", `HEAD^1:${ARCHIVO_DE_CI}`], {
        cwd: raiz,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      }),
    ),
    despues: leer(() => fs.readFileSync(path.join(raiz, ARCHIVO_DE_CI), "utf8")),
  };
}

module.exports = { ARCHIVO_DE_CI, partirCi, JOBS_AJENOS_A_LA_MUTACION, cambioDeCiAfecta, leerCi };
