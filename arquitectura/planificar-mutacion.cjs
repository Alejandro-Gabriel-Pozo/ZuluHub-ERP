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
 * El mismo grafo decide si la integración (`Estabilidad`, 12 copias) tiene que repetirse: ver `planificarEstabilidad`.
 * El orden de los grupos que sale del plan es el de duración descendente (ver `ordenarPorDuracion`).
 * El chequeo que falla si se quita una de estas decisiones es `test/arquitectura/planificar-mutacion.test.ts`.
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Cambios que ninguna prueba lee de un modo que cambie un resultado: ni la mutación ni la integración los
 * notan. Los dos workflows de acá no los lee ninguna prueba salvo el escaneo de nombres, que no ejerce código mutado.
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

const ARCHIVO_DE_CI = ".github/workflows/ci.yml";

/**
 * Configuración de una aplicación: cambia cómo se instalan o transforman sus archivos (un workspace de npm, el
 * `tsconfig` que lee esbuild), no solo su contenido. Se trata como lo desconocido: corre todo.
 */
const CONFIGURACION_DE_APPS = /^apps\/[^/]+\/(package\.json|tsconfig[^/]*\.json)$/;

/**
 * Pruebas que LEEN archivos de `apps/` como texto (el grafo no ve ese vínculo, no es un `import`), con los
 * patrones que leen. Un cambio en uno de esos archivos alcanza a la prueba y, por su cierre de importaciones,
 * a lo que ella ejercita. Hoy solo `contraste-de-superficies` ejerce código que se muta (el contraste); el resto
 * está declarado igual para que, si mañana importa algo mutado, el plan ya lo tenga en cuenta. Una prueba nueva que lea `apps/` se declara acá (`planificar-mutacion.test.ts` lo exige).
 */
const LECTURAS_DE_APPS = {
  "test/web/contraste-de-superficies.test.ts": ["apps/web/ui/tokens.css"],
  "test/web/legibilidad-de-la-app.test.ts": ["apps/web/**"],
  "test/web/acciones-de-facturacion.test.ts": ["apps/web/app/s/app/acciones-de-facturacion.ts"],
  "test/arquitectura/vercel-json.test.ts": ["apps/web/**"],
  "test/arquitectura/reglas.test.ts": ["apps/**"],
  "test/arquitectura/lint.test.ts": ["apps/**"],
};

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

/**
 * Lo que el grafo de importaciones NO ve del guardián. El grafo sí sigue los `require()` de sus pruebas
 * (`test/arquitectura/guardian-*.ts` cargan `arquitectura/contratos/*.cjs` y `arquitectura/deuda/*.cjs`), pero no lo
 * que esas pruebas copian a carpetas temporales, lanzan con `node` o leen como texto: los datos de las carpetas (`*.json`), los
 * `.cjs` que solo corren como proceso aparte (`no-debilitar.cjs` como CLI) y los archivos de `arquitectura/`
 * que el verificador carga del árbol (`evaluar-gate.cjs`, `reglas.cjs`, `ci.yml`). Como el código del guardián también
 * se muta (`stryker.config.json`), el mapa es EXPLÍCITO: toda prueba o auxiliar del guardián depende de TODOS
 * esos archivos. Es grueso a propósito: un mutante de `clasificacion.cjs` lo puede matar una prueba que
 * ejercita `guardian.cjs`, así que un cambio en cualquiera alcanza a los grupos de todos. Solo AGREGA
 * dependencias: lo que el grafo ya sabía sigue igual, y el resto de `arquitectura/` sigue sin estar en el mapa.
 */
const PRUEBAS_DEL_GUARDIAN = /^test\/arquitectura\/guardian-[^/]+\.ts$/;
/** Las carpetas del guardián: el código de los contratos y el control de deuda técnica (una pieza del guardián). */
const CARPETAS_DEL_GUARDIAN = ["arquitectura/contratos", "arquitectura/deuda"];
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
 * Los archivos que el guardián lee: `arquitectura/contratos/**` y `arquitectura/deuda/**` (los informes que
 * generan no cuentan) y los otros archivos de `arquitectura/` que su verificador carga. Un archivo que falta en
 * disco no se inventa.
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
 * Jobs de `ci.yml` cuyo cambio NO puede alterar la integración que repite `Estabilidad`. Quedan afuera
 * `pruebas` (misma base y mismo comando), `estabilidad`, `mutacion-plan` (decide si Estabilidad corre) y los
 * desconocidos.
 */
const JOBS_AJENOS_A_LA_INTEGRACION = [
  "estatico",
  "guardian",
  "seguridad",
  "flujos",
  "dependencias",
  "mutacion",
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
 * ¿Hay que repetir la integración 12 veces (`Estabilidad`)? Se repite si el cambio puede alterar lo que esas
 * pruebas ejercitan; ante la duda, sí. NO corre solo si todo el cambio es de los tipos que se saben inocuos:
 *  - documentación y archivos ajenos (`IGNORABLES_DE_INTEGRACION`);
 *  - un archivo de `src/`, `test/` o `apps/` que ninguna prueba de `test/integracion/` alcanza (por importación o
 *    por lectura de texto);
 *  - un `ci.yml` cuyo cambio queda en jobs ajenos a la integración (`JOBS_AJENOS_A_LA_INTEGRACION`).
 * Corre siempre si toca `test/integracion/` (las pruebas, sus auxiliares y lo que vitest carga antes), las
 * migraciones, `scripts/` (algunos los lanza la integración como proceso aparte), la configuración (`package*.json`, `vitest.config.ts`…), un archivo borrado o cualquier otra cosa
 * que el grafo no explique.
 *
 * @param {{
 *   cambios: readonly string[],
 *   dependencias: Readonly<Record<string, readonly string[]>>,
 *   ci?: { antes: string | null, despues: string | null },
 *   lecturas?: Readonly<Record<string, readonly string[]>>,
 * }} entrada
 * @returns {{ corre: boolean, motivo: string }}
 */
function planificarEstabilidad({ cambios, dependencias, ci, lecturas = LECTURAS_DE_APPS }) {
  const corre = (motivo) => ({ corre: true, motivo });
  const enElGrafo = new Set();
  const enApps = new Set();
  for (const cambio of cambios) {
    if (IGNORABLES_DE_INTEGRACION.some((patron) => patron.test(cambio))) continue;
    if (
      cambio.startsWith("test/integracion/") ||
      cambio.startsWith("migraciones/") ||
      cambio.startsWith("scripts/")
    ) {
      // `scripts/`: la integración lanza algunos como proceso aparte (no es un `import` que el grafo vea).
      return corre(`cambia ${cambio}, parte de la integración`);
    }
    if (cambio === ARCHIVO_DE_CI) {
      if (cambioDeCiAfecta(ci, JOBS_AJENOS_A_LA_INTEGRACION)) {
        return corre(`cambia ${cambio} en algo que puede afectar a la integración`);
      }
      continue;
    }
    if (cambio.startsWith("apps/") && !CONFIGURACION_DE_APPS.test(cambio)) {
      enApps.add(cambio);
      if (cambio in dependencias) enElGrafo.add(cambio);
      continue;
    }
    if (!(cambio in dependencias)) {
      return corre(`cambia ${cambio}, que el grafo de importaciones no explica`);
    }
    enElGrafo.add(cambio);
  }
  if (enElGrafo.size === 0 && enApps.size === 0) {
    return { corre: false, motivo: "el PR no cambia nada que afecte a la integración" };
  }
  const afectadas = pruebasAfectadas({ enElGrafo, enApps, dependencias, lecturas });
  const deIntegracion = [...afectadas.keys()].filter((prueba) =>
    prueba.startsWith("test/integracion/"),
  );
  if (deIntegracion.length > 0) {
    return corre(`${deIntegracion.length} prueba(s) de integración alcanzan lo que cambió`);
  }
  return { corre: false, motivo: "ninguna prueba de integración alcanza lo que cambió" };
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
  const definidos = JSON.parse(
    fs.readFileSync(path.join(raiz, "arquitectura/grupos-de-mutacion.json"), "utf8"),
  );
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
    estabilidad = planificarEstabilidad({ cambios, dependencias, ci });
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
  JOBS_AJENOS_A_LA_INTEGRACION,
  expandir,
  archivoDe,
  conEnlacesDelGuardian,
  leerArchivosDelGuardian,
};

if (require.main === module) principal();
