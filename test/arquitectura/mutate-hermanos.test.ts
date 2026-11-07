import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, normalize } from "node:path";
import ts from "typescript";
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
 * `arquitectura/contratos/guardian.cjs`…). `planificar-mutacion.test.ts` ya falla si un archivo de `mutate` no está en
 * exactamente un grupo, pero NO ve lo inverso: al partir `clasificar.ts`, el archivo hijo queda sin `mutate` y sin grupo, sus
 * mutantes nunca corren y nada falla (hay 21 archivos grandes por partir).
 *
 * Qué comprueba (sobre el AST de TypeScript de cada archivo de `mutate`, no sobre el texto):
 *  1. todo archivo que un archivo mutado importa (`import`/`export … from`, `import x = require()`, `require("…")`,
 *     `import("…")`) y que está en su MISMO directorio o debajo de él (un hijo `./clasificar/x`) está en `mutate`, o figura en
 *     `arquitectura/mutate-sin-mutar.json` > `hermanosSinMutar` con su motivo;
 *  2. un `require`/`import()` con argumento que no es un texto literal en un archivo mutado FALLA (no se sabe qué carga), salvo
 *     `cargasNoEstaticas` con su motivo;
 *  3. un import relativo que no resuelve a un ARCHIVO (no existe, o es un directorio sin `index`) falla: ante la duda, falla;
 *  4. `mutate` no está vacío (con la lista vacía todo pasaría).
 * «Y en su grupo» lo exige `planificar-mutacion.test.ts` en cuanto el archivo entra a `mutate`.
 *
 * La lista de excepciones no puede crecer en silencio: su tamaño está fijado abajo (cambiarlo es editar esta prueba, con
 * revisión; el responsable figura en `.github/CODEOWNERS`) y cada motivo tiene que ser una frase real.
 *
 * LÍMITES CONOCIDOS (se dicen, no se esconden):
 *  - un hijo en el directorio PADRE o en otro directorio de un archivo mutado (`../x`) no se mira: un import entre módulos es lo
 *    habitual (barriles `publico.ts`, puertos, tipos) y mirarlos todos son 30 archivos sin relación con una partición;
 *  - un hijo que ningún archivo mutado importa (nadie lo usa o lo usa solo una prueba) no se ve;
 *  - solo se ven los especificadores relativos (`./`, `../`, `.`): un alias de ruta o un paquete no se resuelve.
 *  - solo se reconocen `require(...)`, `import(...)`, `import … from` y `export … from`; NO se ve una carga con otro nombre o forma:
 *    `createRequire(...)` (el `require` renombrado), `(0, require)("./x")`, `module.require(...)`, `import.meta.resolve(...)` ni
 *    `new URL("./x", import.meta.url)`;
 *  - lo que se descarta por el NOMBRE no se mira por dentro: un hijo llamado `x.json.ts` se toma por dato, un `x.test.ts` que no es
 *    una prueba se toma por prueba y un `.d.ts` con código ejecutable se toma por tipos;
 *  - un motivo de la lista solo prueba que es una frase (40 caracteres, 6 palabras): que tenga sentido lo mira quien revisa el
 *    cambio (el responsable de la lista figura en `.github/CODEOWNERS`).
 */

const RAIZ = join(import.meta.dirname, "../..");
const EXTENSIONES = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"] as const;
const ES_DATO = /\.(json|css|svg|sql|md|txt|xml|png|jpe?g|ico|woff2?)$/;
const NO_ES_CODIGO = /\.d\.ts$|\.test\.[cm]?[jt]sx?$/;

type Archivos = {
  /** El texto de un archivo mutado. */
  leer: (ruta: string) => string;
  /** Si `ruta` es un ARCHIVO (un directorio no cuenta). */
  esArchivo: (ruta: string) => boolean;
};
type Carga = { especificador: string | null; linea: number };
type Hermano = { archivo: string; importadoPor: string; linea: number };
type SinResolver = { importadoPor: string; linea: number; especificador: string };
type Resultado = {
  hermanos: Hermano[];
  noEstaticas: { archivo: string; linea: number }[];
  sinResolver: SinResolver[];
};
type Permitido = { archivo: string; motivo: string };
type Lista = { hermanosSinMutar: Permitido[]; cargasNoEstaticas: Permitido[] };

const posix = (ruta: string) => normalize(ruta).split("\\").join("/");

/** Cada carga de módulo de un archivo (import/export from, import = require, require(), import()), con su texto o `null`. */
function cargasDe(ruta: string, texto: string): Carga[] {
  const tipo = extname(ruta);
  const clase =
    tipo === ".tsx" || tipo === ".jsx"
      ? ts.ScriptKind.TSX
      : tipo === ".js" || tipo === ".cjs" || tipo === ".mjs"
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
  const fuente = ts.createSourceFile(ruta, texto, ts.ScriptTarget.Latest, true, clase);
  const cargas: Carga[] = [];
  const linea = (nodo: ts.Node) =>
    fuente.getLineAndCharacterOfPosition(nodo.getStart(fuente)).line + 1;
  const literal = (nodo: ts.Node | undefined): string | null =>
    nodo !== undefined && (ts.isStringLiteral(nodo) || ts.isNoSubstitutionTemplateLiteral(nodo))
      ? nodo.text
      : null;
  const recorrer = (nodo: ts.Node): void => {
    if (ts.isImportDeclaration(nodo) || ts.isExportDeclaration(nodo)) {
      if (nodo.moduleSpecifier !== undefined) {
        cargas.push({ especificador: literal(nodo.moduleSpecifier), linea: linea(nodo) });
      }
    } else if (
      ts.isImportEqualsDeclaration(nodo) &&
      ts.isExternalModuleReference(nodo.moduleReference)
    ) {
      cargas.push({ especificador: literal(nodo.moduleReference.expression), linea: linea(nodo) });
    } else if (ts.isCallExpression(nodo)) {
      const llama =
        (ts.isIdentifier(nodo.expression) && nodo.expression.text === "require") ||
        nodo.expression.kind === ts.SyntaxKind.ImportKeyword;
      if (llama) cargas.push({ especificador: literal(nodo.arguments[0]), linea: linea(nodo) });
    }
    ts.forEachChild(nodo, recorrer);
  };
  recorrer(fuente);
  return cargas;
}

/** A qué ARCHIVO apunta un especificador relativo de `desde` (probando todas las extensiones y el `index`), o `null`. */
function resolver(
  desde: string,
  especificador: string,
  esArchivo: (ruta: string) => boolean,
): string | null {
  const base = posix(join(dirname(desde), especificador));
  const sinJs = base.replace(/\.[cm]?jsx?$/, "");
  const candidatos = [
    ...((EXTENSIONES as readonly string[]).includes(extname(base)) ? [base] : []),
    ...[...new Set([base, sinJs])].flatMap((b) => EXTENSIONES.map((e) => `${b}${e}`)),
    ...EXTENSIONES.map((e) => posix(join(base, `index${e}`))),
    `${base}.d.ts`,
  ];
  return candidatos.find((candidato) => esArchivo(candidato)) ?? null;
}

/** Lo que un conjunto de archivos mutados carga y no está cubierto. */
function revisar(mutados: readonly string[], archivos: Archivos): Resultado {
  const enMutate = new Set(mutados);
  const resultado: Resultado = { hermanos: [], noEstaticas: [], sinResolver: [] };
  for (const origen of mutados) {
    for (const { especificador, linea } of cargasDe(origen, archivos.leer(origen))) {
      if (especificador === null) {
        resultado.noEstaticas.push({ archivo: origen, linea });
        continue;
      }
      if (!especificador.startsWith(".") || ES_DATO.test(especificador)) continue;
      const destino = resolver(origen, especificador, archivos.esArchivo);
      if (destino === null) {
        resultado.sinResolver.push({ importadoPor: origen, linea, especificador });
        continue;
      }
      if (NO_ES_CODIGO.test(destino) || ES_DATO.test(destino) || enMutate.has(destino)) continue;
      const carpeta = dirname(origen);
      const debajo = dirname(destino) === carpeta || destino.startsWith(`${carpeta}/`);
      if (debajo) resultado.hermanos.push({ archivo: destino, importadoPor: origen, linea });
    }
  }
  const orden = (a: string, b: string) => a.localeCompare(b);
  resultado.hermanos.sort((a, b) =>
    orden(`${a.archivo}:${a.importadoPor}:${a.linea}`, `${b.archivo}:${b.importadoPor}:${b.linea}`),
  );
  resultado.noEstaticas.sort((a, b) => orden(`${a.archivo}:${a.linea}`, `${b.archivo}:${b.linea}`));
  resultado.sinResolver.sort((a, b) =>
    orden(`${a.importadoPor}:${a.linea}`, `${b.importadoPor}:${b.linea}`),
  );
  return resultado;
}

/** Un motivo es una frase real: al menos 40 caracteres y 6 palabras (no «.», «x» ni «pendiente»). */
function motivoValido(motivo: unknown): boolean {
  if (typeof motivo !== "string") return false;
  const texto = motivo.trim();
  return texto.length >= 40 && texto.split(/\s+/).length >= 6;
}

/** Los problemas de la lista de excepciones: forma, motivos, archivos que no existen, que sobran o que ya se mutan. */
function problemasDeLaLista(datos: {
  lista: unknown;
  mutados: readonly string[];
  esArchivo: (ruta: string) => boolean;
  hermanosNecesarios: ReadonlySet<string>;
  cargasNecesarias: ReadonlySet<string>;
}): string[] {
  const { lista, mutados, esArchivo, hermanosNecesarios, cargasNecesarias } = datos;
  if (typeof lista !== "object" || lista === null || Array.isArray(lista)) {
    return ["la lista no es un objeto { hermanosSinMutar, cargasNoEstaticas }"];
  }
  if (Object.keys(lista).join() !== "hermanosSinMutar,cargasNoEstaticas") {
    return [
      "la lista tiene que ser exactamente { hermanosSinMutar, cargasNoEstaticas }, en ese orden",
    ];
  }
  const problemas: string[] = [];
  const completa = lista as Record<string, unknown>;
  for (const clave of ["hermanosSinMutar", "cargasNoEstaticas"] as const) {
    const entradas = completa[clave];
    if (!Array.isArray(entradas)) {
      problemas.push(`${clave}: no es una lista`);
      continue;
    }
    const vistos = new Set<string>();
    entradas.forEach((elemento: unknown, indice) => {
      const e = elemento as Partial<Permitido> | null;
      const claves = typeof e === "object" && e !== null ? Object.keys(e).join() : "";
      if (claves !== "archivo,motivo") {
        problemas.push(`${clave}: la entrada ${indice + 1} no es { archivo, motivo }`);
        return;
      }
      const { archivo, motivo } = e as Permitido;
      if (typeof archivo !== "string" || archivo.trim() === "") {
        problemas.push(`${clave}: la entrada ${indice + 1} no nombra un archivo`);
        return;
      }
      if (!motivoValido(motivo))
        problemas.push(
          `${archivo}: el motivo no es una frase real (40 caracteres y 6 palabras como mínimo)`,
        );
      if (vistos.has(archivo)) problemas.push(`${archivo}: está repetido`);
      vistos.add(archivo);
      if (!esArchivo(archivo)) problemas.push(`${archivo}: no es un archivo que exista`);
      if (clave === "hermanosSinMutar") {
        if (mutados.includes(archivo)) problemas.push(`${archivo}: ya está en mutate, sobra`);
        else if (!hermanosNecesarios.has(archivo))
          problemas.push(`${archivo}: ningún archivo mutado lo importa, sobra`);
      } else {
        if (!mutados.includes(archivo)) problemas.push(`${archivo}: no está en mutate, sobra`);
        else if (!cargasNecesarias.has(archivo))
          problemas.push(`${archivo}: no tiene una carga no estática, sobra`);
      }
    });
  }
  return problemas;
}

const problemasDeMutate = (mutados: readonly string[]): string[] =>
  mutados.length === 0
    ? ["`mutate` está vacío: sin archivos mutados el chequeo pasaría sin mirar nada"]
    : [];

const archivosReales: Archivos = {
  leer: (ruta) => readFileSync(join(RAIZ, ruta), "utf8"),
  esArchivo: (ruta) => existsSync(join(RAIZ, ruta)) && statSync(join(RAIZ, ruta)).isFile(),
};

/** Un mundo en memoria: los archivos y sus textos. Un directorio existe si algún archivo cuelga de él. */
function mundo(archivos: Record<string, string>): Archivos {
  return {
    leer: (ruta) => archivos[ruta] ?? "",
    esArchivo: (ruta) => ruta in archivos,
  };
}

describe("el repositorio real", () => {
  const configuracion = JSON.parse(readFileSync(join(RAIZ, "stryker.config.json"), "utf8")) as {
    mutate: string[];
  };
  const mutados = expandir(configuracion.mutate.join(","), RAIZ).map(archivoDe);
  const lista = JSON.parse(
    readFileSync(join(RAIZ, "arquitectura/mutate-sin-mutar.json"), "utf8"),
  ) as Lista;
  const resultado = revisar(mutados, archivosReales);
  const hermanos = new Set(resultado.hermanos.map((h) => h.archivo));
  const cargas = new Set(resultado.noEstaticas.map((c) => c.archivo));

  it("mutate no está vacío", () => {
    expect(problemasDeMutate(mutados)).toEqual([]);
  });

  it("ningún archivo mutado importa un hijo que quede fuera de mutate (salvo los de la lista, con motivo)", () => {
    const permitidos = new Set(lista.hermanosSinMutar.map((p) => p.archivo));
    expect(resultado.hermanos.filter((h) => !permitidos.has(h.archivo))).toEqual([]);
  });

  it("ningún archivo mutado carga un módulo que no sea un texto literal (salvo los de la lista, con motivo)", () => {
    const permitidos = new Set(lista.cargasNoEstaticas.map((p) => p.archivo));
    expect(resultado.noEstaticas.filter((c) => !permitidos.has(c.archivo))).toEqual([]);
  });

  it("todo import relativo de un archivo mutado resuelve a un archivo", () => {
    expect(resultado.sinResolver).toEqual([]);
  });

  it("la lista de excepciones es de la forma pedida, con motivos reales y sin sobrantes", () => {
    expect(
      problemasDeLaLista({
        lista,
        mutados,
        esArchivo: archivosReales.esArchivo,
        hermanosNecesarios: hermanos,
        cargasNecesarias: cargas,
      }),
    ).toEqual([]);
  });

  it("la lista no crece en silencio: 4 hermanos y 1 carga no estática (subirlo es editar esta prueba)", () => {
    expect(lista.hermanosSinMutar.map((p) => p.archivo)).toEqual([
      "arquitectura/contratos/contratos.cjs",
      "src/adaptadores/arca/tipos.ts",
      "src/adaptadores/postgres/migraciones.ts",
      "src/composicion/plataforma.ts",
    ]);
    expect(lista.cargasNoEstaticas.map((p) => p.archivo)).toEqual([
      "arquitectura/contratos/no-debilitar.cjs",
    ]);
  });
});

describe("violaciones inyectadas: qué cargas ve (AST)", () => {
  const PADRE = "src/x/padre.ts";
  const HIJO = "src/x/hijo.ts";
  const con = (texto: string, extra: Record<string, string> = {}, mutados: string[] = [PADRE]) =>
    revisar(mutados, mundo({ [PADRE]: texto, [HIJO]: "export const a = 1;\n", ...extra }));
  const hijos = (texto: string, extra: Record<string, string> = {}) =>
    con(texto, extra).hermanos.map((h) => `${h.archivo}@${h.linea}`);

  it("un import relativo al hijo que no está en mutate se reporta, con su línea", () => {
    expect(con('import { a } from "./hijo";\nexport const b = a;\n').hermanos).toEqual([
      { archivo: HIJO, importadoPor: PADRE, linea: 1 },
    ]);
  });

  it("cada forma de cargar un módulo", () => {
    for (const texto of [
      'import { a } from "./hijo";',
      'import { a } from "./hijo.ts";',
      'import { a } from "./hijo.js";',
      'import type { A } from "./hijo";',
      'export { a } from "./hijo";',
      'export * from "./hijo";',
      'import hijo = require("./hijo");',
      'const { a } = require("./hijo.ts");',
      'const m = await import("./hijo");',
      "const m = await import(`./hijo`);",
      'import "./hijo";',
      "import {\n  a,\n} from\n  './hijo';",
    ]) {
      expect(hijos(`${texto}\n`), texto).toEqual([`${HIJO}@1`]);
    }
  });

  it("dos imports en la misma línea, un import con comentarios al lado y el especificador en otra línea", () => {
    const extra = { "src/x/otro.ts": "export const o = 1;\n" };
    expect(
      con('import { a } from "./hijo"; import { o } from "./otro";\n', extra).hermanos.map(
        (h) => h.archivo,
      ),
    ).toEqual([HIJO, "src/x/otro.ts"]);
    expect(hijos('import { a } from "./hijo"; // el hijo\n')).toEqual([`${HIJO}@1`]);
    expect(hijos('import /* x */ { a } from /* y */ "./hijo";\n')).toEqual([`${HIJO}@1`]);
    expect(hijos('\n\nimport {\n  a }\n  from\n"./hijo";\n')).toEqual([`${HIJO}@3`]);
  });

  it("un comentario o un texto que menciona un import no cuenta", () => {
    for (const texto of [
      '// import { a } from "./hijo";',
      '/* require("./hijo") */',
      '/**\n * import("./hijo")\n */',
      "const t = 'import { a } from \"./hijo\"';",
      'const t = `require("./hijo")`;',
    ]) {
      expect(con(`${texto}\n`).hermanos, texto).toEqual([]);
    }
  });

  it("todas las extensiones y el barril con directorio", () => {
    for (const extension of [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]) {
      const hijo = `src/x/hijo${extension}`;
      expect(
        revisar(
          [PADRE],
          mundo({ [PADRE]: 'import { a } from "./hijo";\n', [hijo]: "" }),
        ).hermanos.map((h) => h.archivo),
        extension,
      ).toEqual([hijo]);
    }
    expect(hijos('import { a } from "./sub";\n', { "src/x/sub/index.ts": "" })).toEqual([
      "src/x/sub/index.ts@1",
    ]);
    expect(hijos('import { a } from "./sub/";\n', { "src/x/sub/index.tsx": "" })).toEqual([
      "src/x/sub/index.tsx@1",
    ]);
    expect(hijos('import { a } from ".";\n', { "src/x/index.ts": "" })).toEqual([
      "src/x/index.ts@1",
    ]);
    expect(hijos('import { a } from "./";\n', { "src/x/index.ts": "" })).toEqual([
      "src/x/index.ts@1",
    ]);
  });

  it("un hijo en un subdirectorio del archivo mutado se reporta; en el padre o en otro directorio, no (límite conocido)", () => {
    expect(hijos('import { a } from "./padre/hijo";\n', { "src/x/padre/hijo.ts": "" })).toEqual([
      "src/x/padre/hijo.ts@1",
    ]);
    expect(hijos('import { a } from "../otro";\n', { "src/otro.ts": "" })).toEqual([]);
    expect(hijos('import { a } from "../y/otro";\n', { "src/y/otro.ts": "" })).toEqual([]);
    expect(hijos('import { a } from "../qr";\n', { "src/qr/index.ts": "" })).toEqual([]);
    expect(hijos('import { a } from "../x/hijo";\n')).toEqual([`${HIJO}@1`]);
  });

  it("no se reporta: el hijo ya está en mutate, es una prueba, un .d.ts, un dato o un paquete", () => {
    const base = { "src/x/hijo.test.ts": "", "src/x/tipos.d.ts": "", "src/x/datos.json": "{}" };
    expect(con('import { a } from "./hijo";\n', {}, [PADRE, HIJO]).hermanos).toEqual([]);
    for (const texto of [
      'import { a } from "./hijo.test";',
      'import { a } from "./tipos";',
      'import d from "./datos.json";',
      'import { a } from "node:fs";',
      'import { a } from "vitest";',
      'import { a } from "@/algo";',
    ]) {
      expect(con(`${texto}\n`, base).hermanos, texto).toEqual([]);
      expect(con(`${texto}\n`, base).sinResolver, texto).toEqual([]);
    }
  });
});

describe("violaciones inyectadas: cargas no estáticas y especificadores que no resuelven", () => {
  const PADRE = "src/x/padre.ts";
  const con = (texto: string, extra: Record<string, string> = {}) =>
    revisar([PADRE], mundo({ [PADRE]: texto, "src/x/hijo.ts": "", ...extra }));

  it("un require o import() cuyo argumento no es un literal falla, con su línea", () => {
    for (const texto of [
      "const m = require(ruta);",
      'const m = require("./" + nombre);',
      "const m = require(`./${nombre}`);",
      "const m = await import(ruta);",
      "const m = await import(`./${nombre}`);",
      "const m = require();",
    ]) {
      expect(con(`\n${texto}\n`).noEstaticas, texto).toEqual([{ archivo: PADRE, linea: 2 }]);
    }
    expect(con('const m = require("./hijo");\n').noEstaticas).toEqual([]);
    expect(con("const m = require(`./hijo`);\n").noEstaticas).toEqual([]);
    expect(con("const f = other.require(ruta);\n").noEstaticas).toEqual([]);
  });

  it("un import relativo que no resuelve a un archivo falla: no existe, o es un directorio sin index", () => {
    expect(con('import { a } from "./no-existe";\n').sinResolver).toEqual([
      { importadoPor: PADRE, linea: 1, especificador: "./no-existe" },
    ]);
    expect(con('import { a } from "./sub";\n', { "src/x/sub/dato.ts": "" }).sinResolver).toEqual([
      { importadoPor: PADRE, linea: 1, especificador: "./sub" },
    ]);
    expect(con('import { a } from "./hijo";\n').sinResolver).toEqual([]);
  });

  it("mutate vacío falla", () => {
    expect(problemasDeMutate([])).toEqual([
      "`mutate` está vacío: sin archivos mutados el chequeo pasaría sin mirar nada",
    ]);
    expect(problemasDeMutate(["a.ts"])).toEqual([]);
  });
});

describe("violaciones inyectadas: la lista de excepciones no se vuelve un comodín", () => {
  const mutados = ["src/x/padre.ts", "src/x/carga.ts"];
  const ARCHIVOS = new Set(["src/x/padre.ts", "src/x/carga.ts", "src/x/hijo.ts"]);
  const esArchivo = (ruta: string) => ARCHIVOS.has(ruta);
  const MOTIVO = "Es solo un tipo, sin código ejecutable que mutar en este archivo.";
  const OK: Lista = {
    hermanosSinMutar: [{ archivo: "src/x/hijo.ts", motivo: MOTIVO }],
    cargasNoEstaticas: [{ archivo: "src/x/carga.ts", motivo: MOTIVO }],
  };
  const problemas = (
    lista: unknown,
    hermanos: string[] = ["src/x/hijo.ts"],
    cargas: string[] = ["src/x/carga.ts"],
  ) =>
    problemasDeLaLista({
      lista,
      mutados,
      esArchivo,
      hermanosNecesarios: new Set(hermanos),
      cargasNecesarias: new Set(cargas),
    });
  const con = (cambios: Partial<Lista>) => ({ ...OK, ...cambios });

  it("una lista sana no tiene problemas, ni una vacía", () => {
    expect(problemas(OK)).toEqual([]);
    expect(problemas({ hermanosSinMutar: [], cargasNoEstaticas: [] }, [], [])).toEqual([]);
  });

  it("no es el objeto pedido: tipo, claves o su orden", () => {
    for (const mala of [[], "x", null, 5]) {
      expect(problemas(mala)).toEqual([
        "la lista no es un objeto { hermanosSinMutar, cargasNoEstaticas }",
      ]);
    }
    for (const mala of [
      {},
      { hermanosSinMutar: [] },
      { cargasNoEstaticas: [], hermanosSinMutar: [] },
      { ...OK, extra: [] },
    ]) {
      expect(problemas(mala)).toEqual([
        "la lista tiene que ser exactamente { hermanosSinMutar, cargasNoEstaticas }, en ese orden",
      ]);
    }
    expect(problemas({ hermanosSinMutar: {}, cargasNoEstaticas: [] }, [], [])).toEqual([
      "hermanosSinMutar: no es una lista",
    ]);
  });

  it("una entrada que no es { archivo, motivo } exacto, o sin archivo", () => {
    for (const mala of [
      null,
      5,
      "x",
      [],
      { archivo: "src/x/hijo.ts" },
      { ...OK.hermanosSinMutar[0], extra: 1 },
      { motivo: MOTIVO, archivo: "src/x/hijo.ts" },
    ]) {
      expect(
        problemas(con({ hermanosSinMutar: [mala as Permitido] })),
        JSON.stringify(mala),
      ).toEqual(["hermanosSinMutar: la entrada 1 no es { archivo, motivo }"]);
    }
    for (const archivo of ["  ", 7]) {
      expect(
        problemas(
          con({ hermanosSinMutar: [{ archivo, motivo: MOTIVO } as unknown as Permitido] }),
          [],
        ),
      ).toEqual(["hermanosSinMutar: la entrada 1 no nombra un archivo"]);
    }
  });

  it("motivos basura: vacío, corto, un punto, una letra, pocas palabras o no es texto", () => {
    for (const motivo of [
      "",
      "   ",
      ".",
      "x",
      "pendiente",
      "queda pendiente de revisar luego",
      "palabra".repeat(10),
      5,
      null,
    ]) {
      expect(
        problemas(
          con({ hermanosSinMutar: [{ archivo: "src/x/hijo.ts", motivo } as unknown as Permitido] }),
        ),
        String(motivo),
      ).toEqual([
        "src/x/hijo.ts: el motivo no es una frase real (40 caracteres y 6 palabras como mínimo)",
      ]);
    }
    const justo = "uno dos tres cuatro cinco seis siete ocho nueve diez once";
    expect(justo.length).toBeGreaterThanOrEqual(40);
    expect(
      problemas(con({ hermanosSinMutar: [{ archivo: "src/x/hijo.ts", motivo: justo }] })),
    ).toEqual([]);
    const treinta = "a b c d e f g h i j k l m n o p"; // 16 palabras, 31 caracteres
    expect(
      problemas(con({ hermanosSinMutar: [{ archivo: "src/x/hijo.ts", motivo: treinta }] })),
    ).toHaveLength(1);
  });

  it("repetido, que no es un archivo (un directorio no vale), ya mutado, o que ningún archivo mutado necesita", () => {
    const hijo = OK.hermanosSinMutar[0] as Permitido;
    expect(problemas(con({ hermanosSinMutar: [hijo, hijo] }))).toEqual([
      "src/x/hijo.ts: está repetido",
    ]);
    expect(
      problemas(con({ hermanosSinMutar: [{ archivo: "src/x", motivo: MOTIVO }] }), ["src/x"]),
    ).toEqual(["src/x: no es un archivo que exista"]);
    expect(
      problemas(con({ hermanosSinMutar: [{ archivo: "src/x/otro.ts", motivo: MOTIVO }] }), [
        "src/x/otro.ts",
      ]),
    ).toEqual(["src/x/otro.ts: no es un archivo que exista"]);
    expect(
      problemas(con({ hermanosSinMutar: [{ archivo: "src/x/padre.ts", motivo: MOTIVO }] }), [
        "src/x/padre.ts",
      ]),
    ).toEqual(["src/x/padre.ts: ya está en mutate, sobra"]);
    expect(problemas(OK, [])).toEqual(["src/x/hijo.ts: ningún archivo mutado lo importa, sobra"]);
  });

  it("una carga no estática: tiene que estar en mutate y tener de verdad esa carga", () => {
    expect(problemas(OK, ["src/x/hijo.ts"], [])).toEqual([
      "src/x/carga.ts: no tiene una carga no estática, sobra",
    ]);
    expect(
      problemas(
        con({ cargasNoEstaticas: [{ archivo: "src/x/hijo.ts", motivo: MOTIVO }] }),
        ["src/x/hijo.ts"],
        ["src/x/hijo.ts"],
      ),
    ).toEqual(["src/x/hijo.ts: no está en mutate, sobra"]);
    expect(
      problemas(con({ cargasNoEstaticas: [{ archivo: "src/x/carga.ts", motivo: "." }] })),
    ).toEqual([
      "src/x/carga.ts: el motivo no es una frase real (40 caracteres y 6 palabras como mínimo)",
    ]);
  });
});
