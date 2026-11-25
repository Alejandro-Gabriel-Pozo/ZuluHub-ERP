import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `npm run gate` y `gate-rapido.yml` son copias de lo que corre `ci.yml`: si una cambia y la otra no, un PR pasa el aviso
 * temprano y rompe el CI final (o al revés). Cierra el hueco que `gate-coincide-con-ci.test.ts` dejaba (compara jobs, `needs`,
 * `if` y timeouts, no lo que cada job ejecuta):
 *
 *  - los comandos del job `estatico` de `ci.yml` son los de `npm run gate` (menos `npm test`, que corre el job `pruebas`);
 *  - los jobs que `gate-rapido.yml` copia (`estatico`, `pruebas`, `web`, `componentes`) ejecutan lo mismo que en `ci.yml`, en
 *    el mismo orden: mismos `run:` y mismos `uses:` (acciones fijadas por SHA).
 *
 * Caso real que lo motiva: `gate-rapido.yml` compilaba solo `build:web` y `ci.yml` también `build:plataforma`; un PR que
 * rompía la consola pasaba el aviso temprano y fallaba recién en el CI final.
 *
 * LÍMITES (como `gate-coincide-con-ci.test.ts`: no hay un lector de YAML entre las dependencias directas): es un análisis de
 * TEXTO del estilo que Prettier impone (jobs a 2 espacios, `run:` en una línea o en bloque `|`/`>`). Compara `run:` y `uses:`,
 * no `with:`, `env:`, `name:` ni `timeout-minutes` (que pueden diferir a propósito). No ve `service containers` ni condiciones.
 */

const RAIZ = join(import.meta.dirname, "../..");
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");

/** Los pasos que un job ejecuta, en orden: `run <comando>` y `uses <acción@sha>`. `null` si el job no existe. */
function pasosDeJob(yaml: string, job: string): string[] | null {
  const lineas = yaml.split("\n");
  const inicio = lineas.findIndex((linea) => linea === `  ${job}:`);
  if (inicio === -1) return null;
  const pasos: string[] = [];
  for (let i = inicio + 1; i < lineas.length; i += 1) {
    const linea = lineas[i] as string;
    if (/^ {2}\S/.test(linea) || /^\S/.test(linea)) break; // otro job, u otra sección
    const sangria = linea.length - linea.trimStart().length;
    const contenido = linea.trim().replace(/^- /, "");
    const uses = /^uses:\s*(\S+)/.exec(contenido);
    if (uses !== null) {
      pasos.push(`uses ${uses[1]}`);
      continue;
    }
    const run = /^run:\s*(.*)$/.exec(contenido);
    if (run === null) continue;
    const valor = (run[1] as string).trim();
    if (valor !== "|" && valor !== ">" && valor !== "|-" && valor !== ">-") {
      pasos.push(`run ${valor}`);
      continue;
    }
    const bloque: string[] = [];
    for (let j = i + 1; j < lineas.length; j += 1) {
      const siguiente = lineas[j] as string;
      const hondo = siguiente.length - siguiente.trimStart().length;
      if (siguiente.trim() !== "" && hondo <= sangria) break;
      bloque.push(siguiente.trim());
      i = j;
    }
    pasos.push(`run ${bloque.filter((renglon) => renglon !== "").join(" ")}`);
  }
  return pasos;
}

/** Los comandos de `run` de un job (sin `uses`), en orden. */
const comandosDe = (pasos: readonly string[]) =>
  pasos.filter((paso) => paso.startsWith("run ")).map((paso) => paso.slice(4));

/** Los scripts que encadena `npm run gate` (el texto del script de `package.json`). */
function pasosDelGate(paquete: string): string[] {
  const script = (JSON.parse(paquete) as { scripts: Record<string, string> }).scripts["gate"];
  if (script === undefined) throw new Error("package.json no tiene el script `gate`");
  return script.split("&&").map((paso) => paso.trim());
}

/** Qué no coincide entre el job `estatico` de `ci.yml` y `npm run gate`. */
function diferenciasConElGate(ci: string, paquete: string): string[] {
  const estatico = pasosDeJob(ci, "estatico");
  const pruebas = pasosDeJob(ci, "pruebas");
  if (estatico === null) return ["ci.yml no tiene el job `estatico`"];
  if (pruebas === null) return ["ci.yml no tiene el job `pruebas`"];
  const delGate = pasosDelGate(paquete);
  const enElCi = comandosDe(estatico).filter((comando) => comando !== "npm ci");
  const problemas: string[] = [];
  if (delGate.at(-1) !== "npm test") problemas.push("`npm run gate` ya no termina en `npm test`");
  if (comandosDe(pruebas).at(-1) !== "npm test") {
    problemas.push("el job `pruebas` de ci.yml ya no termina en `npm test`");
  }
  const estaticosDelGate = delGate.slice(0, -1);
  if (JSON.stringify(enElCi) !== JSON.stringify(estaticosDelGate)) {
    problemas.push(
      `el job \`estatico\` de ci.yml corre [${enElCi.join(" · ")}] y \`npm run gate\` [${estaticosDelGate.join(" · ")}]`,
    );
  }
  return problemas;
}

/** Qué jobs de `gate-rapido.yml` ejecutan algo distinto que el mismo job de `ci.yml`. */
function diferenciasConElRapido(ci: string, rapido: string, jobs: readonly string[]): string[] {
  const problemas: string[] = [];
  for (const job of jobs) {
    const delCi = pasosDeJob(ci, job);
    const delRapido = pasosDeJob(rapido, job);
    if (delCi === null) problemas.push(`${job}: ci.yml no tiene el job`);
    else if (delRapido === null) problemas.push(`${job}: gate-rapido.yml no tiene el job`);
    else if (JSON.stringify(delCi) !== JSON.stringify(delRapido)) {
      const soloCi = delCi.filter((paso) => !delRapido.includes(paso));
      const soloRapido = delRapido.filter((paso) => !delCi.includes(paso));
      problemas.push(
        `${job}: ci.yml y gate-rapido.yml no ejecutan lo mismo (solo en ci.yml: [${soloCi.join(" · ")}]; solo en gate-rapido.yml: [${soloRapido.join(" · ")}]; el orden también cuenta)`,
      );
    }
  }
  return problemas;
}

/** El texto de un job (de su encabezado al siguiente job o al final). */
function cuerpoDeJob(yaml: string, job: string): string {
  const inicio = yaml.indexOf(`\n  ${job}:\n`);
  if (inicio === -1) throw new Error(`no existe el job ${job}`);
  const resto = yaml.slice(inicio + 1);
  const fin = resto.slice(1).search(/\n {2}[a-z0-9-]+:\n/);
  return fin === -1 ? resto : resto.slice(0, fin + 1);
}

/**
 * Evalúa una condición `${{ … }}` de un job con el único vocabulario que usan estos workflows: `!cancelled()`, `needs.hay-pr.result`, `needs.hay-pr.outputs.omitir`,
 * textos entre comillas simples, `==`, `!=`, `&&`, `||`, `!` y paréntesis. Cualquier otra cosa lanza (no se adivina).
 */
function evaluarCondicion(
  expresion: string,
  entorno: { resultado: string; omitir: string; cancelada: boolean },
): boolean {
  const texto = /^\$\{\{\s*([\s\S]*?)\s*\}\}$/.exec(expresion.trim())?.[1];
  if (texto === undefined) throw new Error(`no es una condición \${{ }}: ${expresion}`);
  const fichas = texto.match(/'[^']*'|!=|==|&&|\|\||[()!]|[A-Za-z_][\w.()-]*/g) ?? [];
  if (fichas.join("").length < texto.replace(/\s+/g, "").length) {
    throw new Error(`la condición usa algo que este evaluador no entiende: ${texto}`);
  }
  let i = 0;
  type Valor = string | boolean;
  const valorDe = (ficha: string): Valor => {
    if (ficha.startsWith("'")) return ficha.slice(1, -1);
    if (ficha === "needs.hay-pr.result") return entorno.resultado;
    if (ficha === "needs.hay-pr.outputs.omitir") return entorno.omitir;
    if (ficha === "cancelled()") return entorno.cancelada;
    throw new Error(`referencia desconocida: ${ficha}`);
  };
  const primario = (): Valor => {
    const ficha = fichas[i++] as string;
    if (ficha === "(") {
      const v = o();
      i++; // ")"
      return v;
    }
    if (ficha === "!") return !primario();
    return valorDe(ficha);
  };
  const comparacion = (): Valor => {
    const izquierda = primario();
    const operador = fichas[i];
    if (operador === "==" || operador === "!=") {
      i++;
      const derecha = primario();
      return operador === "==" ? izquierda === derecha : izquierda !== derecha;
    }
    return izquierda;
  };
  const y = (): Valor => {
    let v = comparacion();
    while (fichas[i] === "&&") {
      i++;
      const siguiente = comparacion();
      v = Boolean(v) && Boolean(siguiente);
    }
    return v;
  };
  const o = (): Valor => {
    let v = y();
    while (fichas[i] === "||") {
      i++;
      const siguiente = y();
      v = Boolean(v) || Boolean(siguiente);
    }
    return v;
  };
  const resultado = o();
  if (i !== fichas.length) throw new Error(`sobran fichas en la condición: ${texto}`);
  return Boolean(resultado);
}

const JOBS_COPIADOS = ["estatico", "pruebas", "web", "componentes"] as const;

describe("el repositorio real", () => {
  const ci = leer(".github/workflows/ci.yml");
  const rapido = leer(".github/workflows/gate-rapido.yml");

  it("el job `estatico` de ci.yml corre lo mismo que `npm run gate` (menos las pruebas)", () => {
    expect(diferenciasConElGate(ci, leer("package.json"))).toEqual([]);
  });

  it("los jobs que gate-rapido.yml copia ejecutan lo mismo que en ci.yml", () => {
    expect(diferenciasConElRapido(ci, rapido, JOBS_COPIADOS)).toEqual([]);
  });

  it("gate-rapido.yml copia exactamente esos 4 jobs: un job nuevo hay que clasificarlo acá", () => {
    const jobs = [...rapido.matchAll(/^ {2}([a-z0-9-]+):\s*$/gm)]
      .map((m) => m[1])
      .filter((nombre) => rapido.indexOf(`  ${nombre}:`) > rapido.indexOf("\njobs:"));
    expect(jobs).toEqual(["hay-pr", ...JOBS_COPIADOS]);
  });

  /**
   * Con un pull request abierto para la rama, `ci.yml` ya corre lo mismo en cada push: el aviso temprano se saltea (job `hay-pr`). Previene: pagar dos veces el estático y las
   * pruebas de cada push a una rama con PR. Ante la duda (la consulta falla, la salida viene vacía o no es un número) los cuatro jobs CORREN. La regla se EVALÚA (no se compara
   * su texto): una condición invertida pasaría una comparación de texto y haría justo lo contrario (caso real: `!= '0'` corría con PR y saltaba sin PR).
   */
  it("la condición de los cuatro jobs copiados se evalúa: con PR abierto se saltea; sin PR, con la consulta caída o con la salida vacía corre", () => {
    for (const job of JOBS_COPIADOS) {
      const cuerpo = cuerpoDeJob(rapido, job);
      expect(cuerpo, job).toContain("    needs: hay-pr\n");
      const si = /^ {4}if: (.+)$/m.exec(cuerpo)?.[1];
      expect(si, job).toBeDefined();
      const corre = (resultado: string, omitir: string, cancelada = false) =>
        evaluarCondicion(si ?? "", { resultado, omitir, cancelada });
      expect(corre("success", "true"), `${job}: con PR abierto`).toBe(false);
      expect(corre("success", "false"), `${job}: sin PR`).toBe(true);
      expect(corre("success", ""), `${job}: salida vacía`).toBe(true);
      expect(corre("failure", ""), `${job}: consulta caída`).toBe(true);
      expect(corre("failure", "true"), `${job}: consulta caída con salida vieja`).toBe(false);
      expect(corre("success", "false", true), `${job}: corrida cancelada`).toBe(false);
    }
  });

  it("VIOLACIÓN: la condición invertida (corre con PR, se saltea sin PR) y la que se saltea ante la consulta caída se detectan al evaluar", () => {
    const invertida = "${{ !cancelled() && needs.hay-pr.outputs.omitir == 'true' }}";
    expect(
      evaluarCondicion(invertida, { resultado: "success", omitir: "true", cancelada: false }),
    ).toBe(true); // debería ser false
    expect(
      evaluarCondicion(invertida, { resultado: "success", omitir: "false", cancelada: false }),
    ).toBe(false); // debería ser true
    const frágil = "${{ !cancelled() && needs.hay-pr.outputs.omitir == 'false' }}";
    expect(evaluarCondicion(frágil, { resultado: "failure", omitir: "", cancelada: false })).toBe(
      false,
    ); // debería ser true
  });

  it("el script de hay-pr: `omitir` es true solo si hay uno o más pull requests abiertos (cero, vacío o algo que no es un número: false)", () => {
    const cuerpo = cuerpoDeJob(rapido, "hay-pr");
    const caso = /^ {10}case "\$\{abiertos\}" in\n[\s\S]*?^ {10}esac$/m.exec(cuerpo)?.[0];
    expect(caso).toBeDefined();
    const omitir = (abiertos: string) =>
      spawnSync("bash", ["-c", `abiertos=$1\n${caso ?? ""}\necho "$omitir"`, "_", abiertos], {
        encoding: "utf8",
      }).stdout.trim();
    for (const [abiertos, esperado] of [
      ["0", "false"],
      ["1", "true"],
      ["2", "true"],
      ["12", "true"],
      ["", "false"],
      ["x", "false"],
      ["-1", "false"],
      ["1x", "false"],
      ["null", "false"],
    ] as const) {
      expect(omitir(abiertos), `abiertos="${abiertos}"`).toBe(esperado);
    }
  });

  it("hay-pr consulta por REST solo los pull requests abiertos de la rama, con permisos de solo lectura y sin interpolar nada en el comando", () => {
    const cuerpo = cuerpoDeJob(rapido, "hay-pr");
    expect(cuerpo).toContain("pull-requests: read");
    expect(cuerpo).not.toMatch(/(?:contents|pull-requests|actions|issues): write/);
    expect(cuerpo).toContain('gh api -X GET "repos/${REPOSITORIO}/pulls"');
    expect(cuerpo).toContain('-f head="${DUENIO}:${RAMA}" -f state=open --jq length');
    expect(cuerpo).toContain("RAMA: ${{ github.ref_name }}");
    expect(cuerpo).toContain("omitir: ${{ steps.consulta.outputs.omitir }}");
    expect(cuerpo).not.toMatch(/run:[\s\S]*\$\{\{/);
  });
});

describe("pasosDeJob (lo que entiende)", () => {
  const YAML = [
    "jobs:",
    "  a:",
    "    steps:",
    "      - uses: actions/checkout@abc # v1",
    "      - run: npm ci",
    "      - name: Largo",
    "        run: |",
    "          if x; then",
    '            echo "ok"',
    "          fi",
    "      - run: >-",
    "          uno",
    "          dos",
    "      # run: comentado",
    "  b:",
    "    steps:",
    "      - run: npm test",
    "",
  ].join("\n");

  it("lista los `uses` y los `run` en orden, uniendo los bloques", () => {
    expect(pasosDeJob(YAML, "a")).toEqual([
      "uses actions/checkout@abc",
      "run npm ci",
      'run if x; then echo "ok" fi',
      "run uno dos",
    ]);
    expect(pasosDeJob(YAML, "b")).toEqual(["run npm test"]);
    expect(pasosDeJob(YAML, "c")).toBeNull();
  });
});

describe("violaciones inyectadas: ci.yml y `npm run gate`", () => {
  const PAQUETE = JSON.stringify({
    scripts: { gate: "npm run typecheck && npm run lint && npm test" },
  });
  const CI = (estatico: string[], pruebas: string[] = ["npm test"]) =>
    [
      "jobs:",
      "  estatico:",
      "    steps:",
      ...estatico.map((c) => `      - run: ${c}`),
      "  pruebas:",
      "    steps:",
      ...pruebas.map((c) => `      - run: ${c}`),
      "",
    ].join("\n");
  const BIEN = CI(["npm ci", "npm run typecheck", "npm run lint"]);

  it("lo que coincide no dice nada", () => {
    expect(diferenciasConElGate(BIEN, PAQUETE)).toEqual([]);
  });

  it("un paso que sobra, que falta o en otro orden en `estatico` falla", () => {
    const aviso = (estatico: string[]) => diferenciasConElGate(CI(estatico), PAQUETE).join("\n");
    expect(aviso(["npm ci", "npm run typecheck", "npm run lint", "npm run formato"])).toBe(
      "el job `estatico` de ci.yml corre [npm run typecheck · npm run lint · npm run formato] y `npm run gate` [npm run typecheck · npm run lint]",
    );
    expect(aviso(["npm ci", "npm run typecheck"])).toContain("corre [npm run typecheck] y");
    expect(aviso(["npm ci", "npm run lint", "npm run typecheck"])).toContain(
      "corre [npm run lint · npm run typecheck]",
    );
  });

  it("`npm run gate` sin `npm test` al final, o el job `pruebas` sin él, falla", () => {
    const sinTest = JSON.stringify({ scripts: { gate: "npm run typecheck && npm run lint" } });
    expect(diferenciasConElGate(BIEN, sinTest)).toContain(
      "`npm run gate` ya no termina en `npm test`",
    );
    expect(
      diferenciasConElGate(
        CI(["npm ci", "npm run typecheck", "npm run lint"], ["npm run x"]),
        PAQUETE,
      ),
    ).toEqual(["el job `pruebas` de ci.yml ya no termina en `npm test`"]);
  });

  it("sin job `estatico` o sin job `pruebas` falla, y sin script `gate` lanza", () => {
    expect(diferenciasConElGate("jobs:\n  pruebas:\n    steps:\n", PAQUETE)).toEqual([
      "ci.yml no tiene el job `estatico`",
    ]);
    expect(diferenciasConElGate("jobs:\n  estatico:\n    steps:\n", PAQUETE)).toEqual([
      "ci.yml no tiene el job `pruebas`",
    ]);
    expect(() => diferenciasConElGate(BIEN, JSON.stringify({ scripts: {} }))).toThrow(
      "package.json no tiene el script `gate`",
    );
  });
});

describe("violaciones inyectadas: ci.yml y gate-rapido.yml", () => {
  const yaml = (pasos: Record<string, string[]>) =>
    [
      "jobs:",
      ...Object.entries(pasos).flatMap(([job, comandos]) => [
        `  ${job}:`,
        "    steps:",
        ...comandos.map((c) =>
          c.startsWith("uses ") ? `      - ${c.replace("uses ", "uses: ")}` : `      - run: ${c}`,
        ),
      ]),
      "",
    ].join("\n");
  const BASE = { web: ["uses a/b@111", "npm run build:web", "npm run build:plataforma"] };

  it("lo igual no dice nada", () => {
    expect(diferenciasConElRapido(yaml(BASE), yaml(BASE), ["web"])).toEqual([]);
  });

  it("un build que el rápido no corre (el caso real de build:plataforma) falla, nombrando qué falta", () => {
    expect(
      diferenciasConElRapido(yaml(BASE), yaml({ web: ["uses a/b@111", "npm run build:web"] }), [
        "web",
      ]),
    ).toEqual([
      "web: ci.yml y gate-rapido.yml no ejecutan lo mismo (solo en ci.yml: [run npm run build:plataforma]; solo en gate-rapido.yml: []; el orden también cuenta)",
    ]);
  });

  it("una acción con otro SHA, un paso de más o el mismo contenido en otro orden falla", () => {
    expect(
      diferenciasConElRapido(yaml(BASE), yaml({ web: ["uses a/b@222", ...BASE.web.slice(1)] }), [
        "web",
      ]),
    ).toEqual([
      "web: ci.yml y gate-rapido.yml no ejecutan lo mismo (solo en ci.yml: [uses a/b@111]; solo en gate-rapido.yml: [uses a/b@222]; el orden también cuenta)",
    ]);
    expect(
      diferenciasConElRapido(yaml(BASE), yaml({ web: [...BASE.web, "npm run extra"] }), ["web"]),
    ).toHaveLength(1);
    expect(
      diferenciasConElRapido(
        yaml(BASE),
        yaml({ web: ["npm run build:plataforma", "npm run build:web", "uses a/b@111"] }),
        ["web"],
      ),
    ).toHaveLength(1);
  });

  it("un job que falta en cualquiera de los dos falla", () => {
    expect(diferenciasConElRapido(yaml(BASE), yaml({ otro: ["x"] }), ["web"])).toEqual([
      "web: gate-rapido.yml no tiene el job",
    ]);
    expect(diferenciasConElRapido(yaml({ otro: ["x"] }), yaml(BASE), ["web"])).toEqual([
      "web: ci.yml no tiene el job",
    ]);
  });
});

describe("el timeout de `pruebas` del Gate rápido no es menor que el de ci.yml", () => {
  // Previene: la cancelación por timeout con la suite al borde de 20 min (run 43989591478 del 17/11/2026: 20 min 16 s y 20 min 5 s cancelados y un tercer intento que pasó con
  // 19 min 27 s); ambos workflows corren la misma suite con el mismo Postgres y un límite menor en el aviso temprano lo deja «unstable» sin que nada falle de verdad.
  /** Los minutos de `timeout-minutes` del job (a 4 espacios), o `null` si el job no existe o no lo declara. */
  function timeoutDeJob(yaml: string, job: string): number | null {
    const lineas = yaml.split("\n");
    const inicio = lineas.findIndex((linea) => linea === `  ${job}:`);
    if (inicio === -1) return null;
    for (let i = inicio + 1; i < lineas.length; i += 1) {
      const linea = lineas[i] as string;
      if (/^ {2}\S/.test(linea) || /^\S/.test(linea)) return null;
      const m = /^ {4}timeout-minutes:\s*(\d+)\s*(?:#.*)?$/.exec(linea);
      if (m !== null) return Number(m[1]);
    }
    return null;
  }
  const faltaMargen = (ci: string, rapido: string): string | null => {
    const enCi = timeoutDeJob(ci, "pruebas");
    const enRapido = timeoutDeJob(rapido, "pruebas");
    if (enCi === null || enRapido === null)
      return "pruebas: falta `timeout-minutes` en ci.yml o en gate-rapido.yml";
    return enRapido < enCi
      ? `pruebas: gate-rapido.yml tiene ${enRapido} min y ci.yml ${enCi}: el aviso temprano se cancela antes que el CI final`
      : null;
  };

  it("el job `pruebas` de gate-rapido.yml no tiene un timeout menor que el de ci.yml", () => {
    expect(
      faltaMargen(leer(".github/workflows/ci.yml"), leer(".github/workflows/gate-rapido.yml")),
    ).toBeNull();
    // Con `pruebas` en fragmentos (cada uno ~7 min) el tope por fragmento es 20 en los dos workflows; el piso de 25 era del job monolítico.
    expect(
      timeoutDeJob(leer(".github/workflows/gate-rapido.yml"), "pruebas"),
    ).toBeGreaterThanOrEqual(
      timeoutDeJob(leer(".github/workflows/ci.yml"), "pruebas") ?? Number.POSITIVE_INFINITY,
    );
  });

  it("violaciones inyectadas: menor, ausente, job faltante y job que no declara el tope", () => {
    const con = (minutos: number | null) =>
      `jobs:\n  pruebas:\n    runs-on: x\n${minutos === null ? "" : `    timeout-minutes: ${minutos}\n`}  otro:\n    timeout-minutes: 99\n`;
    expect(faltaMargen(con(25), con(20))).toBe(
      "pruebas: gate-rapido.yml tiene 20 min y ci.yml 25: el aviso temprano se cancela antes que el CI final",
    );
    expect(faltaMargen(con(25), con(24))).not.toBeNull();
    expect(faltaMargen(con(25), con(25))).toBeNull();
    expect(faltaMargen(con(25), con(30))).toBeNull();
    expect(faltaMargen(con(25), con(null))).toContain("falta `timeout-minutes`");
    expect(faltaMargen(con(null), con(25))).toContain("falta `timeout-minutes`");
    expect(faltaMargen(con(25), "jobs:\n  web:\n    timeout-minutes: 30\n")).toContain(
      "falta `timeout-minutes`",
    );
    // el tope de OTRO job no cuenta
    expect(timeoutDeJob(con(null), "pruebas")).toBeNull();
  });
});
