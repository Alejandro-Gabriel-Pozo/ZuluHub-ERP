/**
 * Planificador de la mutación en los pull requests: decide qué grupos de mutación (un archivo por grupo; ver `grupos-de-mutacion.cjs`)
 * corren y con qué archivos, a partir de los archivos que cambió el PR y del grafo de importaciones.
 *
 * Previene: que un PR deje sin re-mutar un archivo de dominio cuyo resultado cambió por algo que NO es él mismo (una primitiva que importa, un
 * auxiliar de pruebas compartido, el cuerpo de una prueba). El modo `--incremental` de Stryker no lo ve. Regla: un archivo mutado D queda
 * afectado si alguna prueba t que lo importa (directa o indirectamente) tiene en su cierre de importaciones algún archivo cambiado.
 * Después, `grupos-por-filtro.cjs` descarta los grupos cuyo filtro de pruebas no alcanza lo cambiado, y `guardian-en-pr.cjs` los del guardián
 * si el PR no lo toca. Solo restan: nunca agregan un grupo.
 *
 * Cualquier cosa que el grafo no explica (un archivo que no es TypeScript de `src/`, `apps/` o `test/`, uno borrado, la configuración) hace
 * correr TODOS los grupos completos: ante la duda, no se saltea. Las excepciones son EXPLÍCITAS y cada una dice por qué es segura:
 *  - el guardián de contratos: sus pruebas copian, lanzan y leen archivos que el grafo no ve, y un mapa fijo lo declara (`PRUEBAS_DEL_GUARDIAN`);
 *  - `apps/**`: las aplicaciones importan de `src/`, nunca al revés; un archivo de `apps/` solo cambia un resultado si una prueba lo importa
 *    (el grafo lo ve) o lo lee como texto (`LECTURAS_DE_APPS`);
 *  - `.github/workflows/ci.yml`: ver `cambioDeCiAfecta`; solo un cambio en jobs que no son de mutación deja de correr todo, y aun así alcanza al guardián.
 *
 * CI liviano (dueño, 25/11/2026): un pull request hacia la rama de integración (`BASE_DE_INTEGRACION`) no corre ninguna mutación ni Estabilidad (corren de noche) y la web solo si el
 * cambio la toca (`tocaLaWeb`); el pull request final (de esa rama hacia otra) corre TODOS los grupos. Ver `perfilDelPullRequest` y `evaluar-gate.cjs`.
 *
 * El mismo grafo (más una lista de rutas del dueño) decide si la integración (`Estabilidad`, 12 copias) tiene que repetirse: ver `planificarEstabilidad`.
 * Orden de los grupos: duración descendente (`ordenarPorDuracion`); los del guardián solo entran si el PR lo toca (`guardian-en-pr.cjs`). Chequeo: `test/arquitectura/planificar-mutacion.test.ts`.
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { cargarLosGrupos } = require("./grupos-de-mutacion.cjs");
const { gruposDelPlan } = require("./guardian-en-pr.cjs");
const { decidirPorFiltro } = require("./grupos-por-filtro.cjs");

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

/** Los mismos, para la integración (las migraciones SÍ la afectan: las aplica), más sus ajenos explícitos (`ajenos-a-la-integracion.cjs`). */
const IGNORABLES_DE_INTEGRACION = [
  ...DOCUMENTACION_Y_AJENOS,
  ...require("./ajenos-a-la-integracion.cjs"),
];

const ARCHIVO_DE_CI = ".github/workflows/ci.yml";

/** Configuración de una aplicación: cambia cómo se instalan o transforman sus archivos (workspace de npm, `tsconfig` de esbuild). Se trata como lo desconocido: corre todo. */
const CONFIGURACION_DE_APPS = /^apps\/[^/]+\/(package\.json|tsconfig[^/]*\.json)$/;

/**
 * Pruebas que LEEN archivos de `apps/` como texto (el grafo no ve ese vínculo, no es un `import`), con los patrones que leen: están en `lecturas-de-apps.json` (datos, para que declarar una prueba nueva no haga crecer este archivo). Un cambio en uno de esos archivos alcanza a la prueba y, por su cierre de importaciones, a lo que ella ejercita. Hoy solo `contraste-de-superficies` ejerce código que se muta (el contraste); el resto se declara igual por si mañana importa algo mutado. Una prueba nueva que lea `apps/` se declara en ese archivo (`planificar-mutacion.test.ts` lo exige).
 */
const LECTURAS_DE_APPS = require("./lecturas-de-apps.json");

/** Lo que vitest ejecuta antes de TODAS las pruebas (`globalSetup`, `setupFiles`): entra en el alcance de cada una. Solo el archivo mismo: lo que importa un `globalSetup` falla en la carga para todo el filtro (medido a mano) y es del grupo dueño. */
const RAICES_GLOBALES = ["test/integracion/global.ts", "test/integracion/topes.ts"];

const esPrueba = (archivo) => archivo.endsWith(".test.ts");

/**
 * Las pruebas que corre el proyecto `node` de vitest (`vitest.config.ts`: `src/**` y `test/**`), las únicas que
 * la mutación y la integración ejecutan. Las de `apps/**` son del proyecto `componentes` (Chromium) y no cuentan.
 */
const esPruebaDeNode = (archivo) => esPrueba(archivo) && /^(src|test)\//.test(archivo);

/**
 * Lo que el grafo de importaciones NO ve del guardián: lo que sus pruebas copian a carpetas temporales, lanzan con `node` o leen como texto
 * (datos `*.json`, `.cjs` que solo corren como CLI, `evaluar-gate.cjs`, `reglas.cjs`, `ci.yml`). El código del guardián también se muta, así que
 * el mapa es EXPLÍCITO y grueso a propósito: toda prueba o auxiliar del guardián depende de TODOS esos archivos. Solo AGREGA dependencias.
 * El registro de decisiones (`DEC-NNNN.json`) entra acá: además de las del guardián lo leen solo `decisiones-*`, `nombre-del-producto`,
 * `grupos-de-mutacion` y `planificar-mutacion` (medido con `strace`); antes cada decisión nueva corría los ~97 grupos. Borrarla corre todo.
 */
const PRUEBAS_DEL_GUARDIAN =
  /^test\/arquitectura\/(?:guardian-|decisiones-|nombre-del-producto\.|grupos-de-mutacion\.|planificar-mutacion\.)[^/]*\.ts$/;
/** Las carpetas del guardián: el código de los contratos, el control de deuda técnica y el registro de decisiones. */
const CARPETAS_DEL_GUARDIAN = [
  "arquitectura/contratos",
  "arquitectura/deuda",
  "arquitectura/decisiones/registro",
];
const OTROS_ARCHIVOS_DEL_GUARDIAN = [
  "arquitectura/evaluar-gate.cjs",
  "arquitectura/reglas.cjs",
  // Sus pruebas leen el `ci.yml` real (el trabajo `guardian`, el `needs` del Gate) y lo alteran en memoria.
  ARCHIVO_DE_CI,
];

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
 * Agrega al grafo los archivos que lee el guardián (para que un cambio en ellos no sea «desconocido») y la
 * dependencia de cada prueba o auxiliar del guardián sobre todos ellos.
 *
 * @param {Readonly<Record<string, readonly string[]>>} dependencias
 * @param {readonly string[]} archivosDelGuardian
 * @returns {Record<string, string[]>}
 */
function conEnlacesDelGuardian(dependencias, archivosDelGuardian) {
  const grafo = Object.fromEntries(
    Object.entries(dependencias).map(([archivo, importados]) => [archivo, [...importados]]),
  );
  for (const archivo of archivosDelGuardian) grafo[archivo] ??= [];
  for (const archivo of Object.keys(grafo)) {
    if (PRUEBAS_DEL_GUARDIAN.test(archivo)) {
      grafo[archivo] = [...new Set([...grafo[archivo], ...archivosDelGuardian])];
    }
  }
  return grafo;
}

/**
 * Los archivos que el guardián lee: las carpetas de arriba (los informes que generan no cuentan) y los otros archivos de `arquitectura/` que su verificador carga. Un archivo que falta en disco no se inventa.
 */
function leerArchivosDelGuardian(raiz) {
  const presentes = (archivo) =>
    fs.statSync(path.join(raiz, archivo), { throwIfNoEntry: false })?.isFile() === true;
  return [
    ...CARPETAS_DEL_GUARDIAN.flatMap((carpeta) => fs.globSync(`${carpeta}/**/*`, { cwd: raiz }))
      .map((archivo) => archivo.split(path.sep).join("/"))
      .filter((archivo) => !archivo.endsWith("/informe.json")),
    ...OTROS_ARCHIVOS_DEL_GUARDIAN,
  ]
    .filter(presentes)
    .sort();
}

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
  const afectadas = pruebasAfectadas({ enElGrafo, enApps, dependencias, lecturas });
  for (const alcance of afectadas.values()) {
    for (const importado of alcance) afectados.add(importado);
  }

  const elegidos = [];
  const saltados = [];
  const contexto = { dependencias, afectadas, enElGrafo, esPruebaDeNode, archivoDe };
  const porFiltro = decidirPorFiltro(contexto);
  for (const { grupo, pruebas, expandidos } of ordenarPorDuracion(gruposDelPlan(grupos, cambios))) {
    const archivos = expandidos.filter((entrada) => afectados.has(archivoDe(entrada)));
    if (archivos.length === 0) continue;
    const decision = porFiltro({ grupo, pruebas, expandidos });
    if (decision.corre)
      elegidos.push({ grupo, archivos: archivos.join(","), pruebas: pruebas ?? "" });
    else saltados.push(`${grupo}: ${decision.motivo}`);
  }
  const alcanzan = new Set([...enElGrafo, ...enApps]).size;
  return {
    completo: false,
    motivo: `${alcanzan} archivo(s) cambiado(s) alcanzan a ${elegidos.length} grupo(s)`,
    grupos: elegidos,
    saltados,
  };
}

/** Cambios que obligan a repetir la integración (decisión del dueño, 2026-11-07: cuesta ~50 min de máquina por corrida y solo detecta fallas intermitentes de lo que toca la base). Previene: gastar esas máquinas en un cambio de pantalla o de dominio que no puede alterarla. Lista de lo que SÍ la dispara. */
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

/** La rama de integración: los pull requests hacia ella corren el CI liviano (decisión del dueño, 25/11/2026); la nocturna y el pull request final hacia `main` corren todo. */
const BASE_DE_INTEGRACION = "integracion/modulos-v2";

/**
 * Qué CI corre un pull request, por su rama base y su rama de origen (los dos valores llegan por variables de entorno, nunca interpolados en un comando):
 *  - `liviano`: hacia la rama de integración. Sin mutación ni Estabilidad (corren de noche); la web solo si el cambio la toca (`tocaLaWeb`);
 *  - `completo`: el pull request final, de la rama de integración hacia otra (`main`): TODOS los grupos, Estabilidad siempre y la web siempre;
 *  - `por-grafo`: cualquier otro (por ejemplo, una actualización de dependencias hacia `main`): lo de antes, solo lo que el cambio alcanza.
 * Ante la duda (base vacía, rama desconocida) NO es `liviano`: el liviano exige la base exacta.
 *
 * @param {{ evento: string, base: string, origen: string }} entrada
 * @returns {"liviano" | "completo" | "por-grafo"}
 */
function perfilDelPullRequest({ evento, base, origen }) {
  if (evento !== "pull_request") return "completo";
  if (base === BASE_DE_INTEGRACION) return "liviano";
  return origen === BASE_DE_INTEGRACION ? "completo" : "por-grafo";
}

/**
 * ¿El cambio puede afectar a la web (compilación de `apps/web` y `apps/plataforma`, componentes en Chromium y recorrido)? Sí si toca un archivo de `apps/`, el
 * propio `ci.yml`, un archivo que alguna aplicación o un recorrido importa (cierre de importaciones del grafo) o algo que el grafo no conoce (la configuración,
 * las migraciones que aplica el recorrido, `package.json`): ante lo que no sabe clasificar, SÍ (falla cerrado). Solo la documentación y lo que ninguna
 * aplicación ni recorrido alcanza dan `false`.
 *
 * @param {{ cambios: readonly string[], dependencias: Readonly<Record<string, readonly string[]>> }} entrada
 * @returns {{ toca: boolean, motivo: string }}
 */
function tocaLaWeb({ cambios, dependencias }) {
  const entradas = Object.keys(dependencias).filter(
    (archivo) =>
      archivo.startsWith("apps/") || /^test\/recorrido\/.*\.recorrido\.ts$/.test(archivo),
  );
  let alcanzados;
  const alcanzaA = (cambio) => {
    alcanzados ??= entradas.map((entrada) => cierre(entrada, dependencias));
    return alcanzados.some((alcance) => alcance.has(cambio));
  };
  for (const cambio of cambios) {
    if (DOCUMENTACION_Y_AJENOS.some((patron) => patron.test(cambio))) continue;
    if (cambio === ARCHIVO_DE_CI || cambio.startsWith("apps/")) {
      return { toca: true, motivo: `cambia ${cambio}` };
    }
    if (!(cambio in dependencias)) {
      return { toca: true, motivo: `cambia ${cambio}, que el grafo de importaciones no explica` };
    }
    if (alcanzaA(cambio))
      return { toca: true, motivo: `cambia ${cambio}, que usa una aplicación o un recorrido` };
  }
  return {
    toca: false,
    motivo: "el PR no cambia nada que alcance a las aplicaciones ni a los recorridos",
  };
}

function principal() {
  const raiz = process.cwd();
  const grupos = leerGrupos(raiz);
  const evento = process.env["GITHUB_EVENT_NAME"] ?? "";
  let plan;
  let estabilidad;
  let web = {
    toca: true,
    motivo: `evento ${evento === "" ? "local" : evento}: la web corre siempre`,
  };
  const perfil = perfilDelPullRequest({
    evento,
    base: process.env["BASE_DEL_PR"] ?? "",
    origen: process.env["ORIGEN_DEL_PR"] ?? "",
  });
  if (evento === "pull_request") {
    const cambios = leerCambios(raiz);
    const dependencias = leerDependencias(raiz);
    if (perfil === "liviano") {
      plan = {
        completo: false,
        motivo: `CI liviano (pull request hacia ${BASE_DE_INTEGRACION}): la mutación corre de noche`,
        grupos: [],
      };
      estabilidad = { corre: false, motivo: "CI liviano: Estabilidad corre de noche" };
      web = tocaLaWeb({ cambios, dependencias });
    } else if (perfil === "completo") {
      plan = todosLosGrupos(grupos, "pull request final: se corre todo");
      estabilidad = { corre: true, motivo: "pull request final: se repite siempre" };
    } else {
      const ci = cambios.includes(ARCHIVO_DE_CI) ? leerCi(raiz) : undefined;
      plan = planificar({ cambios, grupos, dependencias, ci });
      estabilidad = planificarEstabilidad({ cambios, dependencias });
    }
  } else {
    const cual = `evento ${evento === "" ? "local" : evento}`;
    plan = todosLosGrupos(grupos, `${cual}: se corre todo`);
    estabilidad = { corre: true, motivo: `${cual}: se repite siempre` };
  }

  const resumen = [
    `Mutación: ${plan.motivo}.`,
    ...plan.grupos.map((g) => `- ${g.grupo}: ${g.archivos}`),
    ...(plan.saltados ?? []).map((s) => `- se saltea ${s}`),
    `Estabilidad (integración repetida): ${estabilidad.corre ? "corre" : "se saltea"}: ${estabilidad.motivo}.`,
    `Web (compilación, componentes y recorrido): ${web.toca ? "corre" : "se saltea"}: ${web.motivo}.`,
  ].join("\n");
  process.stdout.write(`${resumen}\n`);
  const salida = process.env["GITHUB_OUTPUT"];
  if (salida !== undefined && salida !== "") {
    fs.appendFileSync(
      salida,
      `hay=${plan.grupos.length > 0}\ngrupos=${JSON.stringify(plan.grupos)}\nestabilidad=${estabilidad.corre}\nliviano=${perfil === "liviano"}\ntoca_web=${web.toca}\n`,
    );
  }
}

module.exports = {
  BASE_DE_INTEGRACION,
  perfilDelPullRequest,
  tocaLaWeb,
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
