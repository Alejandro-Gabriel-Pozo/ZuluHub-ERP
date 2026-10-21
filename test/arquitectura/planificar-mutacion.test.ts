import { globSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RAIZ_ORIGINAL } from "./guardian-apoyo";

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
const { planificar, expandir, archivoDe, conEnlacesDelGuardian, leerArchivosDelGuardian } =
  require("../../arquitectura/planificar-mutacion.cjs") as {
    planificar: (e: {
      cambios: string[];
      grupos: Grupo[];
      dependencias: Record<string, string[]>;
    }) => Plan;
    expandir: (patrones: string, raiz: string) => string[];
    archivoDe: (entrada: string) => string;
    conEnlacesDelGuardian: (
      dependencias: Record<string, string[]>,
      archivosDelGuardian: string[],
    ) => Record<string, string[]>;
    leerArchivosDelGuardian: (raiz: string) => string[];
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

describe("planificador de mutación: el código del guardián (arquitectura/contratos)", () => {
  // Lo que el grafo de importaciones no ve: datos, procesos lanzados y archivos que el verificador lee.
  const CONTRATOS = [
    "arquitectura/contratos/a.cjs",
    "arquitectura/contratos/b.cjs",
    "arquitectura/contratos/datos.json",
  ];
  const grafo = (): Record<string, string[]> =>
    conEnlacesDelGuardian(
      {
        ...DEPENDENCIAS,
        "test/arquitectura/guardian-apoyo.ts": [],
        "test/arquitectura/guardian-x.test.ts": ["test/arquitectura/guardian-apoyo.ts"],
        "test/arquitectura/lint.test.ts": [],
      },
      CONTRATOS,
    );
  const GRUPOS_CON_GUARDIAN: Grupo[] = [
    ...GRUPOS,
    {
      grupo: "guardián (a)",
      archivos: "arquitectura/contratos/a.cjs",
      pruebas: "test/arquitectura/guardian-x.test.ts",
      expandidos: ["arquitectura/contratos/a.cjs"],
    },
    {
      grupo: "guardián (b)",
      archivos: "arquitectura/contratos/b.cjs",
      pruebas: "test/arquitectura/guardian-x.test.ts",
      expandidos: ["arquitectura/contratos/b.cjs"],
    },
  ];
  const planGuardian = (cambios: string[]): Plan =>
    planificar({ cambios, grupos: GRUPOS_CON_GUARDIAN, dependencias: grafo() });

  it.each([
    ["un `.cjs` del guardián", "arquitectura/contratos/a.cjs"],
    ["un dato del guardián", "arquitectura/contratos/datos.json"],
    ["un auxiliar de pruebas del guardián", "test/arquitectura/guardian-apoyo.ts"],
    ["una prueba del guardián", "test/arquitectura/guardian-x.test.ts"],
  ])("un cambio en %s corre TODOS los grupos del guardián y ninguno de src", (_nombre, archivo) => {
    const p = planGuardian([archivo]);
    expect(p.completo).toBe(false);
    expect(nombres(p)).toEqual(["guardián (a)", "guardián (b)"]);
    // los archivos son los de cada grupo y con su filtro de pruebas (no se pierde ni se ensancha nada)
    expect(p.grupos).toEqual([
      {
        grupo: "guardián (a)",
        archivos: "arquitectura/contratos/a.cjs",
        pruebas: "test/arquitectura/guardian-x.test.ts",
      },
      {
        grupo: "guardián (b)",
        archivos: "arquitectura/contratos/b.cjs",
        pruebas: "test/arquitectura/guardian-x.test.ts",
      },
    ]);
  });

  it("un cambio fuera del guardián no corre sus grupos", () => {
    expect(nombres(planGuardian(["src/a/dominio/a.ts"]))).toEqual(["a"]);
    expect(planGuardian(["test/arquitectura/lint.test.ts"])).toMatchObject({
      completo: false,
      grupos: [],
    });
  });

  it("el resto de `arquitectura/` y los archivos del guardián borrados siguen corriendo todo", () => {
    for (const archivo of [
      "arquitectura/lint-web.cjs",
      "arquitectura/lint-sql.cjs",
      "arquitectura/contratos/borrado.cjs",
      "package.json",
    ]) {
      const p = planGuardian([archivo]);
      expect(p.completo, archivo).toBe(true);
      expect(nombres(p), archivo).toEqual(GRUPOS_CON_GUARDIAN.map((g) => g.grupo));
    }
  });

  it("los enlaces no tocan el grafo original ni agregan dependencias a otras pruebas", () => {
    const original = {
      "test/arquitectura/lint.test.ts": [],
      "test/arquitectura/guardian-x.test.ts": [],
    };
    const copia = structuredClone(original);
    const nuevo = conEnlacesDelGuardian(original, CONTRATOS);
    expect(original).toEqual(copia);
    expect(nuevo["test/arquitectura/lint.test.ts"]).toEqual([]);
    expect(nuevo["test/arquitectura/guardian-x.test.ts"]).toEqual(CONTRATOS);
    // solo `test/arquitectura/guardian-*`: una carpeta más adentro o un prefijo distinto no cuentan
    const otros = conEnlacesDelGuardian(
      { "test/arquitectura/x/guardian-y.ts": [], "test/arquitectura/no-guardian-z.ts": [] },
      CONTRATOS,
    );
    expect(otros["test/arquitectura/x/guardian-y.ts"]).toEqual([]);
    expect(otros["test/arquitectura/no-guardian-z.ts"]).toEqual([]);
  });

  it("los archivos del guardián son los de su carpeta y los que el verificador carga, sin el informe generado ni lo que falta", () => {
    const raiz = mkdtempSync(join(tmpdir(), "guardian-plan-"));
    try {
      for (const archivo of [
        "arquitectura/contratos/a.cjs",
        "arquitectura/contratos/sub/datos.json",
        "arquitectura/contratos/informe.json",
        "arquitectura/evaluar-gate.cjs",
        "arquitectura/lint-sql.cjs",
      ]) {
        mkdirSync(join(raiz, archivo, ".."), { recursive: true });
        writeFileSync(join(raiz, archivo), "{}");
      }
      // una carpeta con nombre de archivo no es un archivo
      mkdirSync(join(raiz, "arquitectura/contratos/carpeta.json"));
      expect(leerArchivosDelGuardian(raiz)).toEqual([
        "arquitectura/contratos/a.cjs",
        "arquitectura/contratos/sub/datos.json",
        "arquitectura/evaluar-gate.cjs",
      ]);
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });

  it("con los archivos reales: cualquier cambio en el guardián alcanza a todos sus archivos mutados", () => {
    const configuracion = JSON.parse(readFileSync(join(RAIZ, "stryker.config.json"), "utf8")) as {
      mutate: string[];
    };
    const mutadosDelGuardian = expandir(configuracion.mutate.join(","), RAIZ).filter((a) =>
      a.startsWith("arquitectura/contratos/"),
    );
    expect(mutadosDelGuardian.length).toBeGreaterThan(0);

    const archivosDelGuardian = leerArchivosDelGuardian(RAIZ);
    for (const mutado of mutadosDelGuardian) expect(archivosDelGuardian).toContain(mutado);
    expect(archivosDelGuardian.some((a) => a.endsWith("informe.json"))).toBe(false);
    // los datos de la carpeta y lo que el verificador carga del árbol también cuentan (el grafo no los ve)
    for (const dato of [
      "arquitectura/contratos/exclusiones.json",
      "arquitectura/evaluar-gate.cjs",
      "arquitectura/reglas.cjs",
    ]) {
      expect(archivosDelGuardian).toContain(dato);
    }

    const grupos = (
      require("../../arquitectura/grupos-de-mutacion.json") as {
        grupo: string;
        archivos: string;
        pruebas?: string;
      }[]
    ).map((g) => ({ ...g, expandidos: expandir(g.archivos, RAIZ) }));
    // El grafo mínimo que hace falta: cada prueba real del guardián importa a sus auxiliares reales.
    const pruebas = globSync("test/arquitectura/guardian-*.ts", { cwd: RAIZ });
    expect(pruebas.length).toBeGreaterThan(0);
    const auxiliares = pruebas.filter((p) => !p.endsWith(".test.ts"));
    expect(auxiliares.length).toBeGreaterThan(0);
    const dependencias = conEnlacesDelGuardian(
      Object.fromEntries(pruebas.map((p) => [p, p.endsWith(".test.ts") ? auxiliares : []])),
      archivosDelGuardian,
    );
    for (const cambio of [...archivosDelGuardian, ...pruebas]) {
      const p = planificar({ cambios: [cambio], grupos, dependencias });
      expect(p.completo, cambio).toBe(false);
      const corridos = [...new Set(p.grupos.flatMap((g) => g.archivos.split(",").map(archivoDe)))];
      expect(corridos.sort(), cambio).toEqual([...mutadosDelGuardian].sort());
    }
  });
});

describe("planificador de mutación: archivos grandes repartidos por rango de líneas", () => {
  const RANGOS: Grupo[] = [
    {
      grupo: "grande (primera mitad)",
      archivos: "src/g/dominio/g.ts:1-40",
      expandidos: ["src/g/dominio/g.ts:1-40"],
    },
    {
      grupo: "grande (segunda mitad)",
      archivos: "src/g/dominio/g.ts:41-90",
      expandidos: ["src/g/dominio/g.ts:41-90"],
    },
  ];
  const dependencias = {
    "src/g/dominio/g.ts": [],
    "src/g/dominio/g.test.ts": ["src/g/dominio/g.ts"],
  };

  it("el rango no cambia a qué archivo pertenece la entrada", () => {
    expect(archivoDe("src/g/dominio/g.ts:41-90")).toBe("src/g/dominio/g.ts");
    expect(archivoDe("src/g/dominio/g.ts")).toBe("src/g/dominio/g.ts");
  });

  it("un cambio en el archivo corre TODOS sus rangos, cada uno con su sufijo", () => {
    const p = planificar({ cambios: ["src/g/dominio/g.ts"], grupos: RANGOS, dependencias });
    expect(p.grupos.map((g) => g.archivos)).toEqual([
      "src/g/dominio/g.ts:1-40",
      "src/g/dominio/g.ts:41-90",
    ]);
  });

  it("expandir conserva el rango, resuelve el archivo y respeta las exclusiones", () => {
    expect(expandir("arquitectura/contratos/globs.cjs:1-30", RAIZ)).toEqual([
      "arquitectura/contratos/globs.cjs:1-30",
    ]);
    expect(
      expandir("arquitectura/contratos/g*.cjs:5-9,!arquitectura/contratos/guardian.cjs", RAIZ),
    ).toEqual(["arquitectura/contratos/globs.cjs:5-9"]);
  });
});

describe("grupos de mutación contra la configuración real", () => {
  const configuracion = JSON.parse(readFileSync(join(RAIZ, "stryker.config.json"), "utf8")) as {
    mutate: string[];
  };
  const grupos = require("../../arquitectura/grupos-de-mutacion.json") as {
    grupo: string;
    archivos: string;
    pruebas?: string;
  }[];
  const base = (entrada: string): string => archivoDe(entrada);

  it("cada archivo de `mutate` está en exactamente un grupo, o repartido por rangos que lo cubren entero", () => {
    const esperados = expandir(configuracion.mutate.join(","), RAIZ);
    const repartidos = grupos.flatMap((g) => expandir(g.archivos, RAIZ));
    const enteros = repartidos.filter((entrada) => entrada === base(entrada));
    const conRango = repartidos.filter((entrada) => entrada !== base(entrada));

    // un archivo entero no aparece dos veces ni a la vez con rangos; el resto de los archivos está completo
    const porArchivo = new Map<string, number[][]>();
    for (const entrada of conRango) {
      const [, desde, hasta] = /:(\d+)-(\d+)$/.exec(entrada) ?? [];
      const rangos = porArchivo.get(base(entrada)) ?? [];
      rangos.push([Number(desde), Number(hasta)]);
      porArchivo.set(base(entrada), rangos);
    }
    expect([...enteros, ...porArchivo.keys()].sort()).toEqual([...esperados].sort());

    for (const [archivo, rangos] of porArchivo) {
      // El original: Stryker le agrega `// @ts-nocheck` a los `.cjs` de `mutate` dentro de su sandbox y corre las líneas.
      const texto = readFileSync(join(RAIZ_ORIGINAL, archivo), "utf8");
      const lineas = texto.split("\n");
      const total = lineas.length - (texto.endsWith("\n") ? 1 : 0);
      rangos.sort((a, b) => (a[0] as number) - (b[0] as number));
      let esperadoDesde = 1;
      for (const [desde, hasta] of rangos as [number, number][]) {
        expect(desde, `${archivo}: el rango empieza donde terminó el anterior`).toBe(esperadoDesde);
        expect(hasta, `${archivo}: el rango termina después de empezar`).toBeGreaterThanOrEqual(
          desde,
        );
        esperadoDesde = hasta + 1;
        // cortar entre sentencias de primer nivel: un mutante que cruza el corte no entraría en ningún rango
        if (desde > 1) {
          const linea = lineas[desde - 1] as string;
          const anterior = lineas[desde - 2] as string;
          expect(linea, `${archivo}:${desde} no empieza una sentencia de primer nivel`).toMatch(
            /^[^\s})\]]/,
          );
          expect(
            anterior.trim() === "" || /^[})\]]/.test(anterior),
            `${archivo}:${desde} corta a mitad de una sentencia`,
          ).toBe(true);
        }
      }
      expect(
        esperadoDesde - 1,
        `${archivo}: los rangos no llegan a la última línea`,
      ).toBeGreaterThanOrEqual(total);
    }
  });

  it("cada grupo del guardián corre solo con las pruebas del guardián", () => {
    const delGuardian = grupos.filter((g) => g.archivos.includes("arquitectura/contratos/"));
    expect(delGuardian.length).toBeGreaterThan(0);
    for (const g of delGuardian) {
      // sin filtro correría toda la suite por mutante; y solo se admiten los archivos de ese guardián
      expect(g.pruebas, g.grupo).toBeTruthy();
      for (const prueba of (g.pruebas ?? "").split(" ")) {
        expect(prueba, g.grupo).toMatch(/^test\/arquitectura\/guardian-[a-z-]+\.test\.ts$/);
      }
      expect(
        g.archivos.split(",").every((a) => a.startsWith("arquitectura/contratos/")),
        g.grupo,
      ).toBe(true);
    }
  });
});
