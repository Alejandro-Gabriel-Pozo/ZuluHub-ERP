import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

/**
 * El job `reloj` corre la suite crítica (caja, cierre, planes, ventas y fiscal) con el reloj fijado POR DELANTE del real en tres momentos
 * (`arquitectura/reloj-critico.cjs`). Qué previene cada caso: ver el encabezado de ese archivo. Lo que NO puede pasar: que la suite crítica quede vacía y
 * el job salga verde, que un reloj fijado quede ATRASADO respecto del real (falla en rojo por el `now()` de la base), que una pasada roja tape a otra,
 * o que el cambio de un módulo crítico no dispare el job en un pull request.
 */
const RAIZ = join(import.meta.dirname, "../..");
const require = createRequire(import.meta.url);
type Pasada = { nombre: string; fijo: string; zona: string };
const modulo = require("../../arquitectura/reloj-critico.cjs") as {
  leerConfiguracion: (texto: string) => { modulos: string[] };
  pruebasCriticas: (d: Record<string, string[]>, c: { modulos: string[] }) => string[];
  tocaLaSuiteCritica: (cambios: string[], criticas: string[], c: { modulos: string[] }) => boolean;
  variantes: (ahora: number) => Pasada[];
  correr: (e: {
    criticas: string[];
    pasadas: Pasada[];
    ejecutar: (p: Pasada, c: readonly string[]) => number;
    escribir: (t: string) => void;
    ahora?: () => number;
  }) => {
    resultados: { nombre: string; codigo: number; segundos: number }[];
    fallaron: string[];
    resumen: string;
  };
  MARGEN_MS: number;
};
const { leerConfiguracion, pruebasCriticas, tocaLaSuiteCritica, variantes, correr, MARGEN_MS } =
  modulo;
const CONFIGURACION = { modulos: ["caja", "cierre", "planes", "ventas", "fiscal"] };
const TEXTO_REAL = readFileSync(join(RAIZ, "arquitectura/reloj-critico.json"), "utf8");
/** Si esta prueba corre bajo Stryker, el proceso hijo (el CLI real) tiene que saber qué mutante está activo: sin esto la mutación del CLI nunca se ve. */
const MUTANTE_ACTIVO: Record<string, string> =
  process.env["__STRYKER_ACTIVE_MUTANT__"] === undefined
    ? {}
    : { __STRYKER_ACTIVE_MUTANT__: process.env["__STRYKER_ACTIVE_MUTANT__"] };
const MINUTO = 60_000;
const DIA = 24 * 60 * MINUTO;
/** El instante de Argentina (UTC-3) `HH:MM` del día `AAAA-MM-DD`. */
const ar = (dia: string, hora: string): number => Date.parse(`${dia}T${hora}:00-03:00`);

describe("reloj crítico: la configuración", () => {
  it("la real son los cinco módulos del dueño (16/11/2026)", () => {
    expect(leerConfiguracion(TEXTO_REAL)).toEqual(CONFIGURACION);
  });

  it.each([
    ["sin la lista", "{}"],
    ["lista vacía", '{"modulos":[]}'],
    ["no es una lista", '{"modulos":"caja"}'],
    ["un nombre con mayúsculas", '{"modulos":["Caja"]}'],
    ["una ruta en vez de un nombre", '{"modulos":["../caja"]}'],
    ["un nombre vacío", '{"modulos":[""]}'],
    ["un número", '{"modulos":[1]}'],
    ["un objeto que no es de módulos", "[]"],
    ["nulo", "null"],
    ["uno bueno y uno malo", '{"modulos":["caja","Mal"]}'],
    ["un nulo entre los nombres", '{"modulos":["caja",null]}'],
    ["un nombre con algo antes", '{"modulos":["1caja"]}'],
    ["un nombre con algo después", '{"modulos":["caja1"]}'],
    ["un nombre con guion bajo", '{"modulos":["caja_x"]}'],
  ])("se rechaza: %s", (_nombre, texto) => {
    expect(() => leerConfiguracion(texto)).toThrow("reloj-critico.json");
  });
});

describe("reloj crítico: qué pruebas son críticas (import DIRECTO)", () => {
  const dependencias = {
    "test/integracion/a.test.ts": ["src/modulos/caja/publico.ts"],
    "test/integracion/b.test.ts": ["src/modulos/ventas/dominio/ticket.ts", "src/x.ts"],
    "test/integracion/c.test.ts": ["test/integracion/apoyo.ts"], // solo vía un apoyo: NO
    "test/integracion/d.test.ts": ["src/modulos/catalogo/publico.ts"], // otro módulo: NO
    "test/integracion/apoyo.ts": ["src/modulos/caja/publico.ts"], // no es una prueba: NO
    "src/modulos/caja/dominio/sesion.test.ts": ["src/modulos/caja/dominio/sesion.ts"], // unitaria: NO
    "test/integracion/e.test.ts": ["src/modulos/fiscal/publico.ts"],
    "test/integracion/f.test.ts": ["src/modulos/cierre/publico.ts"],
    "test/integracion/g.test.ts": ["src/modulos/planes/publico.ts"],
    "test/integracion/h.test.ts": ["src/modulos/cajas-viejas/publico.ts"], // prefijo de otro nombre: NO
    "test/integracion/sub/i.test.ts": ["src/modulos/caja/publico.ts"], // subcarpeta: NO
  };

  it("solo las pruebas de integración con un import directo de un archivo de un módulo crítico, ordenadas", () => {
    expect(pruebasCriticas(dependencias, CONFIGURACION)).toEqual([
      "test/integracion/a.test.ts",
      "test/integracion/b.test.ts",
      "test/integracion/e.test.ts",
      "test/integracion/f.test.ts",
      "test/integracion/g.test.ts",
    ]);
  });

  it("los nombres que solo se parecen a una prueba de integración no cuentan", () => {
    const parecidos = {
      "x/test/integracion/a.test.ts": ["src/modulos/caja/publico.ts"],
      "test/integracion/a.test.ts.snap": ["src/modulos/caja/publico.ts"],
      "test/integracion/a.test.tsx": ["src/modulos/caja/publico.ts"],
      "test/integracion/a-test.ts": ["src/modulos/caja/publico.ts"],
      "otro/src/modulos/caja/publico.ts": [],
    };
    expect(pruebasCriticas(parecidos, CONFIGURACION)).toEqual([]);
    expect(
      pruebasCriticas(
        { "test/integracion/z.test.ts": ["otro/src/modulos/caja/publico.ts"] },
        CONFIGURACION,
      ),
    ).toEqual([]);
  });

  it("sin módulos que coincidan la lista queda vacía (y `correr` se niega, ver abajo)", () => {
    expect(pruebasCriticas(dependencias, { modulos: ["stock"] })).toEqual([]);
  });

  it("en el repositorio real hay pruebas críticas y entre ellas las de caja, cierre, ventas, planes y fiscal", () => {
    const r = spawnSync("node", [join(RAIZ, "arquitectura/reloj-critico.cjs"), "listar"], {
      cwd: RAIZ,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    expect(r.status, r.stderr).toBe(0);
    const lista = r.stdout.split("\n").filter((l) => l !== "");
    expect(lista.length).toBeGreaterThan(20);
    expect(lista.every((l) => /^test\/integracion\/[^/]+\.test\.ts$/.test(l))).toBe(true);
    expect(lista).toContain("test/integracion/caja-cobrar-casos.test.ts");
    expect(lista).toContain("test/integracion/caja-cierre-del-dia-casos-de-uso.test.ts");
    expect([...lista].sort()).toEqual(lista);
  }, 120_000);
});

describe("reloj crítico: cuándo un pull request toca la suite", () => {
  const criticas = ["test/integracion/caja-x.test.ts"];
  const toca = (...cambios: string[]) => tocaLaSuiteCritica(cambios, criticas, CONFIGURACION);

  it.each([
    "src/modulos/caja/dominio/sesion.ts",
    "src/modulos/cierre/publico.ts",
    "src/modulos/planes/casos-de-uso/x.ts",
    "src/modulos/ventas/persistencia/y.ts",
    "src/modulos/fiscal/dominio/z.ts",
    "test/integracion/caja-x.test.ts", // una prueba crítica
    "test/integracion/caja-apoyo.ts", // un apoyo de integración
    "test/integracion/reloj-de-la-corrida.ts",
    "test/integracion/global.ts",
    "migraciones/0099_algo.sql",
    ".github/workflows/ci.yml",
    "vitest.config.ts",
    "package.json",
    "package-lock.json",
    "arquitectura/reloj-critico.cjs",
    "arquitectura/reloj-critico.json",
  ])("«%s» la toca", (cambio) => {
    expect(toca(cambio)).toBe(true);
  });

  it.each([
    "README.md",
    "otro/migraciones/x.sql",
    "x/.github/workflows/ci.yml",
    ".github/workflows/ci.yml.bak",
    "x/vitest.config.ts",
    "vitest.config.ts.map",
    "x/package.json",
    "package.json.bak",
    "package-lock.jsonx",
    "arquitectura/reloj-critico.cjsx",
    "x/arquitectura/reloj-critico.json",
    "x/test/integracion/apoyo.ts",
    "test/integracion/apoyo.ts.bak",
    "x/src/modulos/caja/a.ts",
    "src/modulos/catalogo/publico.ts",
    "src/modulos/cajas-viejas/x.ts",
    "src/primitivas/dinero/dinero.ts",
    "apps/web/ui/x.tsx",
    "test/integracion/catalogo-x.test.ts", // una prueba de integración que no es crítica
    "test/integracion/sub/otro.ts",
    "arquitectura/decisiones/registro/DEC-0001.json",
    ".github/workflows/codeql.yml",
  ])("«%s» NO la toca", (cambio) => {
    expect(toca(cambio)).toBe(false);
  });

  it("basta uno entre muchos, y sin cambios no la toca", () => {
    expect(toca("README.md", "src/modulos/catalogo/a.ts", "src/modulos/caja/b.ts")).toBe(true);
    expect(toca()).toBe(false);
  });
});

describe("reloj crítico: las tres pasadas, siempre por DELANTE del reloj real", () => {
  const forma = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|-03:00)$/;

  it("tres pasadas con su zona: Argentina, Argentina y UTC (la variante UTC es obligatoria)", () => {
    const v = variantes(Date.parse("2026-11-16T19:30:00Z"));
    expect(v).toEqual([
      {
        nombre: "23h30 de Argentina",
        fijo: "2026-11-16T23:30:00-03:00",
        zona: "America/Argentina/Buenos_Aires",
      },
      {
        nombre: "00h30 de Argentina",
        fijo: "2026-11-17T00:30:00-03:00",
        zona: "America/Argentina/Buenos_Aires",
      },
      { nombre: "cambio de dia UTC con la base en UTC", fijo: "2026-11-17T00:00:00Z", zona: "UTC" },
    ]);
  });

  it("los nombres no llevan «:» ni «,» (van en comandos de GitHub Actions)", () => {
    for (const { nombre } of variantes(Date.now())) expect(nombre).not.toMatch(/[:,%\n\r]/);
  });

  it.each([
    [
      "justo antes del margen de las 23:30 (23:24:59.999)",
      ar("2026-11-16", "23:24") + 59_999,
      "2026-11-16T23:30:00-03:00",
    ],
    [
      "justo en el margen (23:25:00 → 23:30 ya no queda por delante)",
      ar("2026-11-16", "23:25"),
      "2026-11-17T23:30:00-03:00",
    ],
    ["pasadas las 23:30", ar("2026-11-16", "23:45"), "2026-11-17T23:30:00-03:00"],
    ["a las 00:00 en punto", ar("2026-11-16", "00:00"), "2026-11-16T23:30:00-03:00"],
  ])("23:30: %s", (_nombre, ahora, esperado) => {
    expect(variantes(ahora)[0]?.fijo).toBe(esperado);
  });

  it.each([
    ["a las 00:24:59.999", ar("2026-11-17", "00:24") + 59_999, "2026-11-17T00:30:00-03:00"],
    ["a las 00:25:00", ar("2026-11-17", "00:25"), "2026-11-18T00:30:00-03:00"],
    ["a las 23:59", ar("2026-11-16", "23:59"), "2026-11-17T00:30:00-03:00"],
    ["a las 12:00", ar("2026-11-16", "12:00"), "2026-11-17T00:30:00-03:00"],
  ])("00:30: %s", (_nombre, ahora, esperado) => {
    expect(variantes(ahora)[1]?.fijo).toBe(esperado);
  });

  it.each([
    ["23:54:59.999Z", Date.parse("2026-11-16T23:54:59.999Z"), "2026-11-17T00:00:00Z"],
    [
      "23:55:00Z (ya no queda por delante)",
      Date.parse("2026-11-16T23:55:00Z"),
      "2026-11-18T00:00:00Z",
    ],
    ["00:00:00Z en punto", Date.parse("2026-11-17T00:00:00Z"), "2026-11-18T00:00:00Z"],
    ["fin de año", Date.parse("2026-12-31T23:59:00Z"), "2027-01-02T00:00:00Z"],
  ])("cambio de día UTC: %s", (_nombre, ahora, esperado) => {
    expect(variantes(ahora)[2]?.fijo).toBe(esperado);
  });

  it("propiedad: en cualquier instante de 2026 a 2030 cada pasada queda adelante por el margen, a menos de un día más el margen, y con la forma que acepta el reloj", () => {
    fc.assert(
      fc.property(
        fc.integer({
          min: Date.parse("2026-01-01T00:00:00Z"),
          max: Date.parse("2030-12-31T23:59:59Z"),
        }),
        (ahora) => {
          for (const { fijo, zona } of variantes(ahora)) {
            expect(fijo).toMatch(forma);
            const instante = Date.parse(fijo);
            expect(Number.isFinite(instante)).toBe(true);
            expect(instante).toBeGreaterThan(ahora + MARGEN_MS);
            expect(instante).toBeLessThanOrEqual(ahora + MARGEN_MS + DIA);
            expect(["America/Argentina/Buenos_Aires", "UTC"]).toContain(zona);
          }
          const [a, b, c] = variantes(ahora);
          expect(a?.fijo.slice(10)).toBe("T23:30:00-03:00");
          expect(b?.fijo.slice(10)).toBe("T00:30:00-03:00");
          expect(c?.fijo.slice(10)).toBe("T00:00:00Z");
          expect(c?.zona).toBe("UTC");
          expect(a?.zona).toBe("America/Argentina/Buenos_Aires");
          expect(b?.zona).toBe("America/Argentina/Buenos_Aires");
        },
      ),
      { numRuns: 2000 },
    );
  });
});

describe("reloj crítico: correr las pasadas", () => {
  const pasadas = variantes(Date.parse("2026-11-16T19:30:00Z"));
  const criticas = ["test/integracion/a.test.ts", "test/integracion/b.test.ts"];
  const salida = () => {
    const lineas: string[] = [];
    return { escribir: (t: string) => lineas.push(t), texto: () => lineas.join("") };
  };

  it("sin pruebas críticas no hay pasada verde: lanza (un job verde sin pruebas no prueba nada)", () => {
    expect(() =>
      correr({ criticas: [], pasadas, ejecutar: () => 0, escribir: () => undefined }),
    ).toThrow("no tiene ninguna prueba");
  });

  it("todas verdes: cada pasada recibe SU instante, SU zona y las pruebas críticas, en orden", () => {
    const llamadas: [Pasada, readonly string[]][] = [];
    const s = salida();
    const r = correr({
      criticas,
      pasadas,
      ejecutar: (p, c) => {
        llamadas.push([p, c]);
        return 0;
      },
      escribir: s.escribir,
    });
    expect(r.fallaron).toEqual([]);
    expect(llamadas.map(([p]) => p)).toEqual(pasadas);
    expect(
      llamadas.every(([, c]) => c === criticas || JSON.stringify(c) === JSON.stringify(criticas)),
    ).toBe(true);
    expect(s.texto()).not.toContain("::error");
    expect(r.resumen).toContain("2 archivo(s) de la suite crítica en 3 pasada(s)");
    expect(r.resumen.match(/\| cumple \|/g)).toHaveLength(3);
  });

  it("el texto exacto: un grupo plegable por pasada y la tabla del resumen", () => {
    const s = salida();
    let t = 0;
    const r = correr({
      criticas,
      pasadas: [pasadas[0] as Pasada, pasadas[2] as Pasada],
      ejecutar: (p) => (p.zona === "UTC" ? 3 : 0),
      escribir: s.escribir,
      ahora: () => (t += 2000),
    });
    expect(s.texto()).toBe(
      "::group::Reloj · 23h30 de Argentina (reloj 2026-11-16T23:30:00-03:00, base en America/Argentina/Buenos_Aires)\n" +
        "::endgroup::\n" +
        "::group::Reloj · cambio de dia UTC con la base en UTC (reloj 2026-11-17T00:00:00Z, base en UTC)\n" +
        "::endgroup::\n" +
        "::error title=Reloj · cambio de dia UTC con la base en UTC::La suite critica fallo con el reloj en 2026-11-17T00:00:00Z y la base en UTC (codigo 3).\n",
    );
    expect(r.resumen).toBe(
      [
        "### Reloj: 2 archivo(s) de la suite crítica en 2 pasada(s)",
        "",
        "| Pasada | Resultado | Segundos |",
        "|---|---|---|",
        "| 23h30 de Argentina | cumple | 2 |",
        "| cambio de dia UTC con la base en UTC | FALLA (código 3) | 2 |",
        "",
      ].join("\n"),
    );
  });

  it("una pasada roja NO frena a las otras y se nombra en el error y en el resumen", () => {
    const corridas: string[] = [];
    const s = salida();
    const r = correr({
      criticas,
      pasadas,
      ejecutar: (p) => {
        corridas.push(p.nombre);
        return p.zona === "UTC" ? 1 : 0;
      },
      escribir: s.escribir,
    });
    expect(corridas).toEqual(pasadas.map((p) => p.nombre)); // las tres corrieron
    expect(r.fallaron).toEqual(["cambio de dia UTC con la base en UTC"]);
    expect(s.texto()).toContain("::error title=Reloj · cambio de dia UTC con la base en UTC::");
    expect(s.texto()).toContain("la base en UTC (codigo 1)");
    expect(r.resumen).toContain("| cambio de dia UTC con la base en UTC | FALLA (código 1) |");
  });

  it("un error al ejecutar cuenta como pasada roja, no como un salto", () => {
    const s = salida();
    const r = correr({
      criticas,
      pasadas,
      ejecutar: (p) => {
        if (p.nombre.startsWith("00h30")) throw new Error("no se pudo lanzar vitest");
        return 0;
      },
      escribir: s.escribir,
    });
    expect(r.fallaron).toEqual(["00h30 de Argentina"]);
    expect(s.texto()).toContain("no se pudo lanzar vitest");
  });

  it("el título del `::error` escapa `:` y `,` (propiedad) y no queda ninguna línea rota por saltos", () => {
    const s = salida();
    correr({
      criticas,
      pasadas: [{ nombre: "x: a,b\n%", fijo: "2026-11-17T00:00:00Z", zona: "UTC" }],
      ejecutar: () => 1,
      escribir: s.escribir,
    });
    const error = s
      .texto()
      .split("\n")
      .find((l) => l.startsWith("::error"));
    expect(error).toContain("title=Reloj · x%3A a%2Cb%0A%25::");
  });

  it("los segundos de cada pasada salen del reloj que se le pasa", () => {
    let t = 0;
    const r = correr({
      criticas,
      pasadas,
      ejecutar: () => 0,
      escribir: () => undefined,
      ahora: () => (t += 4000),
    });
    expect(r.resultados.map((x) => x.segundos)).toEqual([4, 4, 4]);
  });
});

describe("reloj crítico: piezas del paso", () => {
  const {
    dependenciasDeLaSalida,
    salidaDeDepcruise,
    decidirElPlan,
    comandoDeLaPasada,
    archivosCambiados,
    cambiosSegunEvento,
  } = modulo as unknown as {
    archivosCambiados: (raiz: string) => string[];
    cambiosSegunEvento: (
      evento: string,
      raiz: string,
      leer?: (raiz: string) => string[],
    ) => string[];
    dependenciasDeLaSalida: (s: string) => Record<string, string[]>;
    salidaDeDepcruise: (ejecutar: () => string) => string;
    decidirElPlan: (e: {
      evento: string;
      cambios: string[];
      criticas: string[];
      configuracion: { modulos: string[] };
    }) => { corre: boolean; motivo: string };
    comandoDeLaPasada: (
      p: Pasada,
      archivos: string[],
      entorno: Record<string, string>,
    ) => { argumentos: string[]; entorno: Record<string, string> };
  };

  it("dependencias: una entrada por archivo con lo que importa, sin vacíos ni sin resolver", () => {
    const salida = JSON.stringify({
      modules: [
        {
          source: "a.ts",
          dependencies: [{ resolved: "b.ts" }, { resolved: "" }, {}, { resolved: "c.ts" }],
        },
        { source: "b.ts", dependencies: [] },
      ],
    });
    expect(dependenciasDeLaSalida(salida)).toEqual({ "a.ts": ["b.ts", "c.ts"], "b.ts": [] });
  });

  it("depcruise: la salida normal pasa tal cual; con código distinto de cero se usa su salida; sin salida se lanza el error", () => {
    expect(salidaDeDepcruise(() => "{}")).toBe("{}");
    expect(
      salidaDeDepcruise(() => {
        throw Object.assign(new Error("violaciones"), { stdout: '{"modules":[]}' });
      }),
    ).toBe('{"modules":[]}');
    for (const stdout of ["", undefined, 5, null]) {
      expect(() =>
        salidaDeDepcruise(() => {
          throw Object.assign(new Error("no corrió"), { stdout });
        }),
      ).toThrow("no corrió");
    }
  });

  it("los cambios de un pull request son los del commit de merge contra su primer padre (repositorio de verdad, sin líneas vacías)", () => {
    const repo = mkdtempSync(join(tmpdir(), "reloj-git-"));
    try {
      const git = (...args: string[]) =>
        spawnSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...args], {
          encoding: "utf8",
        });
      git("init", "-q", "-b", "main");
      writeFileSync(join(repo, "base.txt"), "1");
      git("add", "-A");
      git("commit", "-q", "-m", "base");
      git("checkout", "-q", "-b", "rama");
      mkdirSync(join(repo, "src"), { recursive: true });
      writeFileSync(join(repo, "src/uno.ts"), "1");
      writeFileSync(join(repo, "dos.md"), "2");
      git("add", "-A");
      git("commit", "-q", "-m", "cambio");
      git("checkout", "-q", "main");
      writeFileSync(join(repo, "solo-main.txt"), "3");
      git("add", "-A");
      git("commit", "-q", "-m", "otro");
      git("merge", "-q", "--no-ff", "-m", "merge", "rama");
      // El primer padre del merge es `main` antes del merge: el cambio es lo que trajo la rama (no lo de main).
      expect(archivosCambiados(repo)).toEqual(["dos.md", "src/uno.ts"]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }, 60_000);

  it("solo en un pull request se miran los cambios (en otro evento no se lee nada)", () => {
    const leer = (raiz: string) => [`cambio-en-${raiz}`];
    expect(cambiosSegunEvento("pull_request", "/x", leer)).toEqual(["cambio-en-/x"]);
    for (const evento of ["push", "schedule", "workflow_dispatch", ""]) {
      expect(cambiosSegunEvento(evento, "/x", leer), evento).toEqual([]);
    }
  });

  it("plan: fuera de un pull request corre siempre y los cambios no importan", () => {
    const base = { cambios: ["README.md"], criticas: [], configuracion: CONFIGURACION };
    expect(decidirElPlan({ ...base, evento: "push" })).toEqual({
      corre: true,
      motivo: "evento push: corre siempre",
    });
    expect(decidirElPlan({ ...base, evento: "schedule" })).toEqual({
      corre: true,
      motivo: "evento schedule: corre siempre",
    });
    expect(decidirElPlan({ ...base, evento: "workflow_dispatch" }).corre).toBe(true);
    expect(decidirElPlan({ ...base, evento: "" })).toEqual({
      corre: true,
      motivo: "evento local: corre siempre",
    });
  });

  it("plan: en un pull request corre solo si el cambio toca la suite crítica", () => {
    const e = { evento: "pull_request", criticas: [], configuracion: CONFIGURACION };
    expect(decidirElPlan({ ...e, cambios: ["src/modulos/caja/a.ts"] })).toEqual({
      corre: true,
      motivo: "el cambio toca la suite crítica",
    });
    expect(decidirElPlan({ ...e, cambios: ["README.md"] })).toEqual({
      corre: false,
      motivo: "el cambio no toca la suite crítica",
    });
    expect(decidirElPlan({ ...e, cambios: [] }).corre).toBe(false);
  });

  it("comando de una pasada: vitest con las pruebas críticas, el reloj y la zona de ESA pasada (pisan lo que hubiera)", () => {
    const pasada = { nombre: "x", fijo: "2026-11-17T00:00:00Z", zona: "UTC" };
    const { argumentos, entorno } = comandoDeLaPasada(pasada, ["a.test.ts", "b.test.ts"], {
      PATH: "/usr/bin",
      PEDERNAL_RELOJ_FIJO: "otro",
      PEDERNAL_ZONA_DE_LA_BASE: "otra",
    });
    expect(argumentos).toEqual(["vitest", "run", "--project", "node", "a.test.ts", "b.test.ts"]);
    expect(entorno).toEqual({
      PATH: "/usr/bin",
      PEDERNAL_RELOJ_FIJO: "2026-11-17T00:00:00Z",
      PEDERNAL_ZONA_DE_LA_BASE: "UTC",
    });
  });
});

describe("reloj crítico: el paso de verdad", () => {
  const correrCli = (modo: string, entorno: Record<string, string | undefined>) => {
    const salida = mkdtempSync(join(tmpdir(), "reloj-critico-"));
    try {
      const archivo = join(salida, "salida.txt");
      const r = spawnSync("node", [join(RAIZ, "arquitectura/reloj-critico.cjs"), modo], {
        cwd: RAIZ,
        encoding: "utf8",
        env: {
          NODE_ENV: "test",
          PATH: process.env["PATH"] ?? "",
          GITHUB_OUTPUT: archivo,
          ...MUTANTE_ACTIVO,
          ...entorno,
        },
        maxBuffer: 16 * 1024 * 1024,
      });
      let escrito = "";
      try {
        escrito = readFileSync(archivo, "utf8");
      } catch {
        escrito = "";
      }
      return { r, escrito };
    } finally {
      rmSync(salida, { recursive: true, force: true });
    }
  };

  it.each(["push", "schedule", "workflow_dispatch"])(
    "plan con el evento «%s»: corre siempre (`reloj=true` en la salida del paso)",
    (evento) => {
      const { r, escrito } = correrCli("plan", { GITHUB_EVENT_NAME: evento });
      expect(r.status, r.stderr).toBe(0);
      expect(escrito).toBe("reloj=true\n");
      expect(r.stdout).toContain("corre siempre");
    },
    120_000,
  );

  it.each([[""], [undefined]])(
    "plan con la variable de salida en «%s»: sale 0 y no escribe nada",
    (salida) => {
      const { r, escrito } = correrCli("plan", { GITHUB_OUTPUT: salida });
      expect(r.status, r.stderr).toBe(0);
      expect(escrito).toBe("");
    },
    120_000,
  );

  it("plan sin evento ni archivo de salida: dice «local», sale 0 y no escribe nada", () => {
    const { r, escrito } = correrCli("plan", { GITHUB_OUTPUT: "" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(
      /^Reloj: evento local: corre siempre \(\d+ archivo\(s\) críticos\)\.\n$/,
    );
    expect(escrito).toBe("");
  }, 120_000);

  it("plan de un push: la línea de estado dice cuántas pruebas críticas hay", () => {
    const { r } = correrCli("plan", { GITHUB_EVENT_NAME: "push" });
    expect(r.stdout).toMatch(
      /^Reloj: evento push: corre siempre \([1-9]\d* archivo\(s\) críticos\)\.\n$/,
    );
  }, 120_000);

  describe("`correr` con un `npx` de mentira (graba cómo lo llaman y sale con el código que se le pide)", () => {
    const conNpxFalso = (
      codigo: string,
      resumenComo: "archivo" | "vacio" | "ausente" = "archivo",
    ) => {
      const carpeta = mkdtempSync(join(tmpdir(), "reloj-npx-"));
      try {
        const registro = join(carpeta, "llamadas.txt");
        const resumen = join(carpeta, "resumen.md");
        writeFileSync(
          join(carpeta, "npx"),
          '#!/bin/sh\necho "SALIDA-DEL-VITEST-FALSO"\necho "ARGS:$*|RELOJ:$PEDERNAL_RELOJ_FIJO|ZONA:$PEDERNAL_ZONA_DE_LA_BASE" >> "$REGISTRO_FALSO"\nexit "$CODIGO_FALSO"\n',
        );
        chmodSync(join(carpeta, "npx"), 0o755);
        const r = spawnSync("node", [join(RAIZ, "arquitectura/reloj-critico.cjs"), "correr"], {
          cwd: RAIZ,
          encoding: "utf8",
          maxBuffer: 16 * 1024 * 1024,
          env: {
            NODE_ENV: "test",
            PATH: `${carpeta}:${process.env["PATH"] ?? ""}`,
            REGISTRO_FALSO: registro,
            CODIGO_FALSO: codigo,
            GITHUB_STEP_SUMMARY:
              resumenComo === "archivo" ? resumen : resumenComo === "vacio" ? "" : undefined,
            ...MUTANTE_ACTIVO,
          },
        });
        const leer = (ruta: string) => {
          try {
            return readFileSync(ruta, "utf8");
          } catch {
            return "";
          }
        };
        return {
          r,
          llamadas: leer(registro)
            .split("\n")
            .filter((l) => l !== ""),
          resumen: leer(resumen),
        };
      } finally {
        rmSync(carpeta, { recursive: true, force: true });
      }
    };

    it("todas verdes: tres llamadas a vitest con las pruebas críticas, cada una con su reloj y su zona; sale 0 y escribe el resumen", () => {
      const { r, llamadas, resumen } = conNpxFalso("0");
      expect(r.status, r.stderr).toBe(0);
      expect(r.stderr).toBe("");
      expect(llamadas).toHaveLength(3);
      for (const llamada of llamadas) {
        expect(llamada).toMatch(
          /^ARGS:vitest run --project node test\/integracion\/[^ ]+\.test\.ts /,
        );
        expect(llamada).toContain(" test/integracion/caja-cobrar-casos.test.ts");
      }
      expect(llamadas[0]).toMatch(
        /\|RELOJ:\d{4}-\d{2}-\d{2}T23:30:00-03:00\|ZONA:America\/Argentina\/Buenos_Aires$/,
      );
      expect(llamadas[1]).toMatch(
        /\|RELOJ:\d{4}-\d{2}-\d{2}T00:30:00-03:00\|ZONA:America\/Argentina\/Buenos_Aires$/,
      );
      expect(llamadas[2]).toMatch(/\|RELOJ:\d{4}-\d{2}-\d{2}T00:00:00Z\|ZONA:UTC$/);
      expect(r.stdout).toContain("::group::Reloj · 23h30 de Argentina");
      expect(r.stdout.match(/SALIDA-DEL-VITEST-FALSO/g)).toHaveLength(3); // lo que imprime vitest se ve en el log del job
      expect(resumen.match(/\| cumple \|/g)).toHaveLength(3);
    }, 120_000);

    it.each([["vacio"], ["ausente"]] as const)(
      "con el resumen del paso en estado «%s» corre igual, sale 0 y no escribe ningún resumen",
      (estado) => {
        const { r, llamadas, resumen } = conNpxFalso("0", estado);
        expect(r.status, r.stderr).toBe(0);
        expect(llamadas).toHaveLength(3);
        expect(resumen).toBe("");
      },
      120_000,
    );

    it("si vitest falla en las tres pasadas: corren todas, sale 1 y nombra cuáles", () => {
      const { r, llamadas, resumen } = conNpxFalso("1");
      expect(r.status).toBe(1);
      expect(llamadas).toHaveLength(3);
      expect(r.stderr).toBe(
        "Fallaron 3 pasada(s): 23h30 de Argentina; 00h30 de Argentina; cambio de dia UTC con la base en UTC\n",
      );
      expect(r.stdout).toContain("::error title=Reloj · 23h30 de Argentina::");
      expect(resumen.match(/FALLA \(código 1\)/g)).toHaveLength(3);
    }, 120_000);
  });

  it("un modo desconocido sale con 2 y dice el uso", () => {
    const { r } = correrCli("otra-cosa", {});
    expect(r.status).toBe(2);
    expect(r.stderr).toBe("Uso: node arquitectura/reloj-critico.cjs plan|correr|listar\n");
  }, 120_000);
});

describe("reloj crítico: ci.yml", () => {
  const ci = readFileSync(join(RAIZ, ".github/workflows/ci.yml"), "utf8");
  const trozo = (id: string, siguiente: string) =>
    ci.slice(ci.indexOf(`\n  ${id}:\n`), ci.indexOf(`\n  ${siguiente}:\n`));

  it("el job `reloj` espera al plan, usa Postgres 18 y corre las pasadas", () => {
    const reloj = trozo("reloj", "mutacion-plan");
    expect(reloj).toContain("needs: mutacion-plan");
    expect(reloj).toContain("image: postgres:18");
    expect(reloj).toContain("PRUEBAS_DATABASE_URL: postgres://postgres@localhost:5432/postgres");
    expect(reloj).toContain("- run: node arquitectura/reloj-critico.cjs correr");
    expect(reloj).toContain("timeout-minutes: 45");
    expect(reloj).not.toContain("always()");
    expect(reloj).not.toContain("secrets.");
  });

  it("el plan dice si el pull request toca la suite y la salida llega al job", () => {
    const plan = trozo("mutacion-plan", "mutacion");
    expect(plan).toContain("reloj: ${{ steps.reloj.outputs.reloj }}");
    expect(plan).toContain("- id: reloj\n        run: node arquitectura/reloj-critico.cjs plan");
  });

  it("el Gate espera al job", () => {
    expect(trozo("gate", "web")).toMatch(/^\s+reloj,$/m);
  });
});
