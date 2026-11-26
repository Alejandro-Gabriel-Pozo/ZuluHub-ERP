/**
 * `npm run previo`: las comprobaciones locales que se corren antes de empujar, en orden y cortando en la primera falla.
 *
 * Previene: las ejecuciones rojas del CI por olvido local (tipo exportado sin uso que detecta knip, arquitectura o composición no
 * corridas: #612 en 4 rondas, #621, #603) y los choques entre pull requests en paralelo (#619 contra una prueba nueva de #617).
 * No reemplaza al gate completo: el CI lo sigue corriendo; esto reproduce solo lo que más veces falló por no haberse corrido.
 * Aprobado por el dueño el 26/11/2026 («Sí a las dos, a tu recomendación»). Chequeo que falla si se quita un paso:
 * `test/arquitectura/previo.test.ts`.
 *
 * Los pasos fijos son comandos que ya existen (sin dependencias nuevas). `arquitectura` es el comando de siempre; `arquitectura-con-la-base`
 * repite con la rama base los controles que el CI corre comparando contra ella (deuda, campos sin dato, decisiones y su cuota, guardián
 * que no se debilita): sin base solo ven el árbol propio y no detectan «deuda nueva» ni la cuota. `pruebas-de-arquitectura` son las pruebas de
 * `test/arquitectura` (archivos centrales, acción con caso de uso, catálogo de módulos, grupos de mutación), que `npm run arquitectura`
 * no corre y que fallaron en seis ejecuciones del CI. El último paso, las pruebas, sale del diff contra la base: `vitest related` corre las
 * pruebas que importan lo que cambió (incluye las de integración de los módulos que consumen un contrato tocado). Si el diff no se puede
 * inferir, lo dice y corta (fail closed): se indica el módulo con `npm run previo -- <módulo>`.
 */
const { spawn, spawnSync } = require("node:child_process");
const { Buffer } = require("node:buffer");
const { existsSync, mkdtempSync, readdirSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const RAIZ = join(__dirname, "..");
const RAMA_BASE = "integracion/modulos-v2";
/** Orden de la base: la variable de entorno, la rama de integración y, si no está, `main`. */
const CANDIDATAS_DE_BASE = [`origin/${RAMA_BASE}`, "origin/main"];

/** Los pasos fijos, en orden. El nombre (`id`) es lo que fija `test/arquitectura/previo.test.ts`. */
const PASOS_FIJOS = [
  { id: "tipos", comando: ["npm", "run", "typecheck"] },
  { id: "formato", comando: ["npm", "run", "format:check"] },
  { id: "lint", comando: ["npm", "run", "lint"] },
  { id: "codigo-muerto", comando: ["npm", "run", "analizar:muerto"] },
  { id: "arquitectura", comando: ["npm", "run", "arquitectura"] },
  { id: "arquitectura-con-la-base", comando: ["node", "arquitectura/previo.cjs", "--con-la-base"] },
  {
    id: "pruebas-de-arquitectura",
    comando: ["npx", "vitest", "run", "--project", "node", "test/arquitectura"],
  },
  { id: "composicion", comando: ["npx", "vitest", "run", "--project", "node", "src/composicion"] },
];

/**
 * Cachés de transformación de vite que, vencidas, hacen fallar `test/arquitectura/grafo.test.ts` con «Unknown variable dynamic import»: su `import()` con
 * variable se resuelve al transformar, y un transformado cacheado antes de que entrara un archivo nuevo (por un merge de la integración) no lo incluye. El CI,
 * sin caché, no lo ve. Solo se borran ante ese síntoma (borrarlas siempre encarecería cada corrida con transformación en frío) y se repite UNA vez.
 */
const CACHES_DE_VITE = [
  "node_modules/.vite",
  "node_modules/.vite-temp",
  "node_modules/.vitest-cache",
];
const SINTOMA_DE_CACHE_VIEJA = /Unknown variable dynamic import/;

/** ¿Esta falla de vitest es el síntoma de la caché vieja de `grafo.test.ts`? Función pura. */
function esCacheVieja(comando, salidaCompleta) {
  return (
    comando.includes("vitest") &&
    SINTOMA_DE_CACHE_VIEJA.test(salidaCompleta) &&
    /grafo\.test\.ts/.test(salidaCompleta)
  );
}

/**
 * Corre un paso; si falla por la caché vieja, la limpia y lo repite UNA vez (sin saltear nada: si vuelve a fallar, la falla vale).
 * `ejecutar(comando)` devuelve `{ ok, segundos, salida }` y `limpiar()` borra las cachés; se inyectan para probarlo.
 */
async function correrConReintentoPorCacheVieja(comando, ejecutar, limpiar) {
  const primera = await ejecutar(comando);
  if (primera.ok || !esCacheVieja(comando, primera.salida)) {
    return { ok: primera.ok, segundos: primera.segundos, cacheLimpiada: false };
  }
  limpiar();
  const segunda = await ejecutar(comando);
  return {
    ok: segunda.ok,
    segundos: primera.segundos + segunda.segundos,
    cacheLimpiada: true,
  };
}

function limpiarCachesDeVite() {
  for (const ruta of CACHES_DE_VITE) rmSync(join(RAIZ, ruta), { recursive: true, force: true });
}

/** Corre un comando mostrando su salida en vivo y guardándola para reconocer fallas conocidas. */
function ejecutarConSalida(comando) {
  return new Promise((resolver) => {
    const t0 = Date.now();
    const trozos = [];
    const hijo = spawn(comando[0], comando.slice(1), {
      cwd: RAIZ,
      stdio: ["inherit", "pipe", "pipe"],
    });
    hijo.stdout.on("data", (d) => {
      process.stdout.write(d);
      trozos.push(d);
    });
    hijo.stderr.on("data", (d) => {
      process.stderr.write(d);
      trozos.push(d);
    });
    hijo.on("error", () => resolver({ ok: false, segundos: 0, salida: "" }));
    hijo.on("close", (codigo) =>
      resolver({
        ok: codigo === 0,
        segundos: Math.round((Date.now() - t0) / 1000),
        salida: Buffer.concat(trozos).toString("utf8"),
      }),
    );
  });
}

const EXTENSIONES_DE_CODIGO = /\.(ts|tsx)$/;
/**
 * Qué pruebas correr según los archivos del diff. Función pura.
 * @param {{ archivos: string[] | null, modulo?: string, modulosExistentes: string[] }} entrada
 * @returns {{ tipo: "modulo", modulo: string, filtro: string }
 *   | { tipo: "relacionadas", archivos: string[], aviso: string[] }
 *   | { tipo: "nada", aviso: string[] }
 *   | { tipo: "no-inferible", motivo: string }}
 */
function planDeLasPruebas({ archivos, modulo, modulosExistentes }) {
  if (modulo !== undefined) {
    if (!modulosExistentes.includes(modulo)) {
      return {
        tipo: "no-inferible",
        motivo: `«${modulo}» no es un módulo de src/modulos (hay: ${modulosExistentes.join(", ")}).`,
      };
    }
    return { tipo: "modulo", modulo, filtro: `src/modulos/${modulo}/` };
  }
  if (archivos === null) {
    return {
      tipo: "no-inferible",
      motivo:
        "No pude calcular el diff contra la base (sin `origin/" +
        `${RAMA_BASE}` +
        "` ni `origin/main` en el clon local).",
    };
  }
  const codigo = archivos.filter(
    (a) => EXTENSIONES_DE_CODIGO.test(a) && (a.startsWith("src/") || a.startsWith("test/")),
  );
  const aviso = [];
  if (archivos.some((a) => a.startsWith("apps/"))) {
    aviso.push(
      "Tocaste `apps/`: este paso no corre `test:componentes` ni `test:recorrido` (necesitan Chromium y la compilación); corrélos aparte según CLAUDE.md.",
    );
  }
  if (codigo.length === 0) return { tipo: "nada", aviso };
  return { tipo: "relacionadas", archivos: codigo, aviso };
}

/** Los comandos de vitest para un plan (vacío si no hay nada que correr). Función pura. */
function comandosDelPlan(plan) {
  const base = ["npx", "vitest", "run", "--project", "node"];
  if (plan.tipo === "modulo") return [[...base, plan.filtro]];
  if (plan.tipo !== "relacionadas") return [];
  return [
    [
      "npx",
      "vitest",
      "related",
      "--run",
      "--project",
      "node",
      "--passWithNoTests",
      ...plan.archivos,
    ],
  ];
}

function git(args) {
  const r = spawnSync("git", args, { cwd: RAIZ, encoding: "utf8" });
  return r.status === 0 ? r.stdout : null;
}

/** La referencia contra la que se compara: `PEDERNAL_BASE`, la rama de integración o `main`. */
function referenciaDeBase() {
  const candidatas = [process.env.PEDERNAL_BASE, ...CANDIDATAS_DE_BASE].filter(
    (c) => c !== undefined && c !== "",
  );
  return candidatas.find((c) => git(["rev-parse", "--verify", "--quiet", c]) !== null) ?? null;
}

/** Archivos que cambiaron contra la base (confirmados, sin confirmar y nuevos sin agregar) o `null` si no se puede calcular. */
function archivosDelDiff(referencia) {
  if (referencia === null) return null;
  const ancestro = git(["merge-base", "HEAD", referencia]);
  if (ancestro === null) return null;
  const cambiados = git(["diff", "--name-only", "--diff-filter=ACMR", ancestro.trim()]);
  const nuevos = git(["ls-files", "--others", "--exclude-standard"]);
  if (cambiados === null || nuevos === null) return null;
  return [...new Set([...cambiados.split("\n"), ...nuevos.split("\n")])]
    .filter((a) => a !== "" && existsSync(join(RAIZ, a)))
    .sort();
}

/** Avisa si la rama no contiene lo último de la base: sin eso no se ven los choques con otros PR en paralelo. */
function avisoDeAtraso(referencia) {
  if (referencia === null) return null;
  const atras = git(["rev-list", "--count", `HEAD..${referencia}`]);
  if (atras === null || Number(atras.trim()) === 0) return null;
  return `Tu rama está ${atras.trim()} commit(s) atrás de ${referencia}: traé la integración con merge (git fetch y git merge ${referencia}) y volvé a correr \`previo\`; si no, los choques con otros PR recién se ven en el CI.`;
}

const salida = (texto) => process.stdout.write(`${texto}\n`);
const salidaDeError = (texto) => process.stderr.write(`${texto}\n`);

/** Los controles que el CI corre contra la rama base, con una copia de la base en un directorio temporal. Devuelve el código de salida. */
function conLaBase() {
  const referencia = referenciaDeBase();
  if (referencia === null) {
    salidaDeError(
      "previo: sin rama base en el clon local (`origin/" +
        `${RAMA_BASE}` +
        "`): no se pudo comparar contra ella. Hacé `git fetch origin` y repetí; el CI sí la compara.",
    );
    return 1;
  }
  const dir = mkdtempSync(join(tmpdir(), "previo-base-"));
  try {
    if (git(["worktree", "add", "--detach", dir, referencia]) === null) {
      salidaDeError(`previo: no pude extraer ${referencia} en ${dir}.`);
      return 1;
    }
    const controles = [
      ["arquitectura/contratos/no-debilitar.cjs", "--arbol", "."],
      ["arquitectura/deuda/deuda.cjs", `--base=${dir}`],
      ["arquitectura/deuda/campos-sin-dato.cjs", `--base=${dir}`],
      ["arquitectura/decisiones/decisiones.cjs", `--base=${dir}`],
    ];
    for (const [script, ...resto] of controles) {
      // El de «no se debilita» es el de la BASE mirando el árbol propio; si la base todavía no lo trae, se avisa y se sigue (como el CI).
      const ruta = script.includes("no-debilitar") ? join(dir, script) : join(RAIZ, script);
      if (!existsSync(ruta)) {
        salida(`previo: ${referencia} no trae ${script}; no hay versión anterior que vigile.`);
        continue;
      }
      if (!correr(["node", ruta, ...resto]).ok) return 1;
    }
    return 0;
  } finally {
    git(["worktree", "remove", "--force", dir]);
    rmSync(dir, { recursive: true, force: true });
    git(["worktree", "prune"]);
  }
}

function correr(comando) {
  const t0 = Date.now();
  const r = spawnSync(comando[0], comando.slice(1), { cwd: RAIZ, stdio: "inherit" });
  return { ok: r.status === 0, segundos: Math.round((Date.now() - t0) / 1000) };
}

async function main(argv) {
  if (argv.includes("--con-la-base")) return conLaBase();
  const modulo = argv.find((a) => !a.startsWith("-"));
  const modulosExistentes = readdirSync(join(RAIZ, "src", "modulos"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  // Best effort: sin red, o sin `origin`, se sigue con lo que haya en el clon.
  spawnSync("git", ["fetch", "--quiet", "origin", RAMA_BASE], { cwd: RAIZ, stdio: "ignore" });
  const referencia = referenciaDeBase();
  const plan = planDeLasPruebas({
    archivos: modulo === undefined ? archivosDelDiff(referencia) : null,
    modulo,
    modulosExistentes,
  });
  if (plan.tipo === "no-inferible") {
    salidaDeError(`previo: ${plan.motivo}`);
    salidaDeError("Indicá el módulo cuyas pruebas correr: `npm run previo -- <módulo>`.");
    return 1;
  }

  const pasos = [
    ...PASOS_FIJOS,
    ...comandosDelPlan(plan).map((comando, i) => ({ id: `pruebas-${i + 1}`, comando })),
  ];
  const resumen = [];
  for (const paso of pasos) {
    salida(`\n== previo: ${paso.id} (${paso.comando.join(" ")})`);
    const { ok, segundos, cacheLimpiada } = await correrConReintentoPorCacheVieja(
      paso.comando,
      ejecutarConSalida,
      limpiarCachesDeVite,
    );
    if (cacheLimpiada) {
      salida(
        `previo: «${paso.id}» falló por la caché vieja de vite (grafo.test.ts); se limpió y se repitió una vez: ${ok ? "ahora pasa, caché vieja limpiada" : "vuelve a fallar, la falla vale"}.`,
      );
    }
    resumen.push(
      `${ok ? "ok   " : "FALLA"} ${paso.id} (${segundos} s${cacheLimpiada && ok ? ", caché vieja limpiada" : ""})`,
    );
    if (!ok) {
      salidaDeError(`\nprevio: falló «${paso.id}»; se corta acá.\n${resumen.join("\n")}`);
      return 1;
    }
  }

  salida(`\nprevio: todo en verde.\n${resumen.join("\n")}`);
  if (plan.tipo === "modulo") salida(`Pruebas del módulo indicado: ${plan.modulo}.`);
  if (plan.tipo === "nada")
    salida("Pruebas: el diff no toca código ni arquitectura; no había pruebas que inferir.");
  if (plan.tipo === "relacionadas") {
    salida(`Pruebas: las que importan ${plan.archivos.length} archivo(s) del diff.`);
  }
  for (const a of plan.aviso ?? []) salida(`Aviso: ${a}`);
  const atraso = avisoDeAtraso(referencia);
  if (atraso !== null) salida(`Aviso: ${atraso}`);
  salida("El gate completo lo corre el CI.");
  return 0;
}

module.exports = {
  PASOS_FIJOS,
  planDeLasPruebas,
  comandosDelPlan,
  esCacheVieja,
  correrConReintentoPorCacheVieja,
};

if (require.main === module) {
  main(process.argv.slice(2)).then((codigo) => {
    process.exitCode = codigo;
  });
}
