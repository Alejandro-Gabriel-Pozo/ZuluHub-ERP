import {
  existsSync,
  globSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RAIZ_ORIGINAL } from "./guardian-apoyo";

/**
 * El planificador decide qué grupos de mutación corre un PR. Cada decisión que previene un
 * resultado de mutación obsoleto tiene acá el cambio que la dispara: si se la quita, el caso falla.
 */

type Grupo = {
  grupo: string;
  archivos: string;
  pruebas?: string;
  minutos?: number;
  expandidos: string[];
};
type Ci = { antes: string | null; despues: string | null };
type Plan = {
  completo: boolean;
  motivo: string;
  grupos: { grupo: string; archivos: string; pruebas: string }[];
};
const require = createRequire(import.meta.url);
const {
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
} = require("../../arquitectura/planificar-mutacion.cjs") as {
  planificar: (e: {
    cambios: string[];
    grupos: Grupo[];
    dependencias: Record<string, string[]>;
    ci?: Ci;
    lecturas?: Record<string, string[]>;
  }) => Plan;
  planificarEstabilidad: (e: {
    cambios: string[];
    dependencias: Record<string, string[]>;
    ci?: Ci;
    lecturas?: Record<string, string[]>;
  }) => { corre: boolean; motivo: string };
  ordenarPorDuracion: <G extends { minutos?: number }>(grupos: readonly G[]) => G[];
  cambioDeCiAfecta: (ci: Ci | undefined, ajenos: readonly string[]) => boolean;
  partirCi: (texto: string) => { cabecera: string; jobs: Map<string, string> } | null;
  LECTURAS_DE_APPS: Record<string, string[]>;
  JOBS_AJENOS_A_LA_MUTACION: string[];
  JOBS_AJENOS_A_LA_INTEGRACION: string[];
  expandir: (patrones: string, raiz: string) => string[];
  archivoDe: (entrada: string) => string;
  conEnlacesDelGuardian: (
    dependencias: Record<string, string[]>,
    archivosDelGuardian: string[],
  ) => Record<string, string[]>;
  leerArchivosDelGuardian: (raiz: string) => string[];
};

const RAIZ = join(import.meta.dirname, "../..");
const CI_REAL = readFileSync(join(RAIZ, ".github/workflows/ci.yml"), "utf8");

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

describe("planificador de mutación: el código del guardián (arquitectura/contratos y arquitectura/deuda)", () => {
  // Lo que el grafo de importaciones no ve: datos, procesos lanzados y archivos que el verificador lee.
  const CONTRATOS = [
    "arquitectura/contratos/a.cjs",
    "arquitectura/contratos/b.cjs",
    "arquitectura/contratos/datos.json",
    "arquitectura/deuda/c.cjs",
    "arquitectura/deuda/registro.json",
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
    {
      grupo: "guardián (deuda)",
      archivos: "arquitectura/deuda/c.cjs",
      pruebas: "test/arquitectura/guardian-deuda-x.test.ts",
      expandidos: ["arquitectura/deuda/c.cjs"],
    },
  ];
  const planGuardian = (cambios: string[]): Plan =>
    planificar({ cambios, grupos: GRUPOS_CON_GUARDIAN, dependencias: grafo() });

  it.each([
    ["un `.cjs` del guardián", "arquitectura/contratos/a.cjs"],
    ["un dato del guardián", "arquitectura/contratos/datos.json"],
    ["un `.cjs` del control de deuda", "arquitectura/deuda/c.cjs"],
    ["un dato del control de deuda", "arquitectura/deuda/registro.json"],
    ["un auxiliar de pruebas del guardián", "test/arquitectura/guardian-apoyo.ts"],
    ["una prueba del guardián", "test/arquitectura/guardian-x.test.ts"],
  ])("un cambio en %s corre TODOS los grupos del guardián y ninguno de src", (_nombre, archivo) => {
    const p = planGuardian([archivo]);
    expect(p.completo).toBe(false);
    expect(nombres(p)).toEqual(["guardián (a)", "guardián (b)", "guardián (deuda)"]);
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
      {
        grupo: "guardián (deuda)",
        archivos: "arquitectura/deuda/c.cjs",
        pruebas: "test/arquitectura/guardian-deuda-x.test.ts",
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
      "arquitectura/deuda/borrado.cjs",
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
        "arquitectura/deuda/c.cjs",
        "arquitectura/deuda/registro.json",
        "arquitectura/deuda/informe.json",
        "arquitectura/evaluar-gate.cjs",
        "arquitectura/lint-sql.cjs",
      ]) {
        mkdirSync(join(raiz, archivo, ".."), { recursive: true });
        writeFileSync(join(raiz, archivo), "{}");
      }
      // una carpeta con nombre de archivo no es un archivo
      mkdirSync(join(raiz, "arquitectura/contratos/carpeta.json"));
      mkdirSync(join(raiz, "arquitectura/deuda/carpeta.json"));
      expect(leerArchivosDelGuardian(raiz)).toEqual([
        "arquitectura/contratos/a.cjs",
        "arquitectura/contratos/sub/datos.json",
        "arquitectura/deuda/c.cjs",
        "arquitectura/deuda/registro.json",
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
    const mutadosDelGuardian = expandir(configuracion.mutate.join(","), RAIZ).filter(
      (a) => a.startsWith("arquitectura/contratos/") || a.startsWith("arquitectura/deuda/"),
    );
    expect(mutadosDelGuardian.some((a) => a.startsWith("arquitectura/deuda/"))).toBe(true);
    expect(mutadosDelGuardian.length).toBeGreaterThan(0);

    const archivosDelGuardian = leerArchivosDelGuardian(RAIZ);
    for (const mutado of mutadosDelGuardian) expect(archivosDelGuardian).toContain(mutado);
    expect(archivosDelGuardian.some((a) => a.endsWith("informe.json"))).toBe(false);
    // los datos de la carpeta y lo que el verificador carga del árbol también cuentan (el grafo no los ve)
    for (const dato of [
      "arquitectura/contratos/exclusiones.json",
      "arquitectura/deuda/registro.json",
      "arquitectura/deuda/configuracion.json",
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
      // `ci.yml` es una entrada del guardián: sin cambio de contenido en sus jobs de mutación, solo corre el guardián.
      const p = planificar({
        cambios: [cambio],
        grupos,
        dependencias,
        ci: { antes: CI_REAL, despues: CI_REAL },
      });
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

describe("planificador de mutación: apps/** (las aplicaciones importan de src, nunca al revés)", () => {
  // `apps/**` no es mutado: solo cuenta si una prueba de Node lo importa (el grafo lo ve) o lo lee como texto.
  const dependencias: Record<string, string[]> = {
    "src/a/dominio/a.ts": [],
    "src/a/dominio/a.test.ts": ["src/a/dominio/a.ts"],
    "src/c/dominio/c.ts": [],
    "src/c/dominio/c.test.ts": ["src/c/dominio/c.ts"],
    "apps/web/app/pagina.tsx": ["src/a/dominio/a.ts"],
    "apps/web/app/suelta.tsx": [],
    "apps/web/ui/tokens.css": [],
    "apps/web/ui/Boton.module.css": [],
    // una prueba de Chromium (proyecto `componentes`): importa una pantalla pero la mutación no la corre
    "apps/web/ui/boton.test.tsx": ["apps/web/app/pagina.tsx"],
    "apps/web/ui/tokens.test.ts": ["apps/web/app/pagina.tsx"],
    // pruebas de Node
    "test/web/pantalla.test.ts": ["apps/web/app/pagina.tsx"],
    "test/web/contraste.test.ts": ["src/c/dominio/c.ts"],
    "test/integracion/global.ts": [],
  };
  const lecturas = { "test/web/contraste.test.ts": ["apps/web/ui/tokens.css"] };
  const enApps = (cambios: string[], ci?: Ci): Plan =>
    planificar({ cambios, grupos: GRUPOS, dependencias, lecturas, ...(ci ? { ci } : {}) });

  it.each([
    ["una pantalla que ninguna prueba importa", "apps/web/app/suelta.tsx"],
    ["una hoja de estilos que ninguna prueba lee", "apps/web/ui/Boton.module.css"],
    ["un archivo de apps/ que ya no existe (no está en el grafo)", "apps/web/app/borrada.tsx"],
    ["un archivo nuevo de apps/ que ninguna prueba importa", "apps/plataforma/pantallas/nueva.tsx"],
    ["un vercel.json de la app", "apps/web/vercel.json"],
    ["un documento de la app", "apps/web/PRIMER-DESPLIEGUE.md"],
  ])("un cambio en %s no corre ningún grupo", (_nombre, archivo) => {
    expect(enApps([archivo])).toMatchObject({ completo: false, grupos: [] });
  });

  it("varios archivos de apps/ que ninguna prueba alcanza tampoco corren nada, ni siquiera junto a un .md", () => {
    const p = enApps(["apps/web/app/suelta.tsx", "apps/web/ui/Boton.module.css", "README.md"]);
    expect(p).toMatchObject({ completo: false, grupos: [] });
  });

  it("si una prueba de Node importa el archivo de apps/, corren los grupos de lo que esa prueba ejercita", () => {
    // test/web/pantalla.test.ts -> pagina.tsx -> a.ts: un cambio en la pantalla puede cambiar un resultado sobre a.ts
    expect(nombresDe(enApps(["apps/web/app/pagina.tsx"]))).toEqual(["a"]);
  });

  it("si una prueba de Node lo lee como texto (LECTURAS_DE_APPS), corren los grupos de lo que esa prueba ejercita", () => {
    expect(nombresDe(enApps(["apps/web/ui/tokens.css"]))).toEqual(["c"]);
    // y un cambio en otro archivo de apps/ no alcanza a esa prueba
    expect(enApps(["apps/web/ui/Boton.module.css"]).grupos).toEqual([]);
  });

  it("las pruebas de apps/ (proyecto `componentes`, Chromium) no cuentan: la mutación no las corre", () => {
    // si contaran, boton.test.tsx / tokens.test.ts llevarían el cambio de pagina.tsx hasta `a`; ya llega por pantalla.test.ts,
    // así que se prueba con un archivo que SOLO ellas importan
    const solo = {
      ...dependencias,
      "apps/web/app/solo-chromium.tsx": ["src/c/dominio/c.ts"],
      "apps/web/ui/otro.test.ts": ["apps/web/app/solo-chromium.tsx"],
    };
    const p = planificar({
      cambios: ["apps/web/app/solo-chromium.tsx"],
      grupos: GRUPOS,
      dependencias: solo,
      lecturas,
    });
    expect(p).toMatchObject({ completo: false, grupos: [] });
  });

  it.each([
    ["package.json de una app", "apps/web/package.json"],
    ["package.json de la consola", "apps/plataforma/package.json"],
    ["tsconfig de una app", "apps/web/tsconfig.json"],
    ["un tsconfig de la consola con otro nombre", "apps/plataforma/tsconfig.build.json"],
  ])("la configuración (%s) corre todos los grupos completos", (_nombre, archivo) => {
    const p = enApps([archivo]);
    expect(p.completo).toBe(true);
    expect(nombresDe(p)).toEqual(["a", "b", "c"]);
  });

  it("lo desconocido gana: un archivo de apps/ sin alcance junto a uno fuera del grafo corre todo", () => {
    expect(enApps(["apps/web/app/suelta.tsx", "tsconfig.json"]).completo).toBe(true);
    expect(enApps(["apps/web/app/suelta.tsx", "src/a/dominio/borrado.ts"]).completo).toBe(true);
  });

  it("un cambio en apps/ junto a uno en src/ corre lo de src/ y lo que las pruebas de apps/ alcanzan", () => {
    expect(nombresDe(enApps(["apps/web/app/suelta.tsx", "src/c/dominio/c.ts"]))).toEqual(["c"]);
  });

  it("las lecturas declaradas apuntan a pruebas y a archivos que existen", () => {
    for (const [prueba, patrones] of Object.entries(LECTURAS_DE_APPS)) {
      expect(existsSync(join(RAIZ, prueba)), prueba).toBe(true);
      expect(patrones.length, prueba).toBeGreaterThan(0);
      for (const patron of patrones) {
        expect(patron, prueba).toMatch(/^apps\//);
        expect(globSync(patron, { cwd: RAIZ }).length, `${prueba}: ${patron}`).toBeGreaterThan(0);
      }
    }
  });

  it("ningún archivo de src/ ni de scripts/ importa una aplicación (la premisa de saltear apps/)", () => {
    // La regla de arquitectura `src-sin-apps` lo exige con dependency-cruiser; esto es un chequeo barato del mismo hecho.
    const ARCHIVOS = [
      ...globSync("src/**/*.{ts,tsx}", { cwd: RAIZ }),
      ...globSync("scripts/**/*.{ts,mjs}", { cwd: RAIZ }),
      ...globSync("arquitectura/**/*.cjs", { cwd: RAIZ }),
    ];
    const IMPORTA_APPS = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'](?:[./]*\/)?apps\//;
    const infractores = ARCHIVOS.filter((a) =>
      IMPORTA_APPS.test(readFileSync(join(RAIZ, a), "utf8")),
    );
    expect(infractores).toEqual([]);
  });

  it("toda prueba que lee archivos de apps/ está declarada en LECTURAS_DE_APPS (o explicada como que no los lee de verdad)", () => {
    // Las del guardián arman árboles VIRTUALES con nombres `apps/...` y leen del árbol real solo `arquitectura/`,
    // `ci.yml` y `package.json`; el repositorio real (`git ls-files`) no está disponible dentro del sandbox de Stryker.
    const NO_LEEN_APPS_REALES = [
      /^test\/arquitectura\/guardian-[^/]+\.ts$/,
      // Esta misma prueba: grafos de juguete con nombres `apps/...`; del árbol real solo lista nombres de archivo.
      /^test\/arquitectura\/planificar-mutacion\.test\.ts$/,
    ];
    const LECTURA_DE_ARCHIVOS =
      /\b(readFileSync|readdirSync|readdir|globSync|existsSync|statSync|lstatSync|readFile|opendirSync|cpSync|copyFileSync)\b/;
    const candidatas = [
      ...globSync("test/**/*.{ts,tsx}", { cwd: RAIZ }),
      ...globSync("src/**/*.{test.ts,test.tsx}", { cwd: RAIZ }),
    ].filter((archivo) => {
      const texto = readFileSync(join(RAIZ, archivo), "utf8");
      return /\bapps\//.test(texto) && LECTURA_DE_ARCHIVOS.test(texto);
    });
    const sinDeclarar = candidatas.filter(
      (a) => !(a in LECTURAS_DE_APPS) && !NO_LEEN_APPS_REALES.some((patron) => patron.test(a)),
    );
    expect(
      sinDeclarar,
      "estas pruebas mencionan `apps/` y leen archivos: si leen archivos de apps/ como texto, declaralas en LECTURAS_DE_APPS (arquitectura/planificar-mutacion.cjs)",
    ).toEqual([]);
  });
});

const nombresDe = (p: Plan) => p.grupos.map((g) => g.grupo);

describe("planificador de mutación: ci.yml", () => {
  // Un ci.yml mínimo con el estilo de Prettier: cabecera, jobs ajenos a la mutación y los jobs de mutación.
  const CI = [
    "name: CI",
    "",
    "on:",
    "  push:",
    "    branches: [main]",
    "",
    "permissions:",
    "  contents: read",
    "",
    "jobs:",
    "  estatico:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: npm run lint",
    "",
    "  pruebas:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: npm test",
    "",
    "  mutacion-plan:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: node arquitectura/planificar-mutacion.cjs",
    "",
    "  mutacion:",
    "    needs: mutacion-plan",
    "    runs-on: ubuntu-latest",
    "    timeout-minutes: 90",
    "    steps:",
    "      - run: npx stryker run",
    "",
    "  gate:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: node arquitectura/evaluar-gate.cjs",
    "",
  ].join("\n");
  const cambiando = (de: string, a: string): Ci => {
    expect(CI.split(de).length - 1, `«${de}» tiene que aparecer una vez`).toBe(1);
    return { antes: CI, despues: CI.replace(de, a) };
  };

  describe("qué cambios obligan a mutar todo", () => {
    it.each([
      [
        "el comando de Stryker (job mutacion)",
        "npx stryker run",
        "npx stryker run --concurrency 1",
      ],
      ["el timeout del job mutacion", "timeout-minutes: 90", "timeout-minutes: 80"],
      ["el plan (job mutacion-plan)", "planificar-mutacion.cjs", "otro.cjs"],
      ["los eventos (cabecera)", "branches: [main]", "branches: [main, otra]"],
      ["los permisos (cabecera)", "contents: read", "contents: write"],
      ["un comentario de la cabecera", "name: CI", "name: CI # nuevo"],
    ])("%s", (_nombre, de, a) => {
      expect(cambioDeCiAfecta(cambiando(de, a), JOBS_AJENOS_A_LA_MUTACION)).toBe(true);
    });

    it("un job NUEVO que no figura entre los ajenos (ni renombrado): ante la duda, mutar todo", () => {
      const nuevo = {
        antes: CI,
        despues: CI.replace("  gate:\n", "  e2e:\n    runs-on: ubuntu-latest\n\n  gate:\n"),
      };
      expect(cambioDeCiAfecta(nuevo, JOBS_AJENOS_A_LA_MUTACION)).toBe(true);
      const renombrado = { antes: CI, despues: CI.replace("  mutacion:\n", "  mutacion-v2:\n") };
      expect(cambioDeCiAfecta(renombrado, JOBS_AJENOS_A_LA_MUTACION)).toBe(true);
    });

    it("quitar el job de mutación", () => {
      const sin = { antes: CI, despues: CI.replace(/ {2}mutacion:\n(?: {4}.*\n)+\n/, "") };
      expect(sin.despues).not.toBe(CI);
      expect(cambioDeCiAfecta(sin, JOBS_AJENOS_A_LA_MUTACION)).toBe(true);
    });

    it.each([
      ["no hay versión anterior", { antes: null, despues: CI }],
      ["no hay versión nueva", { antes: CI, despues: null }],
      ["no se pasó el contenido", undefined],
      ["la versión nueva no tiene `jobs:`", { antes: CI, despues: "name: CI\n" }],
      [
        "la versión anterior no se entiende (job duplicado)",
        { antes: CI + "  gate:\n    runs-on: x\n", despues: CI },
      ],
      [
        "usa anclas de YAML (un job ajeno podría traer el cuerpo de uno de mutación)",
        {
          antes: CI,
          despues: CI.replace(
            "      - run: npm test\n",
            "      - run: npm test\n    env: &comun\n",
          ),
        },
      ],
      [
        "usa alias de YAML",
        {
          antes: CI,
          despues: CI.replace(
            "      - run: npm test\n",
            "      - run: npm test\n    env: *comun\n",
          ),
        },
      ],
    ])("si %s", (_nombre, ci) => {
      expect(cambioDeCiAfecta(ci as Ci | undefined, JOBS_AJENOS_A_LA_MUTACION)).toBe(true);
    });
  });

  describe("qué cambios NO obligan a mutar todo", () => {
    it.each([
      ["el job estatico", "npm run lint", "npm run lint && npm run format:check"],
      ["el job pruebas", "      - run: npm test", "      - run: npm test -- --bail"],
      ["el gate", "evaluar-gate.cjs", "evaluar-gate.cjs # nada"],
    ])("un cambio solo en %s", (_nombre, de, a) => {
      expect(cambioDeCiAfecta(cambiando(de, a), JOBS_AJENOS_A_LA_MUTACION)).toBe(false);
    });

    it("un job ajeno nuevo (web, componentes…) o quitado", () => {
      for (const id of ["web", "componentes", "seguridad"]) {
        expect(JOBS_AJENOS_A_LA_MUTACION).toContain(id);
        const nuevo = {
          antes: CI,
          despues: CI.replace("  gate:\n", `  ${id}:\n    runs-on: ubuntu-latest\n\n  gate:\n`),
        };
        expect(cambioDeCiAfecta(nuevo, JOBS_AJENOS_A_LA_MUTACION), id).toBe(false);
        expect(
          cambioDeCiAfecta({ antes: nuevo.despues, despues: CI }, JOBS_AJENOS_A_LA_MUTACION),
          id,
        ).toBe(false);
      }
    });

    it("sin ninguna diferencia, o solo líneas en blanco al final", () => {
      expect(cambioDeCiAfecta({ antes: CI, despues: CI }, JOBS_AJENOS_A_LA_MUTACION)).toBe(false);
      expect(cambioDeCiAfecta({ antes: CI, despues: `${CI}\n\n` }, JOBS_AJENOS_A_LA_MUTACION)).toBe(
        false,
      );
      expect(
        cambioDeCiAfecta(
          { antes: CI.replaceAll("\n", "\r\n"), despues: CI },
          JOBS_AJENOS_A_LA_MUTACION,
        ),
      ).toBe(false);
    });

    it("el ci.yml real se entiende, y sus jobs de mutación no están entre los ajenos", () => {
      const real = partirCi(CI_REAL);
      expect(real).not.toBeNull();
      const ids = [...(real?.jobs.keys() ?? [])];
      expect(ids).toEqual(
        expect.arrayContaining(["estatico", "mutacion-plan", "mutacion", "gate", "estabilidad"]),
      );
      for (const id of ["mutacion-plan", "mutacion"]) {
        expect(JOBS_AJENOS_A_LA_MUTACION, id).not.toContain(id);
      }
      // todo job ajeno existe de verdad (la lista no queda vieja) y el real es entendible por el planificador
      for (const id of JOBS_AJENOS_A_LA_MUTACION) expect(ids, id).toContain(id);
      for (const id of JOBS_AJENOS_A_LA_INTEGRACION) expect(ids, id).toContain(id);
      expect(JOBS_AJENOS_A_LA_INTEGRACION).not.toContain("estabilidad");
      expect(JOBS_AJENOS_A_LA_INTEGRACION).not.toContain("pruebas");
      expect(JOBS_AJENOS_A_LA_INTEGRACION).not.toContain("mutacion-plan");
    });
  });

  describe("el plan con un cambio en ci.yml", () => {
    const CIGRAFO = ".github/workflows/ci.yml";
    const dependencias = {
      ...DEPENDENCIAS,
      "test/arquitectura/guardian-x.test.ts": [] as string[],
    };
    const CONTRATOS = ["arquitectura/contratos/a.cjs", CIGRAFO];
    const grafo = conEnlacesDelGuardian(dependencias, CONTRATOS);
    const grupos: Grupo[] = [
      ...GRUPOS,
      {
        grupo: "guardián (a)",
        archivos: "arquitectura/contratos/a.cjs",
        pruebas: "test/arquitectura/guardian-x.test.ts",
        expandidos: ["arquitectura/contratos/a.cjs"],
      },
    ];
    const conCi = (ci: Ci | undefined): Plan =>
      planificar({ cambios: [CIGRAFO], grupos, dependencias: grafo, ...(ci ? { ci } : {}) });

    it("un cambio en jobs ajenos corre solo el guardián, cuyas pruebas leen ci.yml, y ningún grupo de src", () => {
      const p = conCi(cambiando("npm run lint", "npm run lint && npm run format:check"));
      expect(p.completo).toBe(false);
      expect(nombresDe(p)).toEqual(["guardián (a)"]);
    });

    it("un cambio en el job de mutación o en la cabecera corre TODOS los grupos completos", () => {
      for (const ci of [
        cambiando("npx stryker run", "npx stryker run --concurrency 1"),
        cambiando("contents: read", "contents: write"),
      ]) {
        const p = conCi(ci);
        expect(p.completo).toBe(true);
        expect(nombresDe(p)).toEqual(grupos.map((g) => g.grupo));
      }
    });

    it("sin el contenido de las dos versiones corre todo (fail-closed, como antes)", () => {
      expect(conCi(undefined).completo).toBe(true);
      expect(conCi({ antes: null, despues: CI }).completo).toBe(true);
    });

    it("aunque el grafo ya conozca ci.yml, un cambio que afecta nunca se trata como un nodo más", () => {
      expect(conCi(cambiando("timeout-minutes: 90", "timeout-minutes: 10")).completo).toBe(true);
    });

    it("junto a otro cambio, el más amplio manda", () => {
      const p = planificar({
        cambios: [CIGRAFO, "package.json"],
        grupos,
        dependencias: grafo,
        ci: cambiando("npm run lint", "npm run lint # x"),
      });
      expect(p.completo).toBe(true);
    });

    it("los workflows que ninguna prueba lee (codeql, gate-rapido) no corren nada; migrar*.yml siguen corriendo todo", () => {
      for (const ignorable of [
        ".github/workflows/codeql.yml",
        ".github/workflows/gate-rapido.yml",
      ]) {
        expect(plan([ignorable]), ignorable).toMatchObject({ completo: false, grupos: [] });
      }
      for (const archivo of [
        ".github/workflows/migrar.yml",
        ".github/workflows/migrar-base.yml",
        ".github/CODEOWNERS",
      ]) {
        expect(plan([archivo]).completo, archivo).toBe(true);
      }
    });
  });
});

describe("planificador de mutación: orden por duración descendente", () => {
  const g = (grupo: string, minutos?: number): Grupo => ({
    grupo,
    archivos: `src/${grupo}/dominio/*.ts`,
    expandidos: [`src/${grupo}/dominio/${grupo}.ts`],
    ...(minutos === undefined ? {} : { minutos }),
  });
  const deps: Record<string, string[]> = {
    "src/x/dominio/x.ts": [],
    "src/y/dominio/y.ts": [],
    "src/z/dominio/z.ts": [],
    "src/w/dominio/w.ts": [],
    "src/v/dominio/v.ts": [],
  };
  const grupos = [g("x", 3.2), g("y", 26.4), g("z", 3.2), g("w", 13.9), g("v")];
  const ordenados = ["v", "y", "w", "x", "z"];

  it("el más lento primero; los empates conservan el orden del archivo; el que no tiene duración, primero", () => {
    expect(ordenarPorDuracion(grupos).map((x) => x.grupo)).toEqual(ordenados);
  });

  it("no cambia la entrada ni pierde ni duplica grupos", () => {
    const copia = structuredClone(grupos);
    const salida = ordenarPorDuracion(grupos);
    expect(grupos).toEqual(copia);
    expect(salida).toHaveLength(grupos.length);
    expect(new Set(salida.map((x) => x.grupo)).size).toBe(grupos.length);
  });

  it("un plan completo (por lo desconocido) sale en ese orden y con los mismos grupos", () => {
    const p = planificar({ cambios: ["tsconfig.json"], grupos, dependencias: deps });
    expect(p.completo).toBe(true);
    expect(p.grupos.map((x) => x.grupo)).toEqual(ordenados);
  });

  it("un plan parcial (por el grafo) también sale ordenado, sin cambiar cuáles corren", () => {
    const cambios = ["src/x/dominio/x.ts", "src/y/dominio/y.ts", "src/z/dominio/z.ts"];
    const p = planificar({ cambios, grupos, dependencias: deps });
    expect(p.grupos.map((x) => x.grupo)).toEqual(["y", "x", "z"]);
    // mismo conjunto que sin ordenar
    const sinMinutos = grupos.map((x) => ({
      grupo: x.grupo,
      archivos: x.archivos,
      expandidos: x.expandidos,
    }));
    const q = planificar({ cambios, grupos: sinMinutos, dependencias: deps });
    expect(new Set(q.grupos.map((x) => x.grupo))).toEqual(new Set(p.grupos.map((x) => x.grupo)));
  });

  it("con las duraciones reales: todos los grupos declaran su duración y el plan completo sale de mayor a menor", () => {
    const reales = (
      require("../../arquitectura/grupos-de-mutacion.json") as {
        grupo: string;
        archivos: string;
        pruebas?: string;
        minutos?: number;
      }[]
    ).map((x) => ({ ...x, expandidos: expandir(x.archivos, RAIZ) }));
    for (const x of reales) {
      expect(
        typeof x.minutos === "number" && x.minutos > 0,
        `${x.grupo}: falta «minutos» (duración medida en main, en minutos)`,
      ).toBe(true);
    }
    const p = planificar({ cambios: ["tsconfig.json"], grupos: reales, dependencias: {} });
    expect(p.completo).toBe(true);
    expect(p.grupos).toHaveLength(reales.length);
    const minutosDe = new Map(reales.map((x) => [x.grupo, x.minutos ?? 0]));
    const secuencia = p.grupos.map((x) => minutosDe.get(x.grupo) ?? 0);
    expect(secuencia).toEqual([...secuencia].sort((a, b) => b - a));
    expect(new Set(p.grupos.map((x) => x.grupo)).size).toBe(reales.length);
  });
});

describe("planificador: cuándo se repite la integración (Estabilidad x12)", () => {
  const dependencias: Record<string, string[]> = {
    "src/a/dominio/a.ts": [],
    "src/a/dominio/a.test.ts": ["src/a/dominio/a.ts"],
    "src/b/persistencia/b.ts": ["src/a/dominio/a.ts"],
    "src/solo-unidad/s.ts": [],
    "src/solo-unidad/s.test.ts": ["src/solo-unidad/s.ts"],
    "src/huerfano.ts": [],
    "scripts/migrar-base.ts": [],
    "test/integracion/global.ts": [],
    "test/integracion/topes.ts": [],
    "test/integracion/b.test.ts": ["src/b/persistencia/b.ts", "test/integracion/global.ts"],
    "test/web/contraste.test.ts": [],
    "test/web/pantalla.test.ts": ["apps/web/app/pagina.tsx"],
    "apps/web/app/pagina.tsx": ["src/solo-unidad/s.ts"],
    "apps/web/app/suelta.tsx": [],
    "apps/web/ui/tokens.css": [],
    "test/integracion/web.test.ts": ["apps/web/app/importada.tsx"],
    "apps/web/app/importada.tsx": [],
  };
  const lecturas = { "test/web/contraste.test.ts": ["apps/web/ui/tokens.css"] };
  const e = (cambios: string[], ci?: Ci) =>
    planificarEstabilidad({ cambios, dependencias, lecturas, ...(ci ? { ci } : {}) });
  const CORRE = true;

  it.each([
    ["una prueba de integración", "test/integracion/b.test.ts"],
    ["lo que vitest carga antes de todo", "test/integracion/global.ts"],
    ["los topes de la integración", "test/integracion/topes.ts"],
    ["un auxiliar nuevo de la integración", "test/integracion/nuevo-auxiliar.ts"],
    ["una migración", "migraciones/0009_algo.sql"],
    ["un script (algunos los lanza la integración como proceso aparte)", "scripts/migrar-base.ts"],
    ["un archivo de src/ que importa una prueba de integración", "src/b/persistencia/b.ts"],
    ["lo que importa lo anterior (por cierre)", "src/a/dominio/a.ts"],
    ["una pantalla que importa una prueba de integración", "apps/web/app/importada.tsx"],
    ["la configuración de vitest", "vitest.config.ts"],
    ["las dependencias", "package.json"],
    ["el lockfile", "package-lock.json"],
    ["el tsconfig", "tsconfig.json"],
    ["un archivo de src/ borrado (no está en el grafo)", "src/borrado.ts"],
    ["la configuración de una app", "apps/web/package.json"],
    ["un archivo cualquiera fuera del grafo", "neon.ts"],
    ["el CODEOWNERS", ".github/CODEOWNERS"],
    ["los workflows de migración", ".github/workflows/migrar-base.yml"],
  ])("corre si cambia %s", (_nombre, archivo) => {
    expect(e([archivo]).corre, archivo).toBe(CORRE);
  });

  it.each([
    ["documentación", "README.md"],
    ["dependabot", ".github/dependabot.yml"],
    ["otros workflows (codeql, gate rápido)", ".github/workflows/codeql.yml"],
    ["una pantalla que ninguna prueba alcanza", "apps/web/app/suelta.tsx"],
    ["una pantalla que solo importan pruebas que no son de integración", "apps/web/app/pagina.tsx"],
    ["un archivo de src/ que solo alcanzan pruebas de unidad", "src/solo-unidad/s.ts"],
    ["una prueba de unidad", "src/solo-unidad/s.test.ts"],
    ["un archivo de src/ que nadie importa", "src/huerfano.ts"],
    [
      "un archivo de apps/ que una prueba que no es de integración lee como texto",
      "apps/web/ui/tokens.css",
    ],
    ["un vercel.json de una app", "apps/web/vercel.json"],
  ])("NO corre si solo cambia %s", (_nombre, archivo) => {
    expect(e([archivo]).corre, archivo).toBe(false);
  });

  it("lo desconocido gana: un cambio inocuo junto a uno que afecta, o a uno desconocido, corre", () => {
    expect(e(["README.md", "src/b/persistencia/b.ts"]).corre).toBe(true);
    expect(e(["apps/web/app/suelta.tsx", "tsconfig.json"]).corre).toBe(true);
    expect(e(["src/solo-unidad/s.ts", "migraciones/0009_algo.sql"]).corre).toBe(true);
  });

  it("un PR sin ningún cambio (por ejemplo, solo ignorables) no la repite", () => {
    expect(e([]).corre).toBe(false);
    expect(e(["README.md", ".gitleaks.toml", "skills-lock.json"]).corre).toBe(false);
  });

  describe("con cambios en ci.yml", () => {
    const CI = [
      "name: CI",
      "jobs:",
      "  estatico:",
      "    steps:",
      "      - run: npm run lint",
      "  pruebas:",
      "    steps:",
      "      - run: npm test",
      "  estabilidad:",
      "    steps:",
      "      - run: npx vitest run test/integracion",
      "  mutacion:",
      "    steps:",
      "      - run: npx stryker run",
      "",
    ].join("\n");
    const cambiando = (de: string, a: string): Ci => ({ antes: CI, despues: CI.replace(de, a) });
    const ci = ".github/workflows/ci.yml";

    it.each([
      ["el job estabilidad", "test/integracion", "test/integracion --bail"],
      ["el job pruebas (misma base y comando)", "npm test", "npm test -- --x"],
      ["la cabecera", "name: CI", "name: CI2"],
    ])("corre si cambia %s", (_nombre, de, a) => {
      expect(e([ci], cambiando(de, a)).corre).toBe(true);
    });

    it.each([
      ["el job estatico", "npm run lint", "npm run lint && x"],
      ["el job de mutación", "npx stryker run", "npx stryker run --concurrency 2"],
    ])("NO corre si solo cambia %s", (_nombre, de, a) => {
      expect(e([ci], cambiando(de, a)).corre).toBe(false);
    });

    it("sin las dos versiones, o con un job nuevo desconocido, corre (fail-closed)", () => {
      expect(e([ci]).corre).toBe(true);
      expect(e([ci], { antes: null, despues: CI }).corre).toBe(true);
      expect(
        e([ci], { antes: CI, despues: `${CI}  nuevo:\n    steps:\n      - run: x\n` }).corre,
      ).toBe(true);
    });
  });

  it("los workflows del repo real: las listas de jobs ajenos a la integración no incluyen a los que la ejecutan", () => {
    for (const id of ["estabilidad", "pruebas", "mutacion-plan"]) {
      expect(JOBS_AJENOS_A_LA_INTEGRACION, id).not.toContain(id);
    }
  });
});
