import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * REGLA: ningún archivo de `apps/` o `src/` que no sea una prueba importa de `test/` (carta real, T5, `carta-real-especificacion.md` §5). Previene: el caso real de
 * `apps/web/servidor/vidriera-publica-falsa.ts`, que importaba `test/fixtures/vidrieras` desde código de producción: los datos inventados viajaban dentro del paquete que se
 * despliega y la web servía una carta de ejemplo en lugar de la real. Cubre `import`, `export … from`, `import()` y `require()` con una ruta relativa o con la carpeta `test/` nombrada.
 * Una prueba (`*.test.ts`, `*.test.tsx`, `*.recorrido.ts`) sí puede importar de `test/`. Cada forma está inyectada abajo: si se debilita el analizador, la prueba falla.
 */
const RAIZ = join(import.meta.dirname, "../..");
const CARPETA_DE_TEST = join(RAIZ, "test") + sep;

const esDePrueba = (ruta: string): boolean => /\.(test\.tsx?|recorrido\.ts)$/.test(ruta);

/** Las rutas de los módulos que un archivo importa y que caen dentro de `test/`. */
export function importacionesDeTest(rutaDelArchivo: string, texto: string): string[] {
  const fuente = ts.createSourceFile(
    rutaDelArchivo,
    texto,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const halladas: string[] = [];
  const mirarRuta = (especificador: string): void => {
    const destino = especificador.startsWith(".")
      ? resolve(dirname(rutaDelArchivo), especificador)
      : resolve(RAIZ, especificador);
    if (destino === join(RAIZ, "test") || destino.startsWith(CARPETA_DE_TEST))
      halladas.push(especificador);
  };
  const mirar = (nodo: ts.Node): void => {
    if (
      (ts.isImportDeclaration(nodo) || ts.isExportDeclaration(nodo)) &&
      nodo.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(nodo.moduleSpecifier)
    )
      mirarRuta(nodo.moduleSpecifier.text);
    if (ts.isCallExpression(nodo)) {
      const [primero] = nodo.arguments;
      const esImportDinamico = nodo.expression.kind === ts.SyntaxKind.ImportKeyword;
      const esRequire = ts.isIdentifier(nodo.expression) && nodo.expression.text === "require";
      if (
        (esImportDinamico || esRequire) &&
        primero !== undefined &&
        ts.isStringLiteralLike(primero)
      )
        mirarRuta(primero.text);
    }
    if (
      ts.isImportTypeNode(nodo) &&
      ts.isLiteralTypeNode(nodo.argument) &&
      ts.isStringLiteral(nodo.argument.literal)
    )
      mirarRuta(nodo.argument.literal.text);
    ts.forEachChild(nodo, mirar);
  };
  mirar(fuente);
  return halladas;
}

function archivosDe(carpeta: string): string[] {
  const salida: string[] = [];
  for (const e of readdirSync(carpeta, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next" || e.name === ".stryker-tmp") continue;
    const ruta = join(carpeta, e.name);
    if (e.isDirectory()) salida.push(...archivosDe(ruta));
    else if (/\.(ts|tsx|cjs|mjs|js)$/.test(e.name)) salida.push(ruta);
  }
  return salida;
}

describe("nada de producción importa de test/", () => {
  it("ningún archivo de apps/ o src/ que no es una prueba importa de test/", () => {
    const sospechosos = [...archivosDe(join(RAIZ, "apps")), ...archivosDe(join(RAIZ, "src"))]
      .filter((ruta) => !esDePrueba(ruta))
      .flatMap((ruta) =>
        importacionesDeTest(ruta, readFileSync(ruta, "utf8")).map(
          (i) => `${relative(RAIZ, ruta)}: ${i}`,
        ),
      );
    expect(sospechosos).toEqual([]);
  });

  describe("el analizador ve cada forma (violaciones inyectadas)", () => {
    const desde = join(RAIZ, "apps/web/servidor/x.ts");
    const casos: readonly (readonly [string, string, readonly string[]])[] = [
      [
        "import relativo",
        'import { a } from "../../../test/fixtures/vidrieras";',
        ["../../../test/fixtures/vidrieras"],
      ],
      [
        "import de tipo",
        'import type { A } from "../../../test/utilidades/x";',
        ["../../../test/utilidades/x"],
      ],
      [
        "reexportación",
        'export { a } from "../../../test/utilidades/x";',
        ["../../../test/utilidades/x"],
      ],
      [
        "import dinámico",
        'const m = await import("../../../test/fixtures/x");',
        ["../../../test/fixtures/x"],
      ],
      ["require", 'const m = require("../../../test/fixtures/x");', ["../../../test/fixtures/x"]],
      [
        "tipo importado en línea",
        'type T = import("../../../test/utilidades/x").A;',
        ["../../../test/utilidades/x"],
      ],
      ["la carpeta test misma", 'import x from "../../../test";', ["../../../test"]],
      ["nombrada desde la raíz", 'import x from "test/fixtures/x";', ["test/fixtures/x"]],
    ];
    it.each(casos)("%s", (_nombre, texto, esperado) => {
      expect(importacionesDeTest(desde, texto)).toEqual(esperado);
    });

    it("lo que no es de test/ no cuenta (otra carpeta, un paquete, una ruta que solo se parece)", () => {
      const limpio = [
        'import { a } from "../../../src/puertos/x";',
        'import b from "zod";',
        'import c from "./testigo";',
        'import d from "../../../tests-de-otra-cosa/x";',
        'import e from "../test-apoyo";',
        "const dinamica = await import(ruta);",
      ].join("\n");
      expect(importacionesDeTest(desde, limpio)).toEqual([]);
    });
  });
});
