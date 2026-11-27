import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * La excepción de gitleaks para los sellos de migraciones (`migraciones/selladas.json`, dueño, 27/11/2026, «Apruebo a y c») tiene que seguir ANGOSTA: solo la regla
 * `sumologic-access-token`, solo ese archivo y solo líneas con la forma `"NNNN_nombre.sql": "<64 hexadecimales>"`. Falla que previene: que alguien la ensanche (otra regla, otra
 * ruta, un patrón que acepte cualquier valor) y un secreto real escrito en ese archivo pase sin marcarse, o que se la quite y el escaneo del historial vuelva a quedar rojo para siempre.
 * LÍMITE: lee el texto de `.gitleaks.toml`; que gitleaks aplique la excepción como se espera lo comprueba el job de Seguridad del CI con el historial completo.
 */
const RAIZ = join(import.meta.dirname, "../..");

const FORMA_DE_LINEA = String.raw`^\s*"\d{4}_[a-z0-9_]+\.sql": "[0-9a-f]{64}",?\s*$`;

/** El bloque `[[rules]]` de la regla de los sellos (hasta el próximo `[[` de primer nivel o el fin del archivo). */
function bloqueDeLosSellos(toml: string): string | undefined {
  const inicio = toml.indexOf('[[rules]]\nid = "sumologic-access-token"');
  if (inicio === -1) return undefined;
  const resto = toml.slice(inicio + 1);
  const siguiente = resto.search(/^\[\[(?!rules\.allowlists\]\])/m);
  return siguiente === -1 ? toml.slice(inicio) : toml.slice(inicio, inicio + 1 + siguiente);
}

/** Lo que está mal en la excepción de los sellos. Vacío = bien. */
function problemas(toml: string): string[] {
  const salida: string[] = [];
  const bloque = bloqueDeLosSellos(toml);
  if (bloque === undefined) {
    return ["no hay una excepción de la regla `sumologic-access-token` para los sellos"];
  }
  if (!bloque.includes("[[rules.allowlists]]")) {
    salida.push(
      "la excepción de los sellos no es una excepción DE LA REGLA (`[[rules.allowlists]]`)",
    );
  }
  if (!/^condition = "AND"$/m.test(bloque)) {
    salida.push(
      'la excepción de los sellos no exige ruta Y forma de línea juntas (`condition = "AND"`)',
    );
  }
  if (!/^regexTarget = "line"$/m.test(bloque)) {
    salida.push('la excepción de los sellos no mira la línea (`regexTarget = "line"`)');
  }
  const rutas = [
    ...(/^paths = \[\n([\s\S]*?)^\]$/m.exec(bloque)?.[1] ?? "").matchAll(/'''([^\n]*)'''/g),
  ].map((m) => m[1]);
  if (rutas.length !== 1 || rutas[0] !== String.raw`^migraciones/selladas\.json$`) {
    salida.push(
      `la excepción de los sellos debe valer solo para \`migraciones/selladas.json\` (rutas: ${JSON.stringify(rutas)})`,
    );
  }
  const formas = [
    ...(/^regexes = \[\n([\s\S]*?)^\]$/m.exec(bloque)?.[1] ?? "").matchAll(/'''([^\n]*)'''/g),
  ].map((m) => m[1]);
  if (formas.length !== 1 || formas[0] !== FORMA_DE_LINEA) {
    salida.push(
      `la excepción de los sellos debe aceptar solo la forma «"NNNN_nombre.sql": "<64 hexadecimales>"» (formas: ${JSON.stringify(formas)})`,
    );
  }
  return salida;
}

/** El texto sin las líneas de comentario (el comentario que presenta la regla siguiente cae al final del bloque anterior). */
function sinComentarios(texto: string): string {
  return texto
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
}

/** Excepciones globales (`[[allowlists]]`) que nombran `selladas.json`: ignorarían TODO el archivo sin mirar el valor (medido con gitleaks 8.30.1). */
function excepcionesGlobalesSobreLosSellos(toml: string): number {
  return toml
    .split(/^\[\[allowlists\]\]$/m)
    .slice(1)
    .filter((b) => sinComentarios(b.split(/^\[\[/m)[0] ?? "").includes("selladas")).length;
}

const REAL = readFileSync(join(RAIZ, ".gitleaks.toml"), "utf8");

describe("la excepción de gitleaks para los sellos de migraciones sigue angosta", () => {
  it("lo real cumple: una regla, un archivo, una forma de línea, y ninguna excepción global sobre el archivo", () => {
    expect(problemas(REAL)).toEqual([]);
    expect(excepcionesGlobalesSobreLosSellos(REAL)).toBe(0);
  });

  it("la forma de línea acepta un sello real y rechaza un valor que no es un hash de 64 hexadecimales", () => {
    const forma = new RegExp(FORMA_DE_LINEA);
    const hash = "1b95f22c1f98287338931235df9e46ae1bafc904972a73233efc42cc0f2a20c8";
    expect(forma.test(`  "0054_precio.sql": "${hash}",`)).toBe(true);
    expect(forma.test(`  "0054_precio.sql": "${hash}"`)).toBe(true);
    expect(forma.test(`  "0054_precio.sql": "${hash.slice(1)}",`)).toBe(false);
    expect(forma.test(`  "0054_precio.sql": "${hash}00",`)).toBe(false);
    expect(forma.test(`  "0054_precio.sql": "${hash.toUpperCase()}",`)).toBe(false);
    expect(forma.test(`  "clave": "abc123SECRETO-real-1234567890abcdef1234567890abcdef12",`)).toBe(
      false,
    );
  });

  describe("violaciones inyectadas", () => {
    const sinBloque = REAL.replace(/\[\[rules\]\]\nid = "sumologic-access-token"[\s\S]*$/, "");

    it("sin la excepción, falla", () => {
      expect(problemas(sinBloque)).toHaveLength(1);
    });

    it("una ruta de más, falla", () => {
      const roto = REAL.replace(
        String.raw`'''^migraciones/selladas\.json$''',`,
        String.raw`'''^migraciones/selladas\.json$''',` + "\n  '''^migraciones/.*$''',",
      );
      expect(problemas(roto).join("\n")).toContain("solo para `migraciones/selladas.json`");
    });

    it("un patrón que acepta cualquier valor, falla", () => {
      const roto = REAL.replace(FORMA_DE_LINEA, ".*");
      expect(problemas(roto).join("\n")).toContain("solo la forma");
    });

    it('sin `regexTarget = "line"`, falla', () => {
      const roto = REAL.replace('regexTarget = "line"\n', "");
      expect(problemas(roto).join("\n")).toContain("regexTarget");
    });

    it('con `condition = "OR"`, falla', () => {
      const roto = REAL.replace(
        /(\[\[rules\.allowlists\]\][\s\S]*?)condition = "AND"/,
        '$1condition = "OR"',
      );
      expect(problemas(roto).join("\n")).toContain("condition");
    });

    it("una excepción global sobre `selladas.json`, se cuenta", () => {
      const roto = `${REAL}\n[[allowlists]]\ndescription = "x"\npaths = [\n  '''^migraciones/selladas\\.json$''',\n]\n`;
      expect(excepcionesGlobalesSobreLosSellos(roto)).toBe(1);
    });
  });
});
