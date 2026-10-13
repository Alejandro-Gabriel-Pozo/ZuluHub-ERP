/**
 * Planificador de la mutación en los pull requests: decide qué grupos de `grupos-de-mutacion.json`
 * corren y con qué archivos, a partir de los archivos que cambió el PR y del grafo de importaciones.
 *
 * Previene: que un PR deje sin re-mutar un archivo de dominio cuyo resultado cambió por algo que
 * NO es él mismo (una primitiva que importa, un auxiliar de pruebas compartido, el cuerpo de una
 * prueba). El modo `--incremental` de Stryker no lo ve: solo compara el texto del archivo mutado y
 * el de cada `it`, y con `coverageAnalysis: "off"` reutiliza todo. Acá la regla es otra y se puede
 * razonar: un archivo mutado D queda afectado si alguna prueba t que lo importa (directa o
 * indirectamente) tiene en su cierre de importaciones algún archivo cambiado. Si D no está
 * afectado, ni su código ni ninguna prueba que lo cubre ni lo que esas pruebas importan cambió:
 * el resultado de sus mutantes no puede haber cambiado.
 *
 * Cualquier cosa que el grafo no explica (un archivo que no es TypeScript de `src/` o `test/`, uno
 * borrado, la configuración) hace correr TODOS los grupos completos: ante la duda, no se saltea.
 * El chequeo que falla si se quita una de estas decisiones es `test/arquitectura/planificar-mutacion.test.ts`.
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

/** Cambios que ninguna prueba unitaria lee: no alteran ningún resultado de mutación. */
const IGNORABLES = [
  /\.md$/,
  /^migraciones\//, // solo las lee la integración, que la mutación no corre (ZULUHUB_SIN_INTEGRACION=1)
  /^\.github\/dependabot\.yml$/,
  /^\.gitleaks\.toml$/,
  /^skills-lock\.json$/,
];

/**
 * Lo que vitest ejecuta antes de TODAS las pruebas: entra en el alcance de cada una. Solo el archivo
 * mismo: lo que importa corre en el proceso principal, sin el mutante activo, y no cambia el resultado.
 */
const RAICES_GLOBALES = ["test/integracion/global.ts"];

const esPrueba = (archivo) => archivo.endsWith(".test.ts");

/** Cierre de importaciones de `archivo` (incluido él mismo). */
function cierre(archivo, dependencias) {
  const visto = new Set([archivo]);
  const pendientes = [archivo];
  while (pendientes.length > 0) {
    const actual = pendientes.pop();
    for (const dependencia of dependencias[actual] ?? []) {
      if (!visto.has(dependencia)) {
        visto.add(dependencia);
        pendientes.push(dependencia);
      }
    }
  }
  return visto;
}

/**
 * @param {{
 *   cambios: readonly string[],
 *   grupos: readonly { grupo: string, archivos: string, pruebas?: string, expandidos: readonly string[] }[],
 *   dependencias: Readonly<Record<string, readonly string[]>>,
 * }} entrada
 * @returns {{ completo: boolean, motivo: string, grupos: { grupo: string, archivos: string, pruebas: string }[] }}
 */
function planificar({ cambios, grupos, dependencias }) {
  const todos = (motivo) => ({
    completo: true,
    motivo,
    grupos: grupos.map(({ grupo, archivos, pruebas }) => ({
      grupo,
      archivos,
      pruebas: pruebas ?? "",
    })),
  });

  const enElGrafo = new Set();
  for (const cambio of cambios) {
    if (IGNORABLES.some((patron) => patron.test(cambio))) continue;
    if (!(cambio in dependencias)) {
      return todos(`cambia ${cambio}, que el grafo de importaciones no explica`);
    }
    enElGrafo.add(cambio);
  }
  if (enElGrafo.size === 0) {
    return { completo: false, motivo: "el PR no cambia nada que afecte a la mutación", grupos: [] };
  }

  const afectados = new Set(enElGrafo);
  for (const archivo of Object.keys(dependencias)) {
    if (!esPrueba(archivo)) continue;
    const alcance = cierre(archivo, dependencias);
    for (const raiz of RAICES_GLOBALES) alcance.add(raiz);
    if ([...alcance].some((importado) => enElGrafo.has(importado))) {
      for (const importado of alcance) afectados.add(importado);
    }
  }

  const elegidos = [];
  for (const { grupo, pruebas, expandidos } of grupos) {
    const archivos = expandidos.filter((archivo) => afectados.has(archivo));
    if (archivos.length > 0) {
      elegidos.push({ grupo, archivos: archivos.join(","), pruebas: pruebas ?? "" });
    }
  }
  return {
    completo: false,
    motivo: `${enElGrafo.size} archivo(s) cambiado(s) alcanzan a ${elegidos.length} grupo(s)`,
    grupos: elegidos,
  };
}

/** Expande los patrones `a,b,!c` de un grupo a archivos reales (mismo criterio que `--mutate`). */
function expandir(patrones, raiz) {
  const lista = patrones.split(",");
  const positivos = lista.filter((p) => !p.startsWith("!"));
  const negativos = lista.filter((p) => p.startsWith("!")).map((p) => p.slice(1));
  const encontrados = new Set();
  for (const patron of positivos) {
    for (const archivo of fs.globSync(patron, { cwd: raiz })) {
      encontrados.add(archivo.split(path.sep).join("/"));
    }
  }
  return [...encontrados]
    .filter((archivo) => !esPrueba(archivo))
    .filter((archivo) => !negativos.some((negativo) => path.posix.matchesGlob(archivo, negativo)))
    .sort();
}

/** Grafo de importaciones de `src/` y `test/` con la misma herramienta de la regla de arquitectura. */
function leerDependencias(raiz) {
  let salida;
  try {
    salida = execFileSync(
      path.join(raiz, "node_modules/.bin/depcruise"),
      ["src", "test", "--config", ".dependency-cruiser.cjs", "--output-type", "json"],
      { cwd: raiz, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (error) {
    // depcruise sale con código distinto de cero si hay violaciones; el JSON igual está completo.
    if (typeof error.stdout !== "string" || error.stdout === "") throw error;
    salida = error.stdout;
  }
  const dependencias = {};
  for (const modulo of JSON.parse(salida).modules) {
    dependencias[modulo.source] = modulo.dependencies
      .filter((d) => !d.couldNotResolve && !d.coreModule)
      .map((d) => d.resolved);
  }
  return dependencias;
}

function leerGrupos(raiz) {
  const definidos = JSON.parse(
    fs.readFileSync(path.join(raiz, "arquitectura/grupos-de-mutacion.json"), "utf8"),
  );
  return definidos.map(({ grupo, archivos, pruebas }) => ({
    grupo,
    archivos,
    pruebas,
    expandidos: expandir(archivos, raiz),
  }));
}

/** Archivos que cambió el PR respecto de su base: el commit de merge que deja Actions tiene la base como primer padre. */
function leerCambios(raiz) {
  const salida = execFileSync("git", ["diff", "--name-only", "--no-renames", "HEAD^1", "HEAD"], {
    cwd: raiz,
    encoding: "utf8",
  });
  return salida.split("\n").filter((linea) => linea !== "");
}

function principal() {
  const raiz = process.cwd();
  const grupos = leerGrupos(raiz);
  const evento = process.env["GITHUB_EVENT_NAME"] ?? "";
  const plan =
    evento === "pull_request"
      ? planificar({ cambios: leerCambios(raiz), grupos, dependencias: leerDependencias(raiz) })
      : {
          completo: true,
          motivo: `evento ${evento === "" ? "local" : evento}: se corre todo`,
          grupos: grupos.map(({ grupo, archivos, pruebas }) => ({
            grupo,
            archivos,
            pruebas: pruebas ?? "",
          })),
        };

  const resumen = [
    `Mutación: ${plan.motivo}.`,
    ...plan.grupos.map((g) => `- ${g.grupo}: ${g.archivos}`),
  ].join("\n");
  process.stdout.write(`${resumen}\n`);
  const salida = process.env["GITHUB_OUTPUT"];
  if (salida !== undefined && salida !== "") {
    fs.appendFileSync(
      salida,
      `hay=${plan.grupos.length > 0}\ngrupos=${JSON.stringify(plan.grupos)}\n`,
    );
  }
}

module.exports = { planificar, expandir };

if (require.main === module) principal();
