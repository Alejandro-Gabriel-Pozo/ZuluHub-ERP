import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * REGLA (dueño, 18/11/2026, ADR-008 opción b): nadie escribe el literal `"BLOQUEAR"` como nivel de control. Empresas y sucursales eligen solo entre
 * `PERMITIR` y `AVISAR`; el sistema mantiene bloqueos fijos solo por integridad del dinero y esos NO son un nivel ni se declaran como control.
 * Previene: que vuelva a aparecer un bloqueo configurable (un nivel, una comparación, una rama de un `switch` o una lista con `"BLOQUEAR"`) sin que el dueño lo decida.
 * Mira `src/` y `apps/`, sin los archivos de prueba (`*.test.*`: usan el literal para probar que ya no vale). Cuenta cualquier texto (comillas simples, dobles o
 * plantilla sin sustituciones) y cualquier identificador que se llame exactamente `BLOQUEAR`, en tipos y en valores.
 * Límites que NO ve (el CHECK de la base es la cerradura real, `migraciones/0086`): las migraciones y los textos SQL fuera de `src/` y `apps/`, las pruebas de integración y
 * `test/`, un literal armado a mano (`"BLOQUEA" + "R"`, `String.fromCharCode`), y un valor que llega de la base o de un JSON. Cada forma que sí ve está inyectada abajo.
 */

const RAIZ = join(import.meta.dirname, "../..");
const PROHIBIDO = "BLOQUEAR";

const esDePrueba = (ruta: string): boolean => /\.test\.(ts|tsx)$/.test(ruta);

/** Dónde aparece el literal en un archivo (la parte pura de la regla). */
function apariciones(nombre: string, texto: string): string[] {
  const fuente = ts.createSourceFile(
    nombre,
    texto,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const usos: string[] = [];
  const mirar = (nodo: ts.Node): void => {
    const nombrado =
      ts.isStringLiteralLike(nodo) || ts.isIdentifier(nodo) || ts.isPrivateIdentifier(nodo)
        ? nodo.text
        : null;
    if (nombrado === PROHIBIDO) {
      const linea = fuente.getLineAndCharacterOfPosition(nodo.getStart(fuente)).line + 1;
      usos.push(`${nombre}:${linea}`);
    }
    ts.forEachChild(nodo, mirar);
  };
  mirar(fuente);
  return usos;
}

function archivosDe(carpeta: string): string[] {
  const archivos: string[] = [];
  const recorrer = (actual: string): void => {
    for (const entrada of readdirSync(actual, { withFileTypes: true })) {
      if (["node_modules", ".next", "test-results", "playwright-report"].includes(entrada.name)) {
        continue;
      }
      const completa = join(actual, entrada.name);
      if (entrada.isDirectory()) recorrer(completa);
      else if (/\.(ts|tsx)$/.test(entrada.name) && !entrada.name.endsWith(".d.ts")) {
        archivos.push(completa);
      }
    }
  };
  recorrer(carpeta);
  return archivos;
}

const problemasDe = (archivos: Readonly<Record<string, string>>): string[] =>
  Object.entries(archivos)
    .filter(([ruta]) => (ruta.startsWith("src/") || ruta.startsWith("apps/")) && !esDePrueba(ruta))
    .flatMap(([ruta, texto]) => apariciones(ruta, texto));

describe("ningún archivo de src/ ni de apps/ escribe «BLOQUEAR» como nivel de control", () => {
  // Tope propio (estabilidad bajo carga, 23/11/2026): recorre y lee todo `apps/` y `src/`; 1,8 s medidos solo, y con la máquina cargada (CI con Postgres al lado, varios archivos a la vez) llegó a 6,5 s y vencía los 5 s por defecto.
  it(
    "el repositorio real lo cumple, y la prueba recorre archivos de las dos carpetas",
    { timeout: 30_000 },
    () => {
      const archivos: Record<string, string> = {};
      for (const carpeta of ["apps", "src"]) {
        for (const ruta of archivosDe(join(RAIZ, carpeta))) {
          archivos[relative(RAIZ, ruta)] = readFileSync(ruta, "utf8");
        }
      }
      expect(Object.keys(archivos).filter((r) => r.startsWith("apps/")).length).toBeGreaterThan(50);
      expect(Object.keys(archivos).filter((r) => r.startsWith("src/")).length).toBeGreaterThan(500);
      // Los niveles reales existen en el código (no es una búsqueda vacía).
      expect(archivos["src/capacidades/controles/nivel.ts"]).toContain('"AVISAR"');
      expect(problemasDe(archivos)).toEqual([]);
    },
  );

  const inyectada = (texto: string, ruta = "src/modulos/stock/dominio/x.ts"): string[] =>
    problemasDe({ [ruta]: texto });

  it("detecta el literal en un tipo, una lista, una comparación, un case y un texto de plantilla", () => {
    expect(inyectada('export type N = "PERMITIR" | "AVISAR" | "BLOQUEAR";')).toHaveLength(1);
    expect(
      inyectada('export const NIVELES = ["PERMITIR", "AVISAR", "BLOQUEAR"] as const;'),
    ).toHaveLength(1);
    expect(inyectada('if (nivel === "BLOQUEAR") throw new Error("x");')).toHaveLength(1);
    expect(inyectada('switch (n) { case "BLOQUEAR": break; }')).toHaveLength(1);
    expect(inyectada("const n = `BLOQUEAR`;")).toHaveLength(1);
    expect(inyectada("const n = 'BLOQUEAR';")).toHaveLength(1);
  });

  it("detecta un identificador con ese nombre y también en apps/ (tsx)", () => {
    expect(inyectada("const BLOQUEAR = 3; export { BLOQUEAR };")).toHaveLength(2);
    expect(
      inyectada('const x = <option value="BLOQUEAR">b</option>;', "apps/web/ui/x.tsx"),
    ).toHaveLength(1);
  });

  it("no marca otras palabras parecidas ni los comentarios, y no mira las pruebas ni otras carpetas", () => {
    expect(inyectada('const a = "BLOQUEA"; const b = "BLOQUEADA"; const c = "bloquear";')).toEqual(
      [],
    );
    expect(inyectada('// nivel "BLOQUEAR" ya no existe\nexport const ok = 1;')).toEqual([]);
    expect(inyectada('const n = "BLOQUEAR";', "src/capacidades/controles/nivel.test.ts")).toEqual(
      [],
    );
    expect(inyectada('const n = "BLOQUEAR";', "test/integracion/x.ts")).toEqual([]);
  });
});
