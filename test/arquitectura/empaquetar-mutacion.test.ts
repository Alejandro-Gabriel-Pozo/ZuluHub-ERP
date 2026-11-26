import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

/**
 * Los grupos de mutación chicos comparten job (`arquitectura/empaquetar-mutacion.cjs`) y cada grupo se corre y se nombra por separado
 * (`arquitectura/correr-paquete-de-mutacion.cjs`). Qué previene cada caso: ver el encabezado de esos dos archivos. La regla de oro: agrupar NO puede
 * hacer que un grupo no corra, corra con otras pruebas u oculte cuál falló.
 */

type G = { grupo: string; archivos: string; pruebas: string };
type Paquete = { etiqueta: string; grupos: G[] };
const require = createRequire(import.meta.url);
const { empaquetar, etiquetaDe, gruposDelPlan, TOPE_DE_MINUTOS_DECLARADOS } =
  require("../../arquitectura/empaquetar-mutacion.cjs") as {
    empaquetar: (g: G[], m: Map<string, number>, tope?: number) => Paquete[];
    etiquetaDe: (g: G[]) => string;
    gruposDelPlan: (texto: string | undefined) => G[];
    TOPE_DE_MINUTOS_DECLARADOS: number;
  };
const { correrPaquete, problemasDelGrupo, escaparPropiedad, comandoDeStryker } =
  require("../../arquitectura/correr-paquete-de-mutacion.cjs") as {
    correrPaquete: (e: {
      grupos: unknown;
      ejecutar: (g: G) => number;
      escribir: (t: string) => void;
      ahora?: () => number;
    }) => {
      resultados: { grupo: string; codigo: number; segundos: number }[];
      fallaron: string[];
      resumen: string;
    };
    problemasDelGrupo: (g: unknown) => string[];
    escaparPropiedad: (t: string) => string;
    comandoDeStryker: (
      g: G,
      entorno: Record<string, string | undefined>,
      umbral?: unknown,
    ) => { argumentos: string[]; entorno: Record<string, string | undefined> };
  };
const { cargarLosGrupos } = require("../../arquitectura/grupos-de-mutacion.cjs") as {
  cargarLosGrupos: (raiz: string) => {
    grupos: { grupo: string; archivos: string; pruebas?: string; minutos: number }[];
  };
};

const RAIZ = join(import.meta.dirname, "../..");
const g = (grupo: string): G => ({ grupo, archivos: `src/${grupo}/x.ts`, pruebas: `src/${grupo}` });
const nombresDe = (paquetes: Paquete[]) => paquetes.flatMap((p) => p.grupos.map((x) => x.grupo));

describe("empaquetar: cada grupo del plan sale en exactamente un paquete", () => {
  it("propiedad: con cualquier lista de grupos y de minutos, ni se pierde ni se repite ninguno, y ningún paquete conocido pasa el tope", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 60 }), { maxLength: 40 }),
        fc.array(fc.option(fc.double({ min: -2, max: 40, noNaN: true }), { nil: undefined }), {
          maxLength: 40,
        }),
        fc.integer({ min: 1, max: 20 }),
        (ids, minutos, tope) => {
          const grupos = ids.map((i) => g(`g${i}`));
          const m = new Map<string, number>();
          grupos.forEach((x, i) => {
            const v = minutos[i];
            if (v !== undefined) m.set(x.grupo, v);
          });
          const paquetes = empaquetar(grupos, m, tope);
          expect(nombresDe(paquetes).sort()).toEqual(grupos.map((x) => x.grupo).sort());
          for (const p of paquetes) {
            expect(p.grupos.length).toBeGreaterThan(0);
            const suma = p.grupos.reduce((s, x) => s + (m.get(x.grupo) ?? Infinity), 0);
            if (p.grupos.length > 1) expect(suma).toBeLessThanOrEqual(tope);
          }
        },
      ),
    );
  });

  it("los chicos comparten job, hasta el tope", () => {
    const m = new Map([
      ["a", 4],
      ["b", 4],
      ["c", 4],
    ]);
    const p = empaquetar([g("a"), g("b"), g("c")], m, 8);
    expect(p.map((x) => x.grupos.map((y) => y.grupo))).toEqual([["a", "b"], ["c"]]);
  });

  it("un grupo más largo que el tope va solo (el camino crítico no cambia)", () => {
    const m = new Map([
      ["largo", 27],
      ["chico", 1],
    ]);
    const p = empaquetar([g("chico"), g("largo")], m, 8);
    expect(p.map((x) => x.grupos.map((y) => y.grupo))).toEqual([["largo"], ["chico"]]);
  });

  it.each([
    ["sin minutos declarados", undefined],
    ["con 0 minutos", 0],
    ["con minutos negativos", -3],
    ["con NaN", Number.NaN],
  ])("un grupo %s corre SOLO y primero: lo desconocido se supone largo", (_, minutos) => {
    const m = new Map<string, number>([["chico", 1]]);
    if (minutos !== undefined) m.set("raro", minutos);
    const p = empaquetar([g("chico"), g("raro")], m, 8);
    expect(p.map((x) => x.grupos.map((y) => y.grupo))).toEqual([["raro"], ["chico"]]);
  });

  it("la etiqueta del job nombra el primer grupo y cuántos van con él", () => {
    expect(etiquetaDe([g("a")])).toBe("a");
    expect(etiquetaDe([g("a"), g("b"), g("c")])).toBe("a y 2 más");
  });

  it("sin grupos (el plan no eligió ninguno): sin paquetes", () => {
    expect(empaquetar([], new Map())).toEqual([]);
  });

  it("con los grupos REALES: salen todos, una sola vez, con menos de la mitad de jobs y el más largo solo", () => {
    const reales = cargarLosGrupos(RAIZ).grupos;
    const plan: G[] = reales.map((x) => ({
      grupo: x.grupo,
      archivos: x.archivos,
      pruebas: x.pruebas ?? "",
    }));
    const minutos = new Map(reales.map((x) => [x.grupo, x.minutos]));
    const paquetes = empaquetar(plan, minutos);
    expect(nombresDe(paquetes).sort()).toEqual(plan.map((x) => x.grupo).sort());
    expect(paquetes.length).toBeLessThan(plan.length / 2);
    const masLargo = reales.reduce((a, b) => (b.minutos > a.minutos ? b : a));
    expect(
      paquetes.find((p) => p.grupos.some((x) => x.grupo === masLargo.grupo))?.grupos,
    ).toHaveLength(1);
    expect(TOPE_DE_MINUTOS_DECLARADOS).toBeGreaterThan(0);
  });
});

describe("empaquetar: los grupos del plan llegan por GRUPOS_DEL_PLAN", () => {
  it("toma la lista JSON del entorno", () => {
    const texto = '[{"grupo":"x","archivos":"a","pruebas":""}]';
    expect(gruposDelPlan(texto)).toEqual([{ grupo: "x", archivos: "a", pruebas: "" }]);
  });
  it.each([undefined, "", "   ", "{}", "no es json", '"texto"'])(
    "falla (no sigue) si falta, no es JSON o no es una lista: %j",
    (texto) => {
      expect(() => gruposDelPlan(texto)).toThrow();
    },
  );
});

describe("empaquetar: los DOS pasos como los corre Actions (cada paso con su propio $GITHUB_OUTPUT)", () => {
  // Qué previene: la primera versión (#350) leía `grupos=` del archivo de salidas del paso del plan y en Actions cada paso tiene el suyo: falló en
  // «Mutación (plan)». La prueba local usaba un solo archivo y no lo veía. Acá se corren los dos pasos con archivos distintos, y los grupos pasan por
  // `steps.plan.outputs.grupos` → `GRUPOS_DEL_PLAN`, que es lo que hace ci.yml.
  const nuevaCarpeta = () => mkdtempSync(join(tmpdir(), "empaquetar-"));
  const correr = (script: string, env: Record<string, string>) =>
    spawnSync("node", [join(RAIZ, script)], {
      cwd: RAIZ,
      encoding: "utf8",
      env: { NODE_ENV: "test", PATH: process.env["PATH"] ?? "", ...env },
    });
  const salidaDe = (archivo: string, clave: string) =>
    readFileSync(archivo, "utf8")
      .split("\n")
      .filter((l) => l.startsWith(`${clave}=`))
      .at(-1)
      ?.slice(clave.length + 1);

  it("el plan escribe en su archivo, el empaquetador en el suyo, y los grupos viajan por el entorno", () => {
    const dir = nuevaCarpeta();
    try {
      const delPlan = join(dir, "paso-plan");
      const delEmpaquetador = join(dir, "paso-paquetes");
      writeFileSync(delEmpaquetador, "");
      const plan = correr("arquitectura/planificar-mutacion.cjs", {
        GITHUB_OUTPUT: delPlan,
        GITHUB_EVENT_NAME: "push",
      });
      expect(plan.status, plan.stderr).toBe(0);
      const grupos = salidaDe(delPlan, "grupos") ?? "";
      expect(grupos.length).toBeGreaterThan(2);
      // Actions entrega `steps.plan.outputs.grupos` como variable de entorno del paso siguiente.
      const r = correr("arquitectura/empaquetar-mutacion.cjs", {
        GITHUB_OUTPUT: delEmpaquetador,
        GRUPOS_DEL_PLAN: grupos,
      });
      expect(r.status, r.stderr).toBe(0);
      const paquetes = JSON.parse(salidaDe(delEmpaquetador, "paquetes") ?? "null") as Paquete[];
      const delPlanJson = JSON.parse(grupos) as G[];
      expect(nombresDe(paquetes).sort()).toEqual(delPlanJson.map((x) => x.grupo).sort());
      expect(paquetes.length).toBeLessThan(delPlanJson.length / 2);
      // Y NO escribe nada en el archivo del otro paso.
      expect(readFileSync(delPlan, "utf8")).not.toContain("paquetes=");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("forma vieja: sin GRUPOS_DEL_PLAN falla aunque el archivo de OTRO paso tenga `grupos=` (no se lee el archivo del vecino)", () => {
    const dir = nuevaCarpeta();
    try {
      const delPlan = join(dir, "paso-plan");
      const delEmpaquetador = join(dir, "paso-paquetes");
      writeFileSync(delPlan, 'grupos=[{"grupo":"x","archivos":"src/x.ts","pruebas":""}]\n');
      writeFileSync(delEmpaquetador, "");
      const r = correr("arquitectura/empaquetar-mutacion.cjs", { GITHUB_OUTPUT: delEmpaquetador });
      expect(r.status).not.toBe(0);
      expect(readFileSync(delEmpaquetador, "utf8")).not.toContain("paquetes=");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sin $GITHUB_OUTPUT falla con código 2 (el paso corre solo dentro del job del plan)", () => {
    const r = correr("arquitectura/empaquetar-mutacion.cjs", { GRUPOS_DEL_PLAN: "[]" });
    expect(r.status).toBe(2);
  });

  it("el plan completo cabe de sobra en una variable de entorno (el límite de Linux es 128 KiB por variable)", () => {
    const todos = cargarLosGrupos(RAIZ).grupos.map((x) => ({
      grupo: x.grupo,
      archivos: x.archivos,
      pruebas: x.pruebas ?? "",
    }));
    expect(Buffer.byteLength(JSON.stringify(todos))).toBeLessThan(100_000);
  });
});

describe("correr un paquete: se nombra cada grupo y ninguna falla se oculta", () => {
  const grupos = [g("uno"), g("dos"), g("tres")];
  const corre = (codigos: Record<string, number>, lanzar: string[] = []) => {
    let salida = "";
    const corridos: string[] = [];
    const r = correrPaquete({
      grupos,
      ejecutar: (x) => {
        corridos.push(x.grupo);
        if (lanzar.includes(x.grupo)) throw new Error("no arrancó");
        return codigos[x.grupo] ?? 0;
      },
      escribir: (t) => (salida += t),
      ahora: (() => {
        let t = 0;
        return () => (t += 2000);
      })(),
    });
    return { r, salida, corridos };
  };

  it("todos cumplen: corren todos, en orden, y no falla ninguno", () => {
    const { r, corridos, salida } = corre({});
    expect(corridos).toEqual(["uno", "dos", "tres"]);
    expect(r.fallaron).toEqual([]);
    expect(salida).not.toContain("::error");
    for (const n of ["uno", "dos", "tres"]) expect(salida).toContain(`::group::Mutación · ${n}\n`);
  });

  it("si UNO falla, los demás igual corren; se nombra el grupo que falló y solo ese", () => {
    const { r, corridos, salida } = corre({ dos: 1 });
    expect(corridos).toEqual(["uno", "dos", "tres"]);
    expect(r.fallaron).toEqual(["dos"]);
    expect(salida).toContain("::error title=Mutación · dos::");
    expect(salida).not.toContain("::error title=Mutación · uno");
    expect(r.resumen).toContain("| dos | FALLA (código 1) | 2 |");
    expect(r.resumen).toContain("| uno | cumple | 2 |");
  });

  it("si varios fallan, se nombran todos", () => {
    expect(corre({ uno: 1, tres: 137 }).r.fallaron).toEqual(["uno", "tres"]);
  });

  it("un grupo que ni arranca (la ejecución lanza) cuenta como fallido y sigue con los demás", () => {
    const { r, corridos } = corre({}, ["uno"]);
    expect(r.fallaron).toEqual(["uno"]);
    expect(corridos).toEqual(["uno", "dos", "tres"]);
  });

  it("el nombre del grupo con comas y dos puntos no rompe la anotación (escape de GitHub)", () => {
    expect(escaparPropiedad("a, b: c%\nd")).toBe("a%2C b%3A c%25%0Ad");
    let salida = "";
    correrPaquete({
      grupos: [{ ...g("x"), grupo: "guardián (patrones, clasificación)" }],
      ejecutar: () => 1,
      escribir: (t) => (salida += t),
    });
    expect(salida).toContain("::error title=Mutación · guardián (patrones%2C clasificación)::");
  });

  it.each([
    ["no es una lista", {}],
    ["lista vacía", []],
    ["un elemento que no es objeto", ["x"]],
    [
      "archivos con un `;` (inyección)",
      [{ grupo: "a", archivos: "src/a.ts; rm -rf /", pruebas: "" }],
    ],
    ["archivos con `$(…)`", [{ grupo: "a", archivos: "$(id)", pruebas: "" }]],
    ["pruebas con una comilla", [{ grupo: "a", archivos: "src/a.ts", pruebas: "src/a'" }]],
    ["archivos vacío", [{ grupo: "a", archivos: "", pruebas: "" }]],
    ["sin nombre", [{ grupo: "", archivos: "src/a.ts", pruebas: "" }]],
    ["nombre larguísimo", [{ grupo: "x".repeat(201), archivos: "src/a.ts", pruebas: "" }]],
    ["pruebas que no es texto", [{ grupo: "a", archivos: "src/a.ts", pruebas: 3 }]],
  ])("falla cerrado (no corre nada) si el dato no sirve: %s", (_, datos) => {
    const corridos: string[] = [];
    expect(() =>
      correrPaquete({
        grupos: datos,
        ejecutar: (x) => (corridos.push(x.grupo), 0),
        escribir: () => undefined,
      }),
    ).toThrow();
    expect(corridos).toEqual([]);
  });

  it("acepta lo que hoy declaran los grupos reales (todos pasan la validación)", () => {
    for (const x of cargarLosGrupos(RAIZ).grupos) {
      expect(
        problemasDelGrupo({ grupo: x.grupo, archivos: x.archivos, pruebas: x.pruebas ?? "" }),
        x.grupo,
      ).toEqual([]);
    }
  });

  it("Stryker se llama como antes: el mismo --mutate con la exclusión de pruebas, el filtro de pruebas del grupo, el umbral de su nivel y sin shell", () => {
    const { argumentos, entorno } = comandoDeStryker(
      { grupo: "a", archivos: "src/a.ts,src/b.ts:1-9", pruebas: "src/a src/b" },
      { FC_SEMILLA: "20261011" },
      90,
    );
    expect(argumentos).toEqual([
      "stryker",
      "run",
      "--mutate",
      "src/a.ts,src/b.ts:1-9,!src/**/*.test.ts",
    ]);
    expect(entorno).toEqual({
      FC_SEMILLA: "20261011",
      PEDERNAL_FILTRO_PRUEBAS: "src/a src/b",
      PEDERNAL_UMBRAL_DE_MUTACION: "90",
    });
  });

  it("VIOLACIÓN: un grupo sin umbral válido (falta, 0, mayor que 100, decimal o texto) lanza: nunca corre con otro umbral", () => {
    const grupo = { grupo: "a", archivos: "src/a.ts", pruebas: "" };
    for (const umbral of [undefined, null, 0, -1, 101, 70.5, "70", Number.NaN]) {
      expect(() => comandoDeStryker(grupo, {}, umbral), String(umbral)).toThrow(
        "no tiene un umbral de mutación válido",
      );
    }
    for (const umbral of [1, 70, 90, 100]) {
      expect(comandoDeStryker(grupo, {}, umbral).entorno["PEDERNAL_UMBRAL_DE_MUTACION"]).toBe(
        String(umbral),
      );
    }
  });

  it("el umbral que llega a Stryker es el de la variable del entorno y la config lo lee de ahí (sin variable, 100; inválida, lanza)", () => {
    const leerUmbral = (valor: string | undefined) => {
      const base = { NODE_ENV: "test" as const, PATH: process.env["PATH"] ?? "" };
      const entorno = valor === undefined ? base : { ...base, PEDERNAL_UMBRAL_DE_MUTACION: valor };
      const r = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `const c = (await import(${JSON.stringify(join(RAIZ, "stryker.config.mjs"))})).default; console.log(c.thresholds.break);`,
        ],
        { encoding: "utf8", env: entorno },
      );
      return { salida: r.stdout.trim(), estado: r.status };
    };
    expect(leerUmbral(undefined)).toEqual({ salida: "100", estado: 0 });
    expect(leerUmbral("")).toEqual({ salida: "100", estado: 0 });
    expect(leerUmbral("90")).toEqual({ salida: "90", estado: 0 });
    expect(leerUmbral("70")).toEqual({ salida: "70", estado: 0 });
    for (const malo of ["0", "101", "7.5", "-1", "abc", "1e2", " 90", "090x"]) {
      expect(leerUmbral(malo).estado, malo).not.toBe(0);
    }
  });
});

describe("ci.yml: el job de mutación corre paquetes", () => {
  const ci = readFileSync(join(RAIZ, ".github/workflows/ci.yml"), "utf8");
  const bloque = (id: string) => {
    const desde = ci.indexOf(`\n  ${id}:\n`);
    const resto = ci.slice(desde + 1);
    const siguiente = resto.slice(1).search(/\n {2}[a-z-]+:\n/);
    return siguiente < 0 ? resto : resto.slice(0, siguiente + 1);
  };

  it("el plan arma los paquetes después del plan de grupos y los publica", () => {
    const plan = bloque("mutacion-plan");
    expect(plan).toContain("paquetes: ${{ steps.paquetes.outputs.paquetes }}");
    expect(plan).toContain("node arquitectura/empaquetar-mutacion.cjs");
    expect(plan.indexOf("planificar-mutacion.cjs")).toBeLessThan(
      plan.indexOf("empaquetar-mutacion.cjs"),
    );
    expect(plan).toContain("GRUPOS_DEL_PLAN: ${{ steps.plan.outputs.grupos }}");
  });

  it("la matriz sale de los paquetes, el job se nombra por su etiqueta y corre el script (no un Stryker suelto)", () => {
    const job = bloque("mutacion");
    expect(job).toContain("include: ${{ fromJSON(needs.mutacion-plan.outputs.paquetes) }}");
    expect(job).toContain("name: Mutación (${{ matrix.etiqueta }})");
    expect(job).toContain("node arquitectura/correr-paquete-de-mutacion.cjs");
    expect(job).toContain("GRUPOS_DEL_PAQUETE: ${{ toJSON(matrix.grupos) }}");
    expect(job).not.toContain("npx stryker run");
  });

  it("los datos del paquete llegan por el entorno y no escritos dentro del comando (sin inyección por plantilla)", () => {
    const job = bloque("mutacion");
    const linea = job.split("\n").find((l) => l.includes("correr-paquete-de-mutacion.cjs")) ?? "";
    expect(linea).not.toContain("${{");
  });

  it("violación inyectada: el job `mutacion` con un Stryker suelto o con la matriz de grupos ya no cumple", () => {
    const roto = bloque("mutacion")
      .replace(
        "node arquitectura/correr-paquete-de-mutacion.cjs",
        'npx stryker run --mutate "$ARCHIVOS"',
      )
      .replace("outputs.paquetes", "outputs.grupos");
    expect(roto).toContain("npx stryker run");
    expect(roto).not.toContain("outputs.paquetes");
  });
});
