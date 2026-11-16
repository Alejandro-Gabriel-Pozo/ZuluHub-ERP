import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * REGLA (CLAUDE.md «Una regla, un lugar»): en la consola de plataforma (`apps/plataforma`) la forma de un uuid como texto no se escribe
 * a mano: se importa de `src/primitivas/identificadores/forma-de-uuid.ts`. Previene: seis copias en la consola de plataforma, dos de
 * ellas más estrictas (versión y variante) sin que nada lo dijera (hallazgo aparte, 2026-11-16).
 * Qué cuenta: una expresión regular escrita a mano con la forma 8-4-4-4-12 (`[0-9a-f]{8}-[0-9a-f]{4}…`) en el código de
 * `apps/plataforma`, sin mirar las pruebas. Alcance: SOLO esa app; fuera de ella la forma sigue repetida (src/, apps/web: ver el
 * informe de este tramo) y es deuda a pagar módulo por módulo. Lo que NO ve: una forma escrita de otra manera (`\d`, `[a-fA-F0-9]`, partes sumadas en un texto), una copia que
 * sale de armar la expresión con `new RegExp(...)`.
 */
const FORMA_8_4 = /\{8\}\s*-\s*\[[^\]]+\]\{4\}/;

/** ¿El texto escribe a mano la forma de un uuid (partes de 8 y de 4 dígitos hexadecimales)? */
export function repiteLaFormaDeUuid(texto: string): boolean {
  return FORMA_8_4.test(texto);
}

const RAIZ = join(import.meta.dirname, "../..");

function archivosDeCodigo(): string[] {
  const salida: string[] = [];
  for (const carpeta of ["apps/plataforma"]) {
    for (const r of readdirSync(join(RAIZ, carpeta), { recursive: true, encoding: "utf8" })) {
      if (r.split("/").some((p) => p === "node_modules" || p === ".next")) continue;
      if (!/\.(tsx?|mts|cts)$/.test(r) || /\.test\.(tsx?|mts|cts)$/.test(r) || r.endsWith(".d.ts"))
        continue;
      salida.push(`${carpeta}/${r}`);
    }
  }
  return salida;
}

describe("la forma de un uuid vive en un solo lugar", () => {
  const con = archivosDeCodigo().filter((a) =>
    repiteLaFormaDeUuid(readFileSync(join(RAIZ, a), "utf8")),
  );

  it("ningún archivo de apps/plataforma la escribe a mano", () => {
    expect(archivosDeCodigo().length).toBeGreaterThan(0);
    expect(con).toEqual([]);
  });

  it.each([
    "const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;",
    "const U = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;",
    "const U = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-/;",
    "const U = /[0-9a-f]{8} - [0-9a-f]{4}/;",
  ])("violación inyectada: %s", (linea) => {
    expect(repiteLaFormaDeUuid(linea)).toBe(true);
  });

  it.each([
    "import { esUuidCualquiera } from './forma-de-uuid';",
    "const NUMERO = /^[0-9]{8}$/;",
    "const A = /^[0-9a-f]{4}-[0-9a-f]{4}$/;",
  ])("lo permitido pasa: %s", (linea) => {
    expect(repiteLaFormaDeUuid(linea)).toBe(false);
  });
});
