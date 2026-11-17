import { globSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, normalize } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Los archivos de datos de `arquitectura/` (y `.gitignore`, `CODEOWNERS`) son archivos EXPLICADOS del guardián: antes cualquier cambio en ellos era
 * «no explicado» y corría TODA la mutación (22 de 80 PR, ~437 min declarados cada uno; 13 de esos 22 por estos archivos).
 * Previene ese gasto sin soltar nada: lo que sigue sin declararse corre todo (fail-closed) y la definición de un grupo (`arquitectura/mutacion/<id>.json`)
 * hace correr ese grupo. Cada caso es una violación inyectada: quitar un dato de la lista del guardián, o el gatillo, o la fuente del grupo, falla.
 */

type Grupo = {
  grupo: string;
  archivos: string;
  pruebas?: string;
  minutos?: number;
  expandidos: string[];
  fuente?: string | undefined;
};
type Plan = { completo: boolean; motivo: string; grupos: { grupo: string; archivos: string }[] };
const require = createRequire(import.meta.url);
const { planificar, conEnlacesDelGuardian, leerArchivosDelGuardian, expandir } =
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
    leerArchivosDelGuardian: (raiz: string) => string[];
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
const CUOTA = "arquitectura/decisiones/cuota.json";
const GRUPO_JSON = "arquitectura/mutacion/producto-b.json";
const DATOS = [
  ".gitignore",
  ".github/CODEOWNERS",
  "arquitectura/paridad/copias.json",
  CUOTA,
  "arquitectura/decisiones/archivos-sensibles.json",
  GRUPO_JSON,
];
const GUARDIAN = "arquitectura/contratos/guardian.cjs";
const GRUPOS: Grupo[] = [
  {
    grupo: "guardián (x)",
    archivos: GUARDIAN,
    pruebas: "test/arquitectura/guardian-x",
    expandidos: [GUARDIAN],
  },
  {
    grupo: "producto A",
    archivos: "src/a/dominio/a.ts",
    pruebas: "src/a",
    expandidos: ["src/a/dominio/a.ts"],
    fuente: "arquitectura/mutacion/producto-a.json",
  },
  {
    grupo: "producto B",
    archivos: "src/b/dominio/b.ts",
    pruebas: "src/b",
    expandidos: ["src/b/dominio/b.ts"],
    fuente: GRUPO_JSON,
  },
];
const BASE: Record<string, string[]> = {
  [GUARDIAN]: [],
  "src/a/dominio/a.ts": [],
  "src/a/dominio/a.test.ts": ["src/a/dominio/a.ts"],
  "src/b/dominio/b.ts": [],
  "src/b/dominio/b.test.ts": ["src/b/dominio/b.ts"],
  "test/arquitectura/guardian-x.test.ts": [GUARDIAN],
  "arquitectura/mutacion/producto-a.json": [],
  [GRUPO_JSON]: [],
};
const dependencias = conEnlacesDelGuardian(BASE, [GUARDIAN, ...DATOS]);
const plan = (cambios: string[]) => planificar({ cambios, grupos: GRUPOS, dependencias });
const nombres = (p: Plan) => p.grupos.map((g) => g.grupo).sort();

describe("datos de arquitectura: archivos explicados, no «desconocidos»", () => {
  it.each([".gitignore", ".github/CODEOWNERS", "arquitectura/paridad/copias.json"])(
    "un PR que solo cambia %s no corre ningún grupo (ni el guardián: es dato, lo ve la nocturna)",
    (archivo) => {
      const p = plan([archivo]);
      expect(p.completo).toBe(false);
      expect(p.grupos).toEqual([]);
    },
  );

  it.each([CUOTA, "arquitectura/decisiones/archivos-sensibles.json"])(
    "un PR que cambia %s enciende al guardián (es la política que sus pruebas comprueban) y a nadie más",
    (archivo) => {
      const p = plan([archivo]);
      expect(p.completo).toBe(false);
      expect(nombres(p)).toEqual(["guardián (x)"]);
    },
  );

  it("la definición de un grupo corre ESE grupo con todos sus archivos, aunque ninguno haya cambiado, y no los demás", () => {
    const p = plan([GRUPO_JSON]);
    expect(p.completo).toBe(false);
    expect(nombres(p)).toEqual(["guardián (x)", "producto B"]);
    expect(p.grupos.find((g) => g.grupo === "producto B")?.archivos).toBe("src/b/dominio/b.ts");
  });

  it("falla cerrado: un archivo de arquitectura que nadie declaró, o una definición de grupo borrada, corren TODOS", () => {
    for (const cambio of ["arquitectura/algo-nuevo.json", "arquitectura/mutacion/borrado.json"]) {
      const p = plan([cambio]);
      expect(p.completo, cambio).toBe(true);
      expect(nombres(p), cambio).toEqual(["guardián (x)", "producto A", "producto B"]);
    }
  });

  it("un dato junto a código de producto: corre lo del código y nada por el dato (salvo el gatillo de su grupo)", () => {
    expect(nombres(plan([".gitignore", "src/a/dominio/a.ts"]))).toEqual(["producto A"]);
  });

  it("sin la fuente del grupo (violación inyectada) el grupo NO correría: la definición es lo que lo hace correr", () => {
    const sinFuente = GRUPOS.map((g) => ({ ...g, fuente: undefined }));
    const p = planificar({ cambios: [GRUPO_JSON], grupos: sinFuente, dependencias });
    expect(nombres(p)).not.toContain("producto B");
  });

  it("el árbol real: cada dato está entre los archivos del guardián (si no, volvería a ser «no explicado» y correr todo)", () => {
    const reales = leerArchivosDelGuardian(RAIZ);
    for (const dato of DATOS.filter((d) => d !== GRUPO_JSON)) expect(reales, dato).toContain(dato);
    const definiciones = globSync("arquitectura/mutacion/*.json", { cwd: RAIZ });
    expect(definiciones.length).toBeGreaterThan(90);
    for (const definicion of definiciones) expect(reales, definicion).toContain(definicion);
    expect(expandir("arquitectura/paridad/*.json", RAIZ).length).toBeGreaterThan(0);
  });

  it("cada grupo real conoce su definición, y esa definición existe", () => {
    const ids = new Set(globSync("arquitectura/mutacion/*.json", { cwd: RAIZ }));
    expect(ids.size).toBe(cargarLosGrupos(RAIZ).grupos.length);
  });
});

describe("las pruebas de los grupos de producto no leen estos datos", () => {
  // Las pruebas de `test/arquitectura/` son las del guardián (enlazadas a estos datos). Las demás pruebas de un filtro de grupo (src/**, test/web,
  // test/plataforma, test/propiedades) y los auxiliares que importan no pueden nombrarlos: si uno los lee, un cambio en el dato tiene que correr su grupo.
  const NOMBRES = [
    ".gitignore",
    "CODEOWNERS",
    "arquitectura/paridad",
    "copias.json",
    "arquitectura/decisiones/cuota",
    "archivos-sensibles",
    "arquitectura/mutacion",
  ];
  const IMPORTA = /(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g;
  const resolver = (desde: string, relativo: string): string | undefined => {
    const base = normalize(join(dirname(desde), relativo));
    return [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), base].find((c) => {
      try {
        readFileSync(join(RAIZ, c), "utf8");
        return c.match(/\.(ts|tsx)$/) !== null;
      } catch {
        return false;
      }
    });
  };
  const cierreDeTexto = (prueba: string): string[] => {
    const vistos = new Set<string>([prueba]);
    const pendientes = [prueba];
    while (pendientes.length > 0) {
      const actual = pendientes.pop() as string;
      const texto = readFileSync(join(RAIZ, actual), "utf8");
      for (const m of texto.matchAll(IMPORTA)) {
        const destino = resolver(actual, m[1] as string);
        if (destino !== undefined && !vistos.has(destino)) {
          vistos.add(destino);
          pendientes.push(destino);
        }
      }
    }
    return [...vistos];
  };

  it("ninguna prueba de un filtro de grupo que no sea de test/arquitectura (ni lo que importa) nombra esos datos", () => {
    const universo = [
      ...globSync("src/**/*.test.ts", { cwd: RAIZ }),
      ...globSync("test/**/*.test.ts", { cwd: RAIZ }),
    ];
    const delProducto = new Set<string>();
    for (const g of cargarLosGrupos(RAIZ).grupos) {
      for (const prueba of pruebasDelFiltro(g.pruebas, universo).corridas) {
        if (!prueba.startsWith("test/arquitectura/")) delProducto.add(prueba);
      }
    }
    expect(delProducto.size).toBeGreaterThan(300);
    const lectores: string[] = [];
    for (const prueba of delProducto) {
      for (const archivo of cierreDeTexto(prueba)) {
        if (archivo.startsWith("test/arquitectura/")) continue;
        const texto = readFileSync(join(RAIZ, archivo), "utf8");
        for (const nombre of NOMBRES)
          if (texto.includes(nombre)) lectores.push(`${archivo}: ${nombre}`);
      }
    }
    expect([...new Set(lectores)]).toEqual([]);
  }, 120_000);
});
