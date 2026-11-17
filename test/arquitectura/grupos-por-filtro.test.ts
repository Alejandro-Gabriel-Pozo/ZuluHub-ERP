import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { globSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

/**
 * El plan de un PR elimina los grupos de mutación cuyo filtro de pruebas no alcanza lo cambiado (`arquitectura/grupos-por-filtro.cjs`).
 * Previene: que ~30 pruebas de `test/web`, que importan casi todo, enciendan ~69 grupos que luego corren con un filtro que ni las incluye.
 * Cada caso es una violación inyectada: si se quita la regla (o se la afloja de más) alguno falla.
 */

type Grupo = {
  grupo: string;
  archivos: string;
  pruebas?: string;
  minutos?: number;
  expandidos: string[];
};
type Plan = { completo: boolean; motivo: string; grupos: { grupo: string }[]; saltados?: string[] };
const require = createRequire(import.meta.url);
const { planificar, expandir } = require("../../arquitectura/planificar-mutacion.cjs") as {
  planificar: (e: {
    cambios: string[];
    grupos: Grupo[];
    dependencias: Record<string, string[]>;
    lecturas?: Record<string, string[]>;
  }) => Plan;
  expandir: (patrones: string, raiz: string) => string[];
};
const { pruebasDelFiltro } = require("../../arquitectura/grupos-por-filtro.cjs") as {
  pruebasDelFiltro: (
    pruebas: string | undefined,
    universo: string[],
  ) => { corridas: string[]; sinPrueba: string[] };
};
const { cargarLosGrupos } = require("../../arquitectura/grupos-de-mutacion.cjs") as {
  cargarLosGrupos: (raiz: string) => {
    grupos: { grupo: string; archivos: string; pruebas?: string }[];
  };
};

const RAIZ = join(import.meta.dirname, "../..");
const A = "src/a/dominio/a.ts";
const B = "src/b/dominio/b.ts";
const COMPARTIDO = "src/comun/dominio/comun.ts";
const DEPENDENCIAS: Record<string, string[]> = {
  [A]: [COMPARTIDO],
  [B]: [COMPARTIDO],
  [COMPARTIDO]: [],
  "src/a/dominio/a.test.ts": [A],
  "src/b/dominio/b.test.ts": [B],
  // una prueba «ancha» como las de test/web: importa todo, pero ningún grupo la tiene en su filtro (salvo «ancho»)
  "test/web/ancha.test.ts": [A, B],
  "test/integracion/global.ts": [],
  "test/integracion/topes.ts": [],
};
const GRUPOS: Grupo[] = [
  { grupo: "a", archivos: A, pruebas: "src/a", expandidos: [A] },
  { grupo: "b", archivos: B, pruebas: "src/b", expandidos: [B] },
  { grupo: "ancho", archivos: B, pruebas: "src/b test/web/ancha", expandidos: [B] },
  { grupo: "sin filtro", archivos: B, expandidos: [B] },
  { grupo: "sin resolver", archivos: B, pruebas: "src/b src/no-existe", expandidos: [B] },
];
const plan = (cambios: string[]): Plan =>
  planificar({ cambios, grupos: GRUPOS, dependencias: DEPENDENCIAS });
const nombres = (p: Plan) => p.grupos.map((g) => g.grupo).sort();

describe("filtro de pruebas de cada grupo", () => {
  it("un archivo común alcanza a las pruebas de su filtro: corren a y b (la prueba ancha no cuenta si no está en el filtro)", () => {
    const p = plan([COMPARTIDO]);
    expect(nombres(p)).toEqual(["a", "ancho", "b", "sin filtro", "sin resolver"]);
  });

  it("un cambio en la prueba ancha corre SOLO los grupos que la tienen en su filtro, más los que conservan la regla ancha", () => {
    const p = plan(["test/web/ancha.test.ts"]);
    expect(nombres(p)).toEqual(["ancho", "sin filtro", "sin resolver"]);
    // violación inyectada: sin la regla por filtro, «a» y «b» correrían porque la prueba ancha los importa
    expect(nombres(p)).not.toContain("a");
    expect(nombres(p)).not.toContain("b");
  });

  it("cada grupo saltado deja una línea con su motivo", () => {
    const p = plan(["test/web/ancha.test.ts"]);
    expect(p.saltados).toHaveLength(2);
    expect(p.saltados?.[0]).toMatch(
      /^a: ni sus archivos ni sus 1 prueba\(s\) del filtro alcanzan lo cambiado$/,
    );
    expect(p.saltados?.some((linea) => linea.startsWith("b: "))).toBe(true);
  });

  it("un cambio en el archivo propio corre su grupo aunque su filtro no lo alcance", () => {
    const dependencias = { ...DEPENDENCIAS, "src/a/dominio/a.test.ts": [] };
    const p = planificar({ cambios: [A], grupos: GRUPOS, dependencias });
    expect(nombres(p)).toContain("a");
  });

  it("un grupo sin filtro, o con una entrada que no coincide con ninguna prueba, conserva la regla ancha (no se saltea)", () => {
    const p = plan(["test/web/ancha.test.ts"]);
    expect(nombres(p)).toContain("sin filtro");
    // «b» (filtro resuelto) se saltea; «sin resolver» (mismo filtro + una entrada sin prueba) no se arriesga
    expect(nombres(p)).not.toContain("b");
    expect(nombres(p)).toContain("sin resolver");
  });

  it("test/integracion/topes.ts (setupFiles) entra en el alcance de TODA prueba: cambiarlo no deja grupos afuera", () => {
    const dependencias = { ...DEPENDENCIAS };
    const p = planificar({ cambios: ["test/integracion/topes.ts"], grupos: GRUPOS, dependencias });
    expect(nombres(p)).toEqual(["a", "ancho", "b", "sin filtro", "sin resolver"]);
  });

  it("nunca agrega un grupo que la regla ancha no elegiría (siempre es un subconjunto)", () => {
    const todos = Object.keys(DEPENDENCIAS);
    for (const cambio of todos) {
      const p = plan([cambio]);
      const ancha = planificar({
        cambios: [cambio],
        grupos: GRUPOS.map((g) => ({ ...g, pruebas: "" })),
        dependencias: DEPENDENCIAS,
      });
      for (const g of p.grupos) expect(nombres(ancha), cambio).toContain(g.grupo);
    }
  });

  it("falla cerrado: un archivo que el grafo no explica corre TODOS los grupos, sin saltear ninguno", () => {
    const p = plan(["package.json"]);
    expect(p.completo).toBe(true);
    expect(nombres(p)).toEqual(["a", "ancho", "b", "sin filtro", "sin resolver"]);
    expect(p.saltados).toBeUndefined();
  });
});

describe("el filtro de pruebas como lo resuelve vitest", () => {
  it("las entradas se toman como subcadenas de la ruta y una entrada sin coincidencia se informa", () => {
    const universo = ["src/a/x.test.ts", "src/ab/y.test.ts", "test/web/z.test.ts"];
    expect(pruebasDelFiltro("src/a", universo).corridas).toEqual([
      "src/a/x.test.ts",
      "src/ab/y.test.ts",
    ]);
    expect(pruebasDelFiltro("test/web src/nada", universo)).toEqual({
      corridas: ["test/web/z.test.ts"],
      sinPrueba: ["src/nada"],
    });
    expect(pruebasDelFiltro(undefined, universo).corridas).toEqual([]);
  });

  it("paridad con `vitest list --filesOnly` sobre los grupos reales (el oráculo es vitest, no esta réplica)", async () => {
    const grupos = cargarLosGrupos(RAIZ).grupos;
    expect(grupos.length).toBeGreaterThan(90);
    const universo = [
      ...globSync("src/**/*.test.ts", { cwd: RAIZ }),
      ...globSync("test/**/*.test.ts", { cwd: RAIZ }),
    ].sort();
    const ejecutar = promisify(execFile);
    const conFiltro = grupos.filter((g) => (g.pruebas ?? "") !== "");
    const resultados: { grupo: string; vitest: string[]; propio: string[] }[] = [];
    for (let desde = 0; desde < conFiltro.length; desde += 8) {
      resultados.push(
        ...(await Promise.all(
          conFiltro.slice(desde, desde + 8).map(async (g) => {
            const { stdout } = await ejecutar(
              join(RAIZ, "node_modules/.bin/vitest"),
              ["list", "--filesOnly", "--project", "node", ...(g.pruebas ?? "").split(/\s+/)],
              {
                cwd: RAIZ,
                maxBuffer: 16 * 1024 * 1024,
                env: { ...process.env, PEDERNAL_FRAGMENTO: "" },
              },
            );
            const vitest = stdout
              .split("\n")
              .map((linea) => linea.replace(/^\[node\]\s+/, "").trim())
              .filter((linea) => linea.endsWith(".test.ts"))
              .sort();
            return {
              grupo: g.grupo,
              vitest,
              propio: [...pruebasDelFiltro(g.pruebas, universo).corridas].sort(),
            };
          }),
        )),
      );
    }
    for (const r of resultados) expect(r.propio, r.grupo).toEqual(r.vitest);
  }, 240_000);

  it("el árbol real: la única entrada de filtro sin ninguna prueba es la de «plataforma (dominio)» (queda con la regla ancha)", () => {
    const universo = [
      ...globSync("src/**/*.test.ts", { cwd: RAIZ }),
      ...globSync("test/**/*.test.ts", { cwd: RAIZ }),
    ];
    const sinResolver = cargarLosGrupos(RAIZ)
      .grupos.filter((g) => pruebasDelFiltro(g.pruebas, universo).sinPrueba.length > 0)
      .map((g) => g.grupo);
    expect(sinResolver).toEqual(["plataforma (dominio)"]);
    expect(expandir("src/composicion/*.ts", RAIZ).length).toBeGreaterThan(0);
  });
});
