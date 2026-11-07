import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, normalize } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { expandir, archivoDe } = require("../../arquitectura/planificar-mutacion.cjs") as {
  expandir: (patrones: string, raiz: string) => string[];
  archivoDe: (entrada: string) => string;
};

/**
 * Un archivo que sale de PARTIR uno mutado no puede quedar fuera de la mutación en silencio.
 *
 * Previene: `stryker.config.json > mutate` lista archivos uno por uno (`src/adaptadores/arca/clasificar.ts`,
 * `arquitectura/contratos/guardian.cjs`…). La prueba de `planificar-mutacion.test.ts` ya falla si un archivo de `mutate`
 * no está en exactamente un grupo, pero NO ve lo inverso: al partir `clasificar.ts` en dos, el archivo hijo queda sin
 * `mutate` y sin grupo, sus mutantes nunca corren y nada falla (hay 21 archivos grandes por partir).
 *
 * Qué comprueba: todo archivo del MISMO directorio que un archivo mutado importa (`import … from "./x"`, `require("./x")`,
 * `import("./x")`) está en `mutate`, o figura en `arquitectura/mutate-sin-mutar.json` con su motivo. «Y en su grupo» lo
 * exige la prueba de `planificar-mutacion.test.ts` en cuanto el archivo entra a `mutate`. Límite: no ve el hijo que ningún
 * archivo mutado importa.
 */

const RAIZ = join(import.meta.dirname, "../..");
type Hallazgo = { archivo: string; importadoPor: string; linea: number };
type Permitido = { archivo: string; motivo: string };

const IMPORTA = /(?:\bfrom\s+|\brequire\(\s*|\bimport\(\s*|^\s*import\s+)["'](\.{1,2}\/[^"']+)["']/;
const NO_ES_CODIGO = /\.json$|\.d\.ts$|\.test\.[cm]?[jt]sx?$/;

/** A qué archivo apunta un import relativo de `desde` (el primero que existe), o `null`. */
function resolver(
  desde: string,
  relativo: string,
  existe: (ruta: string) => boolean,
): string | null {
  const base = normalize(join(dirname(desde), relativo))
    .split("\\")
    .join("/");
  const sinJs = base.replace(/\.[cm]?js$/, "");
  const candidatos = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.cjs`,
    `${sinJs}.ts`,
    `${sinJs}.tsx`,
  ];
  return candidatos.find((candidato) => existe(candidato)) ?? null;
}

/** Los archivos del mismo directorio que un archivo mutado importa y que no están en `mutados`. */
function hermanosSinMutar(datos: {
  mutados: readonly string[];
  leer: (ruta: string) => string;
  existe: (ruta: string) => boolean;
}): Hallazgo[] {
  const { mutados, leer, existe } = datos;
  const enMutate = new Set(mutados);
  const hallazgos: Hallazgo[] = [];
  for (const origen of mutados) {
    leer(origen)
      .split("\n")
      .forEach((renglon, indice) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(renglon)) return;
        const relativo = IMPORTA.exec(renglon)?.[1];
        if (relativo === undefined) return;
        const destino = resolver(origen, relativo, existe);
        if (destino === null || NO_ES_CODIGO.test(destino) || enMutate.has(destino)) return;
        if (dirname(destino) !== dirname(origen)) return;
        hallazgos.push({ archivo: destino, importadoPor: origen, linea: indice + 1 });
      });
  }
  return hallazgos.sort((a, b) =>
    `${a.archivo}:${a.importadoPor}:${a.linea}`.localeCompare(
      `${b.archivo}:${b.importadoPor}:${b.linea}`,
    ),
  );
}

/** Los problemas de la lista de permitidos: forma, repetidos, archivos que no existen o ya se mutan, o que no hacen falta. */
function problemasDeLaLista(datos: {
  lista: unknown;
  mutados: readonly string[];
  existe: (ruta: string) => boolean;
  necesarios: ReadonlySet<string>;
}): string[] {
  const { lista, mutados, existe, necesarios } = datos;
  if (!Array.isArray(lista)) return ["la lista de permitidos no es una lista"];
  const problemas: string[] = [];
  const vistos = new Set<string>();
  lista.forEach((elemento: unknown, indice) => {
    const e = elemento as Partial<Permitido> | null;
    const claves = typeof e === "object" && e !== null ? Object.keys(e).join() : "";
    if (claves !== "archivo,motivo") {
      problemas.push(`la entrada ${indice + 1} no es { archivo, motivo }`);
      return;
    }
    const { archivo, motivo } = e as Permitido;
    if (typeof archivo !== "string" || archivo.trim() === "") {
      problemas.push(`la entrada ${indice + 1} no nombra un archivo`);
      return;
    }
    if (typeof motivo !== "string" || motivo.trim() === "") {
      problemas.push(`${archivo}: no dice su motivo`);
    }
    if (vistos.has(archivo)) problemas.push(`${archivo}: está repetido`);
    vistos.add(archivo);
    if (!existe(archivo)) problemas.push(`${archivo}: no existe`);
    if (mutados.includes(archivo)) problemas.push(`${archivo}: ya está en mutate, sobra`);
    else if (!necesarios.has(archivo))
      problemas.push(`${archivo}: ningún archivo mutado lo importa, sobra`);
  });
  return problemas;
}

const leerReal = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");
const existeReal = (ruta: string) => existsSync(join(RAIZ, ruta));

/** El mundo de las pruebas con violación inyectada: archivos en memoria. */
function mundo(archivos: Record<string, string>, mutados: string[]) {
  return {
    mutados,
    leer: (ruta: string) => archivos[ruta] ?? "",
    existe: (ruta: string) => ruta in archivos,
  };
}

describe("el repositorio real", () => {
  const configuracion = JSON.parse(readFileSync(join(RAIZ, "stryker.config.json"), "utf8")) as {
    mutate: string[];
  };
  const mutados = expandir(configuracion.mutate.join(","), RAIZ).map(archivoDe);
  const lista = JSON.parse(
    readFileSync(join(RAIZ, "arquitectura/mutate-sin-mutar.json"), "utf8"),
  ) as unknown;
  const sinFiltrar = hermanosSinMutar({ mutados, leer: leerReal, existe: existeReal });
  const permitidos = new Set(((lista as Permitido[]) ?? []).map((p) => p.archivo));

  it("ningún archivo mutado importa un hermano que quede fuera de mutate (salvo los de la lista, con motivo)", () => {
    expect(sinFiltrar.filter((h) => !permitidos.has(h.archivo))).toEqual([]);
  });

  it("la lista de permitidos es una lista de { archivo, motivo } sin sobrantes", () => {
    expect(
      problemasDeLaLista({
        lista,
        mutados,
        existe: existeReal,
        necesarios: new Set(sinFiltrar.map((h) => h.archivo)),
      }),
    ).toEqual([]);
  });
});

describe("violaciones inyectadas: un hijo de una partición queda sin mutar", () => {
  const PADRE = "src/x/padre.ts";
  const HIJO = "src/x/hijo.ts";

  it("un import relativo al hermano que no está en mutate se reporta, con su línea", () => {
    const m = mundo(
      {
        [PADRE]: 'import { a } from "./hijo";\nexport const b = a;\n',
        [HIJO]: "export const a = 1;\n",
      },
      [PADRE],
    );
    expect(hermanosSinMutar(m)).toEqual([{ archivo: HIJO, importadoPor: PADRE, linea: 1 }]);
  });

  it("vale cualquier forma de importar: from con extensión, .js que apunta a .ts, require, import(), import de efecto", () => {
    for (const renglon of [
      'import { a } from "./hijo.ts";',
      'import { a } from "./hijo.js";',
      'import type { A } from "./hijo";',
      'export { a } from "./hijo";',
      'const { a } = require("./hijo.ts");',
      'const m = await import("./hijo");',
      'import "./hijo";',
      "import {\n  a,\n} from './hijo';",
    ]) {
      const m = mundo({ [PADRE]: `${renglon}\n`, [HIJO]: "export const a = 1;\n" }, [PADRE]);
      expect(
        hermanosSinMutar(m).map((h) => h.archivo),
        renglon,
      ).toEqual([HIJO]);
    }
    const cjs = mundo(
      {
        "src/x/p.cjs": 'const { a } = require("./h.cjs");\n',
        "src/x/h.cjs": "module.exports = {};\n",
      },
      ["src/x/p.cjs"],
    );
    expect(hermanosSinMutar(cjs).map((h) => h.archivo)).toEqual(["src/x/h.cjs"]);
    const tsx = mundo(
      { [PADRE]: 'import { A } from "./hijo";\n', "src/x/hijo.tsx": "export const A = 1;\n" },
      [PADRE],
    );
    expect(hermanosSinMutar(tsx).map((h) => h.archivo)).toEqual(["src/x/hijo.tsx"]);
  });

  it("se reporta cada importador y el orden es estable", () => {
    const m = mundo(
      {
        "src/x/b.ts": 'import { a } from "./hijo";\n',
        "src/x/a.ts": '\nimport { a } from "./hijo";\n',
        [HIJO]: "export const a = 1;\n",
      },
      ["src/x/b.ts", "src/x/a.ts"],
    );
    expect(hermanosSinMutar(m)).toEqual([
      { archivo: HIJO, importadoPor: "src/x/a.ts", linea: 2 },
      { archivo: HIJO, importadoPor: "src/x/b.ts", linea: 1 },
    ]);
  });

  it("no se reporta: el hijo ya está en mutate, está en otro directorio, no existe, es un JSON, una prueba o un .d.ts", () => {
    const base = { [PADRE]: "", [HIJO]: "export const a = 1;\n" };
    const sin = (renglon: string, extra: Record<string, string> = {}, mutados = [PADRE]) =>
      hermanosSinMutar(mundo({ ...base, ...extra, [PADRE]: `${renglon}\n` }, mutados));
    expect(sin('import { a } from "./hijo";', {}, [PADRE, HIJO])).toEqual([]);
    expect(sin('import { a } from "../y/otro";', { "src/y/otro.ts": "" })).toEqual([]);
    expect(sin('import { a } from "./no-existe";')).toEqual([]);
    expect(sin('import d from "./datos.json";', { "src/x/datos.json": "{}" })).toEqual([]);
    expect(sin('import { a } from "./hijo.test";', { "src/x/hijo.test.ts": "" })).toEqual([]);
    expect(sin('import { a } from "./tipos";', { "src/x/tipos.d.ts": "" })).toEqual([]);
    expect(sin('import { a } from "node:fs";')).toEqual([]);
    expect(sin('import { a } from "vitest";')).toEqual([]);
  });

  it("un comentario que menciona un import no cuenta", () => {
    for (const renglon of [
      '// import { a } from "./hijo";',
      '  * require("./hijo")',
      '/* from "./hijo" */',
    ]) {
      const m = mundo({ [PADRE]: `${renglon}\n`, [HIJO]: "" }, [PADRE]);
      expect(hermanosSinMutar(m), renglon).toEqual([]);
    }
  });
});

describe("violaciones inyectadas: la lista de permitidos no se vuelve un comodín", () => {
  const mutados = ["src/x/padre.ts"];
  const existe = (ruta: string) => ruta.startsWith("src/x/");
  const problemas = (lista: unknown, necesarios: string[] = ["src/x/hijo.ts"]) =>
    problemasDeLaLista({ lista, mutados, existe, necesarios: new Set(necesarios) });
  const OK = { archivo: "src/x/hijo.ts", motivo: "Es un tipo." };

  it("una entrada sana no tiene problemas", () => {
    expect(problemas([OK])).toEqual([]);
    expect(problemas([])).toEqual([]);
  });

  it("no es una lista, o una entrada no es { archivo, motivo } exacto", () => {
    expect(problemas({})).toEqual(["la lista de permitidos no es una lista"]);
    expect(problemas("x")).toEqual(["la lista de permitidos no es una lista"]);
    for (const mala of [
      null,
      5,
      "x",
      [],
      { archivo: "src/x/hijo.ts" },
      { ...OK, extra: 1 },
      { motivo: "m", archivo: "a" },
    ]) {
      expect(problemas([mala]), JSON.stringify(mala)).toEqual([
        "la entrada 1 no es { archivo, motivo }",
      ]);
    }
  });

  it("sin archivo o sin motivo", () => {
    expect(problemas([{ archivo: "  ", motivo: "m" }])).toEqual([
      "la entrada 1 no nombra un archivo",
    ]);
    expect(problemas([{ archivo: 7, motivo: "m" }])).toEqual(["la entrada 1 no nombra un archivo"]);
    for (const motivo of ["", "   ", 5, null]) {
      expect(problemas([{ archivo: "src/x/hijo.ts", motivo }])).toEqual([
        "src/x/hijo.ts: no dice su motivo",
      ]);
    }
  });

  it("repetido, inexistente, ya mutado o que ningún archivo mutado importa", () => {
    expect(problemas([OK, OK])).toEqual(["src/x/hijo.ts: está repetido"]);
    expect(problemas([{ ...OK, archivo: "src/z/hijo.ts" }], ["src/z/hijo.ts"])).toEqual([
      "src/z/hijo.ts: no existe",
    ]);
    expect(problemas([{ ...OK, archivo: "src/x/padre.ts" }])).toEqual([
      "src/x/padre.ts: ya está en mutate, sobra",
    ]);
    expect(problemas([OK], [])).toEqual(["src/x/hijo.ts: ningún archivo mutado lo importa, sobra"]);
  });
});
