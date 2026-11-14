import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * REGLA: en las pruebas de integración, todo valor ÚNICO sale del generador común (`test/integracion/unicos.ts`); está prohibido sortearlo. Previene la clase de falla «dato
 * único elegido al azar que choca»: `empresa_cuit_uk` en «Estabilidad» (#191 y #305, cuerpos consecutivos 41458321 y 41458322), porque los archivos de una corrida comparten una
 * base y un sorteo (o un contador que arranca al azar) puede repetirse. Prohibido: `Math.random`, `randomInt` y cualquier `getRandomValues`; `randomUUID()` TRUNCADO
 * (`.slice`, `.substring`, `.substr`: 16 a 48 bits ya chocan); y `randomBytes(n)` con `n` menor que 8 (menos de 64 bits). Sí se permite lo que no es un valor único
 * de la base: un `randomUUID()` entero (122 bits), `randomBytes` de 8 o más, claves y secretos. Los usos legítimos que sobreviven (esperas con variación, fuzz, el formato de
 * una referencia de error) están en una lista EXACTA con motivo y cuenta exacta: crecer es editar esta prueba. Cada forma está inyectada abajo.
 *
 * LÍMITES que NO ve (es una alarma para errores honestos): un valor único armado de otra manera (por ejemplo, `Date.now()` o un contador propio de un archivo),
 * una función propia que envuelva `Math.random`, y las pruebas fuera de `test/integracion/` (las que no comparten la base).
 */
const RAIZ = join(import.meta.dirname, "../..");
const CARPETA = join(RAIZ, "test/integracion");
const GENERADOR = join(CARPETA, "unicos.ts");

export type UsoDebil = Readonly<{ uso: string; linea: number }>;

const MODULOS_DE_CRYPTO = new Set(["node:crypto", "crypto"]);
const SLICES = new Set(["slice", "substring", "substr"]);

/** Los usos prohibidos de azar para valores únicos en el texto de un archivo. */
export function usosDebilesDeUnicidad(ruta: string, texto: string): UsoDebil[] {
  const fuente = ts.createSourceFile(ruta, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const hallados: UsoDebil[] = [];
  // Los nombres locales con que se importó cada función de crypto (alias incluidos).
  const locales = new Map<string, string>();
  const linea = (n: ts.Node) => fuente.getLineAndCharacterOfPosition(n.getStart(fuente)).line + 1;
  const anotar = (uso: string, n: ts.Node) => hallados.push({ uso, linea: linea(n) });

  for (const s of fuente.statements) {
    if (
      ts.isImportDeclaration(s) &&
      ts.isStringLiteral(s.moduleSpecifier) &&
      MODULOS_DE_CRYPTO.has(s.moduleSpecifier.text) &&
      s.importClause?.namedBindings !== undefined &&
      ts.isNamedImports(s.importClause.namedBindings)
    ) {
      for (const e of s.importClause.namedBindings.elements) {
        locales.set(e.name.text, (e.propertyName ?? e.name).text);
      }
    }
  }
  /** ¿Es una referencia a `Math.random` (con punto o con corchetes)? */
  const esMathRandom = (n: ts.Node): boolean =>
    (ts.isPropertyAccessExpression(n) &&
      n.name.text === "random" &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === "Math") ||
    (ts.isElementAccessExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === "Math" &&
      ts.isStringLiteralLike(n.argumentExpression) &&
      n.argumentExpression.text === "random");
  /** El nombre de la función de crypto que se llama: `randomInt(…)`, alias `ri(…)` o `crypto.randomInt(…)`. */
  const nombreDeCrypto = (llamada: ts.CallExpression): string | undefined => {
    const e = llamada.expression;
    if (ts.isIdentifier(e)) return locales.get(e.text);
    if (ts.isPropertyAccessExpression(e)) return e.name.text;
    return undefined;
  };
  /** ¿El resultado de esta expresión pasa por un `.slice(…)`/`.substring(…)`/`.substr(…)` más arriba (tras `.replaceAll`, `.toString`…)? */
  const seTrunca = (n: ts.Node): boolean => {
    let actual: ts.Node = n;
    for (;;) {
      const padre = actual.parent;
      if (ts.isPropertyAccessExpression(padre) && padre.expression === actual) {
        if (SLICES.has(padre.name.text)) return true;
        actual = padre.parent; // la llamada `.metodo(…)`
        continue;
      }
      if (ts.isCallExpression(padre) && padre.expression === actual) {
        actual = padre;
        continue;
      }
      return false;
    }
  };
  const mirar = (n: ts.Node): void => {
    if (esMathRandom(n)) anotar("Math.random", n);
    if (ts.isCallExpression(n)) {
      const nombre = nombreDeCrypto(n);
      if (nombre === "randomInt") anotar("randomInt", n);
      else if (nombre === "getRandomValues") anotar("getRandomValues", n);
      else if (nombre === "randomUUID" && seTrunca(n)) anotar("randomUUID truncado", n);
      else if (nombre === "randomBytes") {
        const arg = n.arguments[0];
        if (arg !== undefined && ts.isNumericLiteral(arg) && Number(arg.text) < 8) {
          anotar("randomBytes de menos de 8 bytes", n);
        }
      }
    }
    // `const { random } = Math`: desestructurar el azar para esquivar la búsqueda.
    if (
      ts.isVariableDeclaration(n) &&
      ts.isObjectBindingPattern(n.name) &&
      n.initializer !== undefined &&
      ts.isIdentifier(n.initializer) &&
      n.initializer.text === "Math" &&
      n.name.elements.some((e) => (e.propertyName ?? e.name).getText(fuente) === "random")
    ) {
      anotar("Math.random (desestructurado)", n);
    }
    ts.forEachChild(n, mirar);
  };
  mirar(fuente);
  return hallados;
}

const archivos = (carpeta: string): string[] =>
  readdirSync(carpeta).flatMap((nombre) => {
    const ruta = join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) return archivos(ruta);
    return ruta.endsWith(".ts") ? [ruta] : [];
  });

/** Los usos que sobreviven a propósito: lo que NO es un valor único de la base. Archivo → cuántos y por qué. */
const PERMITIDOS: Readonly<Record<string, Readonly<{ usos: number; motivo: string }>>> = {
  "facturacion-concurrencia.test.ts": {
    usos: 1,
    motivo:
      "Una espera con variación (5 a 20 ms) para que los hilos de la ronda se entrelacen distinto: no es un valor único.",
  },
  "facturacion-persistencia-concurrencia.test.ts": {
    usos: 1,
    motivo:
      "Una espera con variación (2 a 8 ms) para entrelazar la concurrencia: no es un valor único.",
  },
  "fiscal-concurrencia.test.ts": {
    usos: 3,
    motivo:
      "Esperas con variación y el sorteo de una falla simulada («suerte») en la prueba de concurrencia: no son valores únicos.",
  },
  "catalogo.test.ts": {
    usos: 4,
    motivo:
      "Fuzz de textos de dígitos para probar la validación del CUIT del catálogo (largo y cifras al azar): son entradas a validar, no valores únicos de la base.",
  },
  "dominios-apoyo.ts": {
    usos: 1,
    motivo:
      "El azar que se le INYECTA al caso de uso de referencias de error: la unicidad la garantiza la restricción de la base con reintento (`registrar-referencia.ts`), no el sorteo.",
  },
  "soporte-apoyo.ts": {
    usos: 1,
    motivo:
      "El mismo azar inyectado al caso de uso de referencias de error (unicidad por restricción de la base con reintento).",
  },
  "referencias-de-error.test.ts": {
    usos: 2,
    motivo:
      "Prueba el FORMATO de la referencia de error (PD-XXXX-XXXX) con dos mitades al azar: no tiene restricción de unicidad.",
  },
};

describe("ids únicos: todo valor único de la integración sale del generador común", () => {
  const propios = archivos(CARPETA).filter((r) => r !== GENERADOR);

  it("nadie sortea un valor único: solo queda lo permitido, con su cuenta exacta", () => {
    const porArchivo = new Map<string, UsoDebil[]>();
    for (const ruta of propios) {
      const usos = usosDebilesDeUnicidad(ruta, readFileSync(ruta, "utf8"));
      if (usos.length > 0) porArchivo.set(relative(CARPETA, ruta), usos);
    }
    const sobran = [...porArchivo.entries()]
      .map(([archivo, usos]) => ({
        archivo,
        usos: usos.length > (PERMITIDOS[archivo]?.usos ?? 0) ? usos : [],
      }))
      .filter((x) => x.usos.length > 0);
    expect(
      sobran,
      "usos prohibidos (usá `cuitUnico`, `numeroUnico`, `sufijoUnico`, `nombreUnico`, `correoUnico` de `test/integracion/unicos.ts`)",
    ).toEqual([]);
    // Y la lista no se pudre: cada permitido sigue teniendo exactamente su cuenta.
    for (const [archivo, { usos }] of Object.entries(PERMITIDOS)) {
      expect(porArchivo.get(archivo)?.length ?? 0, `${archivo}: la cuenta permitida`).toBe(usos);
    }
  });

  it("el generador común es el único que puede tener azar de valores únicos, y no lo usa: sus rangos son por puesto", () => {
    expect(usosDebilesDeUnicidad(GENERADOR, readFileSync(GENERADOR, "utf8"))).toEqual([]);
  });
});

describe("ids únicos: cada forma prohibida está inyectada (si se debilita el analizador, esta prueba falla)", () => {
  const usos = (texto: string) => usosDebilesDeUnicidad("x.ts", texto).map((u) => u.uso);

  it.each([
    ["Math.random()", "const x = Math.random();", "Math.random"],
    ["Math con corchetes", 'const x = Math["random"]();', "Math.random"],
    ["Math partido en líneas", "const x = Math\n  .random();", "Math.random"],
    [
      "Math desestructurado",
      "const { random } = Math;\nrandom();",
      "Math.random (desestructurado)",
    ],
    [
      "randomInt importado",
      'import { randomInt } from "node:crypto";\nrandomInt(0, 9);',
      "randomInt",
    ],
    [
      "randomInt con alias",
      'import { randomInt as sortear } from "node:crypto";\nsortear(0, 9);',
      "randomInt",
    ],
    ["crypto.randomInt", 'import crypto from "node:crypto";\ncrypto.randomInt(5);', "randomInt"],
    ["getRandomValues", "crypto.getRandomValues(new Uint8Array(4));", "getRandomValues"],
    [
      "UUID truncado con slice",
      'import { randomUUID } from "node:crypto";\nconst x = randomUUID().slice(0, 8);',
      "randomUUID truncado",
    ],
    [
      "UUID truncado tras replaceAll",
      'import { randomUUID } from "crypto";\nconst x = randomUUID().replaceAll("-", "").slice(0, 12);',
      "randomUUID truncado",
    ],
    [
      "UUID truncado con substring",
      'import { randomUUID } from "node:crypto";\nconst x = randomUUID().substring(0, 6);',
      "randomUUID truncado",
    ],
    [
      "UUID truncado con alias",
      'import { randomUUID as uuid } from "node:crypto";\nconst x = uuid().substr(0, 6);',
      "randomUUID truncado",
    ],
    [
      "randomBytes(4)",
      'import { randomBytes } from "node:crypto";\nconst x = randomBytes(4).toString("hex");',
      "randomBytes de menos de 8 bytes",
    ],
    [
      "randomBytes(7)",
      'import { randomBytes } from "node:crypto";\nrandomBytes(7);',
      "randomBytes de menos de 8 bytes",
    ],
  ])("detecta %s", (_nombre, texto, esperado) => {
    expect(usos(texto)).toContain(esperado);
  });

  it.each([
    ["un randomUUID entero", 'import { randomUUID } from "node:crypto";\nconst x = randomUUID();'],
    [
      "un randomUUID sin puntos",
      'import { randomUUID } from "node:crypto";\nconst x = randomUUID().replaceAll("-", "");',
    ],
    [
      "randomBytes de 8 o más",
      'import { randomBytes } from "node:crypto";\nrandomBytes(8);\nrandomBytes(32).toString("hex");',
    ],
    ["algo que se llama random pero no es Math", "const random = () => 4;\nrandom();"],
    [
      "un randomUUID de otro módulo",
      'import { randomUUID } from "./mio";\nrandomUUID().slice(0, 4);',
    ],
  ])("no marca %s", (_nombre, texto) => {
    expect(usos(texto)).toEqual([]);
  });

  it("dice la línea del uso", () => {
    expect(usosDebilesDeUnicidad("x.ts", "const a = 1;\nconst b = Math.random();")).toEqual([
      { uso: "Math.random", linea: 2 },
    ]);
  });
});
