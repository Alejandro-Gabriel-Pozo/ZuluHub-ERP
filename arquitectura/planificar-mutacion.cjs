/**
 * Planificador de la mutación en los pull requests: decide qué grupos de mutación (un archivo por grupo; ver `grupos-de-mutacion.cjs`)
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
 * Cualquier cosa que el grafo no explica (un archivo que no es TypeScript de `src/`, `apps/` o `test/`, uno
 * borrado, la configuración) hace correr TODOS los grupos completos: ante la duda, no se saltea.
 * Las excepciones son EXPLÍCITAS y cada una dice por qué es segura:
 *  - el guardián de contratos: sus pruebas copian, lanzan y leen archivos que el grafo no ve, y un mapa fijo
 *    lo declara (ver `PRUEBAS_DEL_GUARDIAN`);
 *  - `apps/**`: las aplicaciones importan de `src/`, nunca al revés, y los grupos solo mutan `src/**` y
 *    `arquitectura/contratos/*.cjs`. Un archivo de `apps/` solo puede cambiar un resultado de mutación si una
 *    prueba lo importa (el grafo lo ve) o lo lee como texto (ver `LECTURAS_DE_APPS`);
 *  - `.github/workflows/ci.yml`: ver `cambioDeCiAfecta`; solo un cambio en jobs que no son de mutación deja
 *    de correr todo, y aun así alcanza al guardián, cuyas pruebas leen ese archivo.
 *
 * El mismo grafo (más una lista de rutas del dueño) decide si la integración (`Estabilidad`, 12 copias) tiene que repetirse: ver `planificarEstabilidad`.
 * El orden de los grupos que sale del plan es el de duración descendente (ver `ordenarPorDuracion`).
 * El chequeo que falla si se quita una de estas decisiones es `test/arquitectura/planificar-mutacion.test.ts`.
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {
  ARCHIVO_DE_CI,
  partirCi,
  JOBS_AJENOS_A_LA_MUTACION,
  cambioDeCiAfecta,
  leerCi,
} = require("./analizar-ci.cjs");
const { conEnlacesDelGuardian, leerArchivosDelGuardian } = require("./enlaces-del-guardian.cjs");
const { cargarLosGrupos } = require("./grupos-de-mutacion.cjs");

/**
 * Cambios que ninguna prueba lee de un modo que cambie un resultado: ni la mutación ni la integración los notan. Los dos workflows de acá no los lee ninguna prueba salvo el escaneo de nombres, que no ejerce código mutado.
 */
const DOCUMENTACION_Y_AJENOS = [
  /\.md$/,
  /^\.github\/dependabot\.yml$/,
  /^\.github\/workflows\/(codeql|gate-rapido)\.yml$/,
  /^\.gitleaks\.toml$/,
  /^skills-lock\.json$/,
];

/** Cambios que ninguna prueba unitaria lee: no alteran ningún resultado de mutación. */
const IGNORABLES = [
  ...DOCUMENTACION_Y_AJENOS,
  /^migraciones\//, // solo las lee la integración, que la mutación no corre (PEDERNAL_SIN_INTEGRACION=1)
];

/** Los mismos, para la integración: las migraciones SÍ la afectan (las aplica), así que no están. */
const IGNORABLES_DE_INTEGRACION = DOCUMENTACION_Y_AJENOS;

/** Configuración de una aplicación: cambia cómo se instalan o transforman sus archivos (workspace de npm, `tsconfig` de esbuild). Se trata como lo desconocido: corre todo. */
const CONFIGURACION_DE_APPS = /^apps\/[^/]+\/(package\.json|tsconfig[^/]*\.json)$/;

/**
 * Pruebas que LEEN archivos de `apps/` como texto (el grafo no ve ese vínculo, no es un `import`), con los patrones que leen: están en `lecturas-de-apps.json` (datos, para que declarar una prueba nueva no haga crecer este archivo). Un cambio en uno de esos archivos alcanza a la prueba y, por su cierre de importaciones, a lo que ella ejercita. Hoy solo `contraste-de-superficies` ejerce código que se muta (el contraste); el resto se declara igual por si mañana importa algo mutado. Una prueba nueva que lea `apps/` se declara en ese archivo (`planificar-mutacion.test.ts` lo exige).
 */
const LECTURAS_DE_APPS = require("./lecturas-de-apps.json");

/**
 * Lo que vitest ejecuta antes de TODAS las pruebas: entra en el alcance de cada una. Solo el archivo
 * mismo: lo que importa corre en el proceso principal, sin el mutante activo, y no cambia el resultado.
 */
const RAICES_GLOBALES = ["test/integracion/global.ts"];

const esPrueba = (archivo) => archivo.endsWith(".test.ts");

/**
 * Las pruebas que corre el proyecto `node` de vitest (`vitest.config.ts`: `src/**` y `test/**`), las únicas que
 * la mutación y la integración ejecutan. Las de `apps/**` son del proyecto `componentes` (Chromium) y no cuentan.
 */
const esPruebaDeNode = (archivo) => esPrueba(archivo) && /^(src|test)\//.test(archivo);

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

/** ¿Alguna de las lecturas de `prueba` (patrones de `lecturas`) coincide con algún archivo de `enApps` (un `Set`)? */
const leeAlgunoDe = (prueba, enApps, lecturas) =>
  (lecturas[prueba] ?? []).some((patron) =>
    [...enApps].some((a) => path.posix.matchesGlob(a, patron)),
  );

/**
 * Duración descendente: el grupo más lento arranca primero y no queda esperando cola al final (el tiempo de pared
 * de la corrida es el del grupo más lento MÁS lo que espere). Orden estable (los empates conservan el del archivo)
 * y un grupo sin duración declarada va primero: lo desconocido se supone lento. No cambia QUÉ corre.
 *
 * @template {{ minutos?: number }} G
 * @param {readonly G[]} grupos
 * @returns {G[]}
 */
function ordenarPorDuracion(grupos) {
  const duracion = (g) => (typeof g.minutos === "number" ? g.minutos : Number.POSITIVE_INFINITY);
  return grupos
    .map((grupo, posicion) => ({ grupo, posicion }))
    .sort((a, b) => {
      const da = duracion(a.grupo);
      const db = duracion(b.grupo);
      if (da === db) return a.posicion - b.posicion;
      return da > db ? -1 : 1;
    })
    .map(({ grupo }) => grupo);
}

const comoMatriz = ({ grupo, archivos, pruebas }) => ({ grupo, archivos, pruebas: pruebas ?? "" });

/** Todos los grupos completos, en orden de duración descendente. */
function todosLosGrupos(grupos, motivo) {
  return { completo: true, motivo, grupos: ordenarPorDuracion(grupos).map(comoMatriz) };
}

/**
 * Archivos de prueba afectados por el cambio: los que tienen en su alcance (cierre de importaciones más lo que
 * vitest carga antes de todo) algún archivo cambiado del grafo, y los que leen como texto algún archivo de `apps/`
 * cambiado.
 */
function pruebasAfectadas({ enElGrafo, enApps, dependencias, lecturas }) {
  const afectadas = new Map();
  for (const archivo of Object.keys(dependencias)) {
    if (!esPruebaDeNode(archivo)) continue;
    const alcance = cierre(archivo, dependencias);
    for (const raiz of RAICES_GLOBALES) alcance.add(raiz);
    if (
      [...alcance].some((importado) => enElGrafo.has(importado)) ||
      leeAlgunoDe(archivo, enApps, lecturas)
    ) {
      afectadas.set(archivo, alcance);
    }
  }
  return afectadas;
}

/**
 * @param {{
 *   cambios: readonly string[],
 *   grupos: readonly { grupo: string, archivos: string, pruebas?: string, minutos?: number, expandidos: readonly string[] }[],
 *   dependencias: Readonly<Record<string, readonly string[]>>,
 *   ci?: { antes: string | null, despues: string | null },
 *   lecturas?: Readonly<Record<string, readonly string[]>>,
 * }} entrada
 * @returns {{ completo: boolean, motivo: string, grupos: { grupo: string, archivos: string, pruebas: string }[] }}
 */
function planificar({ cambios, grupos, dependencias, ci, lecturas = LECTURAS_DE_APPS }) {
  const todos = (motivo) => todosLosGrupos(grupos, motivo);

  const enElGrafo = new Set();
  const enApps = new Set();
  for (const cambio of cambios) {
    if (IGNORABLES.some((patron) => patron.test(cambio))) continue;
    if (cambio === ARCHIVO_DE_CI) {
      if (cambioDeCiAfecta(ci, JOBS_AJENOS_A_LA_MUTACION)) {
        return todos(`cambia ${cambio} en algo que puede afectar a la mutación`);
      }
      // Confinado a otros jobs: solo lo notan las pruebas del guardián, que leen el archivo (está en su grafo).
    } else if (cambio.startsWith("apps/") && !CONFIGURACION_DE_APPS.test(cambio)) {
      // Una aplicación no la importa nada que se mute: solo cuentan las pruebas que la importan o la leen.
      enApps.add(cambio);
      if (cambio in dependencias) enElGrafo.add(cambio);
      continue;
    }
    if (!(cambio in dependencias)) {
      return todos(`cambia ${cambio}, que el grafo de importaciones no explica`);
    }
    enElGrafo.add(cambio);
  }
  if (enElGrafo.size === 0 && enApps.size === 0) {
    return { completo: false, motivo: "el PR no cambia nada que afecte a la mutación", grupos: [] };
  }

  const afectados = new Set(enElGrafo);
  for (const alcance of pruebasAfectadas({ enElGrafo, enApps, dependencias, lecturas }).values()) {
    for (const importado of alcance) afectados.add(importado);
  }

  const elegidos = [];
  for (const { grupo, pruebas, expandidos } of ordenarPorDuracion(grupos)) {
    const archivos = expandidos.filter((entrada) => afectados.has(archivoDe(entrada)));
    if (archivos.length > 0) {
      elegidos.push({ grupo, archivos: archivos.join(","), pruebas: pruebas ?? "" });
    }
  }
  const alcanzan = new Set([...enElGrafo, ...enApps]).size;
  return {
    completo: false,
    motivo: `${alcanzan} archivo(s) cambiado(s) alcanzan a ${elegidos.length} grupo(s)`,
    grupos: elegidos,
  };
}

/**
 * Cambios que obligan a repetir la integración 12 veces en un pull request (decisión del dueño, 2026-11-07: la
 * repetición cuesta ~78 min de máquina por corrida y solo detecta fallas intermitentes de lo que toca la base).
 * Previene: gastar 12 máquinas en un cambio de pantalla o de dominio que no puede alterar la integración contra
 * Postgres. Es una lista de lo que SÍ la dispara; el resto se decide en `planificarEstabilidad`.
 */
const DISPARAN_ESTABILIDAD = [
  /^test\/integracion\//,
  /^src\/(?:[^/]+\/)*persistencia\//, // src/**/persistencia/**
  /^src\/adaptadores\/postgres\//,
  /^migraciones\//,
  /^\.github\/workflows\//, // los workflows no ignorables (ver DOCUMENTACION_Y_AJENOS): ci.yml, migrar*, etc.
  // SUPUESTO (DEC-0079) (el dueño dijo «arquitectura/ de la base» y no hay una carpeta con ese nombre): las reglas SQL.
  /^arquitectura\/lint-sql\.cjs$/,
  // Lo que la integración lanza como proceso aparte (no es un `import` que el grafo vea).
  /^scripts\//,
];

/**
 * ¿Hay que repetir la integración 12 veces (`Estabilidad`)? Solo en los casos de `DISPARAN_ESTABILIDAD`, más lo
 * que no se puede explicar: ante la duda, sí (fail-closed). NO corre solo si todo el cambio es de los tipos que
 * se saben inocuos:
 *  - documentación y archivos ajenos (`IGNORABLES_DE_INTEGRACION`);
 *  - un archivo que el grafo de importaciones conoce (`src/`, `apps/`, `test/`, el código del guardián) y que no
 *    está en `DISPARAN_ESTABILIDAD`, aunque alguna prueba de integración lo ejercite.
 * Corre siempre si no hay cambios que explicar de otra manera: configuración (`package*.json`, `vitest.config.ts`…),
 * un archivo borrado o cualquier cosa que el grafo no conozca. En push a `main` y en la nocturna corre siempre
 * (lo decide `principal`, no esta función).
 *
 * @param {{
 *   cambios: readonly string[],
 *   dependencias: Readonly<Record<string, readonly string[]>>,
 * }} entrada
 * @returns {{ corre: boolean, motivo: string }}
 */
function planificarEstabilidad({ cambios, dependencias }) {
  for (const cambio of cambios) {
    if (IGNORABLES_DE_INTEGRACION.some((patron) => patron.test(cambio))) continue;
    if (DISPARAN_ESTABILIDAD.some((patron) => patron.test(cambio))) {
      return { corre: true, motivo: `cambia ${cambio}, parte de lo que toca la base` };
    }
    if (CONFIGURACION_DE_APPS.test(cambio) || !(cambio in dependencias)) {
      return { corre: true, motivo: `cambia ${cambio}, que el grafo de importaciones no explica` };
    }
  }
  return { corre: false, motivo: "el PR no cambia nada de lo que toca la base" };
}

/**
 * Un patrón puede llevar un rango de líneas (`archivo.cjs:10-80`, el mismo formato de `--mutate`): el
 * archivo grande se reparte entre varios grupos para que ningún job pase del tiempo previsto. Un rango
 * tiene que cortar ENTRE sentencias de primer nivel (si no, un mutante que lo cruza no entra en ninguno);
 * `test/arquitectura/planificar-mutacion.test.ts` exige que los rangos de un archivo lo cubran entero.
 */
const RANGO_DE_LINEAS = /^(.+):(\d+)-(\d+)$/;

/** El archivo de una entrada expandida, sin su rango de líneas (si lo tiene). */
const archivoDe = (entrada) => RANGO_DE_LINEAS.exec(entrada)?.[1] ?? entrada;

/**
 * Expande los patrones `a,b:1-9,!c` de un grupo a archivos reales (mismo criterio que `--mutate`). Una
 * entrada con rango conserva su sufijo (`a.cjs:1-9`): es lo que el job le pasa a Stryker.
 */
function expandir(patrones, raiz) {
  const lista = patrones.split(",");
  const positivos = lista.filter((p) => !p.startsWith("!"));
  const negativos = lista.filter((p) => p.startsWith("!")).map((p) => p.slice(1));
  const encontrados = new Set();
  for (const patron of positivos) {
    const [, glob, desde, hasta] = RANGO_DE_LINEAS.exec(patron) ?? [undefined, patron];
    const sufijo = desde === undefined ? "" : `:${desde}-${hasta}`;
    for (const archivo of fs.globSync(glob, { cwd: raiz })) {
      encontrados.add(`${archivo.split(path.sep).join("/")}${sufijo}`);
    }
  }
  return [...encontrados]
    .filter((entrada) => !esPrueba(archivoDe(entrada)))
    .filter(
      (entrada) =>
        !negativos.some((negativo) => path.posix.matchesGlob(archivoDe(entrada), negativo)),
    )
    .sort();
}

/**
 * Grafo de importaciones de `src/`, `apps/` y `test/` con la misma herramienta de la regla de arquitectura.
 * `apps/` está para que todo archivo de una aplicación sea un nodo conocido (y se vea qué prueba lo importa).
 */
function leerDependencias(raiz) {
  let salida;
  try {
    salida = execFileSync(
      path.join(raiz, "node_modules/.bin/depcruise"),
      ["src", "apps", "test", "--config", ".dependency-cruiser.cjs", "--output-type", "json"],
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
  return conEnlacesDelGuardian(dependencias, leerArchivosDelGuardian(raiz));
}

function leerGrupos(raiz) {
  const { grupos: definidos } = cargarLosGrupos(raiz);
  return definidos.map(({ grupo, archivos, pruebas, minutos }) => ({
    grupo,
    archivos,
    pruebas,
    minutos,
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
  let plan;
  let estabilidad;
  if (evento === "pull_request") {
    const cambios = leerCambios(raiz);
    const dependencias = leerDependencias(raiz);
    const ci = cambios.includes(ARCHIVO_DE_CI) ? leerCi(raiz) : undefined;
    plan = planificar({ cambios, grupos, dependencias, ci });
    estabilidad = planificarEstabilidad({ cambios, dependencias });
  } else {
    const cual = `evento ${evento === "" ? "local" : evento}`;
    plan = todosLosGrupos(grupos, `${cual}: se corre todo`);
    estabilidad = { corre: true, motivo: `${cual}: se repite siempre` };
  }

  const resumen = [
    `Mutación: ${plan.motivo}.`,
    ...plan.grupos.map((g) => `- ${g.grupo}: ${g.archivos}`),
    `Estabilidad (integración x12): ${estabilidad.corre ? "corre" : "se saltea"}: ${estabilidad.motivo}.`,
  ].join("\n");
  process.stdout.write(`${resumen}\n`);
  const salida = process.env["GITHUB_OUTPUT"];
  if (salida !== undefined && salida !== "") {
    fs.appendFileSync(
      salida,
      `hay=${plan.grupos.length > 0}\ngrupos=${JSON.stringify(plan.grupos)}\nestabilidad=${estabilidad.corre}\n`,
    );
  }
}

module.exports = {
  planificar,
  planificarEstabilidad,
  ordenarPorDuracion,
  cambioDeCiAfecta,
  partirCi,
  LECTURAS_DE_APPS,
  JOBS_AJENOS_A_LA_MUTACION,
  expandir,
  archivoDe,
  conEnlacesDelGuardian,
  leerArchivosDelGuardian,
};

if (require.main === module) principal();
