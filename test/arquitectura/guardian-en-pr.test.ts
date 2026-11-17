import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Los grupos de mutación del guardián no corren en un PR salvo que el PR toque el guardián; la nocturna, `main` y el disparo manual
 * corren todos. Previene gastar ~150 min de máquina en PR que solo suman un DEC o tocan producto. Cada caso es una violación inyectada.
 */

type Grupo = { grupo: string; archivos: string; minutos?: number; expandidos: string[] };
type Plan = { completo: boolean; motivo: string; grupos: { grupo: string }[] };
const require = createRequire(import.meta.url);
const { gruposDelPlan } = require("../../arquitectura/guardian-en-pr.cjs") as {
  gruposDelPlan: (grupos: Grupo[], cambios: string[]) => Grupo[];
};
const { planificar, conEnlacesDelGuardian, expandir } =
  require("../../arquitectura/planificar-mutacion.cjs") as {
    planificar: (e: {
      cambios: string[];
      grupos: Grupo[];
      dependencias: Record<string, string[]>;
    }) => Plan;
    conEnlacesDelGuardian: (
      d: Record<string, string[]>,
      archivosDelGuardian: string[],
    ) => Record<string, string[]>;
    expandir: (patrones: string, raiz: string) => string[];
  };
const { cargarLosGrupos } = require("../../arquitectura/grupos-de-mutacion.cjs") as {
  cargarLosGrupos: (raiz: string) => { grupos: { grupo: string; archivos: string }[] };
};

const RAIZ = join(import.meta.dirname, "../..");
const DEC_NUEVA = "arquitectura/decisiones/registro/DEC-0002.json";
const GUARDIAN = "arquitectura/contratos/guardian.cjs";
const GRUPOS: Grupo[] = [
  { grupo: "guardián (x)", archivos: GUARDIAN, expandidos: [GUARDIAN] },
  {
    grupo: "decisiones",
    archivos: "arquitectura/decisiones/decisiones.cjs",
    expandidos: ["arquitectura/decisiones/decisiones.cjs"],
  },
  {
    grupo: "ajeno",
    archivos: "src/ajeno/dominio/ajeno.ts",
    expandidos: ["src/ajeno/dominio/ajeno.ts"],
  },
  {
    grupo: "mixto",
    archivos: "src/ajeno/dominio/ajeno.ts,arquitectura/x.cjs",
    expandidos: ["src/ajeno/dominio/ajeno.ts", "arquitectura/x.cjs"],
  },
];
const BASE: Record<string, string[]> = {
  "arquitectura/decisiones/decisiones.cjs": [],
  [GUARDIAN]: [],
  "arquitectura/x.cjs": [],
  "src/ajeno/dominio/ajeno.ts": [],
  "src/ajeno/dominio/ajeno.test.ts": ["src/ajeno/dominio/ajeno.ts"],
  "test/arquitectura/guardian-nucleo.test.ts": [GUARDIAN],
  "test/arquitectura/lint.test.ts": [],
};
const dependencias = conEnlacesDelGuardian(BASE, [GUARDIAN, DEC_NUEVA]);
const plan = (cambios: string[]) => planificar({ cambios, grupos: GRUPOS, dependencias });
const nombres = (p: Plan) => p.grupos.map((g) => g.grupo).sort();

describe("los grupos del guardián en un PR", () => {
  it("un grupo es del guardián solo si TODO lo que muta vive en arquitectura/ (el mixto y el de producto se quedan)", () => {
    const sin = gruposDelPlan(GRUPOS, ["src/ajeno/dominio/ajeno.ts"]).map((g) => g.grupo);
    expect(sin).toEqual(["ajeno", "mixto"]);
    expect(
      gruposDelPlan([{ grupo: "vacío", archivos: "", expandidos: [] }], ["src/x.ts"]),
    ).toHaveLength(1);
  });

  it("un PR que solo suma un DEC NO enciende grupos del guardián (es dato)", () => {
    const p = plan([DEC_NUEVA]);
    expect(p.completo).toBe(false);
    expect(p.grupos).toEqual([]);
  });

  it.each([
    "arquitectura/contratos/guardian.cjs",
    "arquitectura/evaluar-gate.cjs",
    "arquitectura/contratos/exclusiones.json",
    "arquitectura/deuda/registro.json",
    "test/arquitectura/guardian-nucleo.test.ts",
    "test/arquitectura/lint.test.ts",
    ".github/workflows/gate-rapido.yml",
  ])("un PR que toca %s SÍ habilita los grupos del guardián", (cambio) => {
    const grupos = gruposDelPlan(GRUPOS, [cambio]);
    expect(grupos.map((g) => g.grupo)).toContain("guardián (x)");
  });

  it("un PR que toca un .cjs del guardián con grafo corre el grupo del guardián que lo muta", () => {
    expect(nombres(plan([GUARDIAN]))).toContain("guardián (x)");
  });

  it("un PR de producto no corre grupos del guardián, y el mixto (también muta producto) sí corre", () => {
    expect(nombres(plan(["src/ajeno/dominio/ajeno.ts"]))).toEqual(["ajeno", "mixto"]);
  });

  it("un PR de producto + un DEC no suma los grupos del guardián", () => {
    expect(nombres(plan(["src/ajeno/dominio/ajeno.ts", DEC_NUEVA]))).toEqual(["ajeno", "mixto"]);
  });

  it("falla cerrado: un archivo que el grafo no explica corre TODOS, guardián incluido", () => {
    const p = plan(["package.json"]);
    expect(p.completo).toBe(true);
    expect(nombres(p)).toEqual(["ajeno", "decisiones", "guardián (x)", "mixto"]);
  });

  it("falla cerrado: un DEC borrado (ya no es nodo del grafo) corre TODOS", () => {
    const sinElDec = conEnlacesDelGuardian(BASE, [GUARDIAN]);
    const p = planificar({ cambios: [DEC_NUEVA], grupos: GRUPOS, dependencias: sinElDec });
    expect(p.completo).toBe(true);
    expect(nombres(p)).toContain("guardián (x)");
  });

  it("el árbol real: los grupos «guardián…» son exactamente los que mutan solo arquitectura/", () => {
    const reales = cargarLosGrupos(RAIZ).grupos.map((g) => ({
      ...g,
      expandidos: expandir(g.archivos, RAIZ),
    }));
    const delGuardian = reales
      .filter(
        (g) => g.expandidos.length > 0 && g.expandidos.every((e) => e.startsWith("arquitectura/")),
      )
      .map((g) => g.grupo);
    expect(delGuardian.length).toBeGreaterThan(0);
    for (const nombre of delGuardian) expect(nombre).toMatch(/^guardián/);
    expect(reales.filter((g) => g.grupo.startsWith("guardián")).map((g) => g.grupo)).toEqual(
      delGuardian,
    );
    expect(gruposDelPlan(reales as unknown as Grupo[], ["src/x.ts"]).length).toBe(
      reales.length - delGuardian.length,
    );
    expect(gruposDelPlan(reales as unknown as Grupo[], ["arquitectura/reglas.cjs"]).length).toBe(
      reales.length,
    );
  });

  // La nocturna, el push a main y el disparo manual no son `pull_request`: corren TODOS los grupos, los del guardián incluidos.
  it.each(["schedule", "push", "workflow_dispatch", ""])(
    "el evento «%s» (no es un PR) enciende todos los grupos, los del guardián incluidos",
    (evento) => {
      const salida = execFileSync("node", [join(RAIZ, "arquitectura/planificar-mutacion.cjs")], {
        cwd: RAIZ,
        encoding: "utf8",
        // El proceso hijo hereda el mutante activo: sin esto la mutación nunca vería este código.
        env: { ...process.env, GITHUB_EVENT_NAME: evento, GITHUB_OUTPUT: "" },
      });
      const reales = cargarLosGrupos(RAIZ).grupos;
      const enLaSalida = salida.split("\n").filter((linea) => linea.startsWith("- "));
      expect(enLaSalida.length).toBe(reales.length);
      expect(enLaSalida.filter((linea) => linea.startsWith("- guardián")).length).toBeGreaterThan(
        0,
      );
    },
  );
});
