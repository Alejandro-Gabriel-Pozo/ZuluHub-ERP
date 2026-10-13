import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * El planificador decide qué grupos de mutación corre un PR. Cada decisión que previene un
 * resultado de mutación obsoleto tiene acá el cambio que la dispara: si se la quita, el caso falla.
 */

type Grupo = { grupo: string; archivos: string; pruebas?: string; expandidos: string[] };
type Plan = {
  completo: boolean;
  motivo: string;
  grupos: { grupo: string; archivos: string; pruebas: string }[];
};
const require = createRequire(import.meta.url);
const { planificar, expandir } = require("../../arquitectura/planificar-mutacion.cjs") as {
  planificar: (e: {
    cambios: string[];
    grupos: Grupo[];
    dependencias: Record<string, string[]>;
  }) => Plan;
  expandir: (patrones: string, raiz: string) => string[];
};

const RAIZ = join(import.meta.dirname, "../..");

// Grafo de juguete: dos módulos de dominio que comparten una primitiva y un auxiliar de pruebas.
const DEPENDENCIAS: Record<string, string[]> = {
  "src/primitivas/resultado.ts": [],
  "src/a/dominio/a.ts": ["src/primitivas/resultado.ts"],
  "src/b/dominio/b.ts": ["src/primitivas/resultado.ts"],
  "src/a/dominio/a.test.ts": ["src/a/dominio/a.ts"],
  "src/b/dominio/b.test.ts": ["src/b/dominio/b.ts", "test/utilidades/auxiliar.ts"],
  "src/c/dominio/c.ts": [],
  "src/c/dominio/c.test.ts": ["src/c/dominio/c.ts"],
  "test/utilidades/auxiliar.ts": [],
  "test/integracion/global.ts": ["src/primitivas/resultado.ts"],
};
const GRUPOS: Grupo[] = [
  {
    grupo: "a",
    archivos: "src/a/dominio/*.ts",
    pruebas: "src/a",
    expandidos: ["src/a/dominio/a.ts"],
  },
  { grupo: "b", archivos: "src/b/dominio/*.ts", expandidos: ["src/b/dominio/b.ts"] },
  { grupo: "c", archivos: "src/c/dominio/*.ts", expandidos: ["src/c/dominio/c.ts"] },
];
const plan = (cambios: string[]): Plan =>
  planificar({ cambios, grupos: GRUPOS, dependencias: DEPENDENCIAS });
const nombres = (p: Plan) => p.grupos.map((g) => g.grupo);

describe("planificador de mutación: qué grupos corren", () => {
  it("un cambio en un archivo mutado corre solo su grupo, y solo ese archivo", () => {
    const p = plan(["src/a/dominio/a.ts"]);
    expect(p.completo).toBe(false);
    expect(p.grupos).toEqual([{ grupo: "a", archivos: "src/a/dominio/a.ts", pruebas: "src/a" }]);
  });

  it("un cambio en lo que importa un archivo mutado corre a todos los que lo usan", () => {
    expect(nombres(plan(["src/primitivas/resultado.ts"]))).toEqual(["a", "b"]);
  });

  it("un cambio en una prueba corre los archivos que esa prueba importa", () => {
    expect(nombres(plan(["src/a/dominio/a.test.ts"]))).toEqual(["a"]);
  });

  it("un cambio en un auxiliar de pruebas compartido corre los grupos de las pruebas que lo importan", () => {
    expect(nombres(plan(["test/utilidades/auxiliar.ts"]))).toEqual(["b"]);
  });

  it("lo que vitest carga antes de todas las pruebas afecta a todo lo que ellas cubren", () => {
    expect(nombres(plan(["test/integracion/global.ts"]))).toEqual(["a", "b", "c"]);
  });

  it("un PR que solo toca documentación o migraciones no corre ningún grupo", () => {
    const p = plan(["README.md", "migraciones/0006_algo.sql"]);
    expect(p).toMatchObject({ completo: false, grupos: [] });
  });

  it.each([
    ["la configuración de Stryker", "stryker.config.json"],
    ["las dependencias", "package.json"],
    ["la configuración de vitest", "vitest.config.ts"],
    ["el workflow", ".github/workflows/ci.yml"],
    ["los grupos de mutación", "arquitectura/grupos-de-mutacion.json"],
    ["un archivo borrado (no está en el grafo)", "src/a/dominio/borrado.ts"],
  ])("si cambia %s corren todos los grupos completos", (_nombre, archivo) => {
    const p = plan([archivo]);
    expect(p.completo).toBe(true);
    expect(p.grupos).toEqual(
      GRUPOS.map(({ grupo, archivos, pruebas }) => ({ grupo, archivos, pruebas: pruebas ?? "" })),
    );
  });

  it("lo desconocido gana a lo ignorable: un .md junto a un archivo fuera del grafo corre todo", () => {
    expect(plan(["README.md", "tsconfig.json"]).completo).toBe(true);
  });
});

describe("grupos de mutación contra la configuración real", () => {
  it("cada archivo de `mutate` está en exactamente un grupo (ninguno escapa, ninguno se repite)", () => {
    const configuracion = JSON.parse(readFileSync(join(RAIZ, "stryker.config.json"), "utf8")) as {
      mutate: string[];
    };
    const esperados = expandir(configuracion.mutate.join(","), RAIZ);
    const grupos = require("../../arquitectura/grupos-de-mutacion.json") as {
      archivos: string;
    }[];
    const repartidos = grupos.flatMap((g) => expandir(g.archivos, RAIZ));
    expect(repartidos.sort()).toEqual(esperados.sort());
  });
});
