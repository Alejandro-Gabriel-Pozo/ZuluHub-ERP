import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `pruebas` corre en TRES fragmentos de la suite (`PEDERNAL_FRAGMENTO=i/3`, que `vitest.config.ts` pasa a la opción `shard` de Vitest; ver `arquitectura/fragmento-de-pruebas.cjs`, `ci.yml` y
 * `gate-rapido.yml`). Lo que NO puede pasar: que una prueba quede sin correr (un fragmento que no existe, un reparto que se pisa o deja huecos), que dos fragmentos corran la misma, o que un valor
 * mal escrito se ignore y el job corra la suite entera (o nada). Acá se comprueba con Vitest DE VERDAD sobre un proyecto de juguete cuya configuración usa EL MISMO módulo que la real (el reparto es el
 * de Vitest: por archivo, ordenados por el hash de su ruta y cortados en tramos parejos): la unión de los fragmentos es exactamente el conjunto de archivos, sin repetidos; un fragmento fuera de rango o
 * un total mayor que la cantidad de archivos FALLA en lugar de pasar vacío; y la configuración real (`vitest.config.ts`) de verdad lee la variable. Previene: el timeout de un job monolítico al borde del límite
 * (run 43989591478 del 17/11/2026) sin perder cobertura al partirlo. Límite: no corre la suite real tres veces (eso lo hace el CI).
 */
const RAIZ = join(import.meta.dirname, "../..");
const VITEST = join(RAIZ, "node_modules/vitest/vitest.mjs");
const MODULO = join(RAIZ, "arquitectura/fragmento-de-pruebas.cjs");
const require = createRequire(import.meta.url);
const { fragmentoDeLaCorrida } = require("../../arquitectura/fragmento-de-pruebas.cjs") as {
  fragmentoDeLaCorrida: (valor: string | undefined) => string | undefined;
};
const MUTANTE_ACTIVO: Record<string, string> =
  process.env["__STRYKER_ACTIVE_MUTANT__"] === undefined
    ? {}
    : { __STRYKER_ACTIVE_MUTANT__: process.env["__STRYKER_ACTIVE_MUTANT__"] };
const ARCHIVOS = Array.from(
  { length: 23 },
  (_, i) =>
    `${i % 3 === 0 ? "a/" : i % 3 === 1 ? "b/c/" : ""}prueba-${String(i).padStart(2, "0")}.test.mjs`,
);

describe("PEDERNAL_FRAGMENTO: lo que se acepta y lo que no", () => {
  it.each([undefined, ""])("sin pedir nada («%s») no hay fragmento: la suite entera", (valor) => {
    expect(fragmentoDeLaCorrida(valor)).toBeUndefined();
  });

  it.each(["1/1", "1/3", "2/3", "3/3", "9/9", "10/10", "99/99", "1/99"])(
    "«%s» se acepta tal cual",
    (valor) => {
      expect(fragmentoDeLaCorrida(valor)).toBe(valor);
    },
  );

  it.each([
    "0/3",
    "4/3",
    "100/100",
    "1/0",
    "01/3",
    "1/03",
    "1/ 3",
    " 1/3",
    "1/3 ",
    "1/3\n",
    "1-3",
    "1/3/3",
    "a/3",
    "1/b",
    "-1/3",
    "1.5/3",
    "uno/tres",
    "3",
    "/",
    "1/",
    "/3",
  ])("«%s» se rechaza (nada fuera de `indice/total`, con 1 <= indice <= total <= 99)", (valor) => {
    expect(() => fragmentoDeLaCorrida(valor)).toThrow("PEDERNAL_FRAGMENTO");
  });
});

function conProyecto<T>(usar: (carpeta: string) => T): T {
  const carpeta = mkdtempSync(join(tmpdir(), "shards-"));
  try {
    // La configuración del juguete usa el MISMO módulo que `vitest.config.ts` real.
    writeFileSync(
      join(carpeta, "vitest.config.mjs"),
      `import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);\nconst { fragmentoDeLaCorrida } = require(${JSON.stringify(MODULO)});\nconst fragmento = fragmentoDeLaCorrida(process.env["PEDERNAL_FRAGMENTO"]);\nexport default { test: { include: ["**/*.test.mjs"], globals: true, ...(fragmento === undefined ? {} : { shard: fragmento }) } };\n`,
    );
    for (const archivo of ARCHIVOS) {
      mkdirSync(join(carpeta, archivo, ".."), { recursive: true });
      writeFileSync(join(carpeta, archivo), `test("${archivo}", () => {});\n`);
    }
    return usar(carpeta);
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
}

/** Corre Vitest con la variable del fragmento (o sin ella) y devuelve el código y los archivos que ejecutó. */
function correr(
  carpeta: string,
  fragmento: string | undefined,
): { codigo: number; archivos: string[] } {
  const salida = join(carpeta, `salida-${(fragmento ?? "todo").replace("/", "-")}.json`);
  const r = spawnSync(
    process.execPath,
    [VITEST, "run", "--root", carpeta, "--reporter=json", `--outputFile=${salida}`],
    {
      cwd: carpeta,
      encoding: "utf8",
      env: {
        NODE_ENV: "test",
        PATH: process.env["PATH"] ?? "",
        ...MUTANTE_ACTIVO,
        ...(fragmento === undefined ? {} : { PEDERNAL_FRAGMENTO: fragmento }),
      },
    },
  );
  return { codigo: r.status ?? 1, archivos: archivosEjecutados(salida, carpeta) };
}

/** Los archivos que Vitest dice haber ejecutado (su informe JSON), o ninguno si no llegó a escribirlo (por ejemplo, porque no arrancó). */
function archivosEjecutados(salida: string, carpeta: string): string[] {
  try {
    const json = JSON.parse(readFileSync(salida, "utf8")) as { testResults: { name: string }[] };
    return json.testResults.map((t) => t.name.slice(carpeta.length + 1)).sort();
  } catch {
    return [];
  }
}

describe("fragmentos de la suite: cada archivo corre en uno y solo uno", () => {
  it("sin fragmento corre todo (control del juguete)", () => {
    conProyecto((carpeta) => {
      const r = correr(carpeta, undefined);
      expect(r.codigo).toBe(0);
      expect(r.archivos).toEqual([...ARCHIVOS].sort());
    });
  }, 120_000);

  it.each([2, 3, 4])(
    "con %s fragmentos: la unión es exactamente el conjunto de archivos, sin repetidos y casi parejos",
    (total) => {
      conProyecto((carpeta) => {
        const fragmentos = Array.from({ length: total }, (_, i) =>
          correr(carpeta, `${i + 1}/${total}`),
        );
        for (const f of fragmentos) expect(f.codigo).toBe(0);
        const todos = fragmentos.flatMap((f) => f.archivos).sort();
        expect(todos).toEqual([...ARCHIVOS].sort());
        expect(new Set(todos).size).toBe(ARCHIVOS.length); // ninguno dos veces
        const tamanos = fragmentos.map((f) => f.archivos.length);
        expect(Math.max(...tamanos) - Math.min(...tamanos)).toBeLessThanOrEqual(1);
      });
    },
    120_000,
  );

  it("un fragmento mal escrito, fuera de rango o con más fragmentos que archivos FALLA (no pasa vacío ni corre todo)", () => {
    conProyecto((carpeta) => {
      for (const valor of ["4/3", "0/3", "x/3", `1/${ARCHIVOS.length + 1}`]) {
        const r = correr(carpeta, valor);
        expect(r.codigo, valor).not.toBe(0);
        expect(r.archivos, valor).toEqual([]);
      }
    });
  }, 120_000);
});

describe("lo que declaran la configuración real, los workflows y package.json", () => {
  const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");
  const matriz = (yaml: string): number[] => {
    const inicio = yaml.indexOf("\n  pruebas:\n");
    const m = /^ {8}shard: \[([\d, ]+)\]$/m.exec(yaml.slice(inicio));
    return m === null ? [] : (m[1] as string).split(",").map((n) => Number(n.trim()));
  };

  it("`vitest.config.ts` real lee la variable: con 1/3 y un solo archivo de prueba, Vitest se niega (3 fragmentos > 1 archivo); con un valor inválido, no arranca", () => {
    const base = ["run", "--project", "node", "src/capacidades/sin-reloj-ni-azar.test.ts"];
    const con = (valor: string) =>
      spawnSync(process.execPath, [VITEST, ...base], {
        cwd: RAIZ,
        encoding: "utf8",
        env: {
          NODE_ENV: "test",
          PATH: process.env["PATH"] ?? "",
          ...MUTANTE_ACTIVO,
          PEDERNAL_FRAGMENTO: valor,
        },
      });
    const reparto = con("1/3");
    expect(reparto.status).not.toBe(0);
    expect(`${reparto.stdout}${reparto.stderr}`).toContain(
      "--shard <count> must be a smaller than count of test files",
    );
    expect(con("4/3").status).not.toBe(0);
    // Sin la variable (o con 1/1) la misma corrida pasa: el control de que el rojo de arriba viene del fragmento.
    expect(con("1/1").status).toBe(0);
  }, 120_000);

  it.each([".github/workflows/ci.yml", ".github/workflows/gate-rapido.yml"])(
    "%s: la matriz es 1, 2, 3 (índices consecutivos desde 1, ninguno repetido)",
    (ruta) => {
      expect(matriz(leer(ruta))).toEqual([1, 2, 3]);
    },
  );

  it("`npm test` es vitest run sin fragmento propio (el fragmento llega por la variable)", () => {
    const script =
      (JSON.parse(leer("package.json")) as { scripts: Record<string, string> }).scripts["test"] ??
      "";
    expect(script).toBe("vitest run --project node");
    expect(script).not.toContain("--shard");
  });
});
