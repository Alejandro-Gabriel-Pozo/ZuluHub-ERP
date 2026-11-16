import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Una prueba de integración no arma el entorno contra la base al CARGAR el archivo: `describe.skipIf(base === null)`
 * igual ejecuta el cuerpo del `describe`, así que un `const entorno = crearEntornoDePrueba(base as BaseDePruebas)` ahí
 * revienta («Cannot read properties of null») cuando no hay Postgres, en vez de saltearse. Se arma en `beforeAll`
 * (asignando a un `let`), que sí se saltea. Falla que previene: 3 archivos (`carta-publica-*`,
 * `clasificacion-migracion`) fallaban sin base local aunque estaban «salteados» (hallazgo aparte, 2026-11-16).
 * Límite que NO ve: `base!` o `base` pelado en el cuerpo de un `describe` (hoy ninguno; dentro de un `it` o
 * `beforeAll` es válido, así que no se prohíbe). En el CI la base existe (`PRUEBAS_DATABASE_URL`), así que ahí sigue corriendo todo y un faltante sigue fallando.
 */
const ARMADO_AL_CARGAR =
  /^[ \t]*(?:const|let)[ \t]+\w+[ \t]*=[ \t]*crearEntornoDePrueba\([ \t]*base[ \t]+as[ \t]/m;

/** Los archivos de `texto` que arman el entorno al cargarse (la forma `base as BaseDePruebas`: el `base` de `inject`, que puede ser `null`, forzado a no serlo). */
export function armaElEntornoAlCargar(texto: string): boolean {
  return ARMADO_AL_CARGAR.test(texto);
}

describe("las pruebas de integración no arman el entorno al cargar el archivo", () => {
  it("ningún test/integracion/*.test.ts lo hace", () => {
    const carpeta = join(import.meta.dirname, "../integracion");
    const archivos = readdirSync(carpeta).filter((n) => n.endsWith(".test.ts"));
    expect(archivos.length).toBeGreaterThan(0);
    const malos = archivos.filter((n) =>
      armaElEntornoAlCargar(readFileSync(join(carpeta, n), "utf8")),
    );
    expect(malos).toEqual([]);
  });

  it.each([
    "  const entorno = crearEntornoDePrueba(base as BaseDePruebas, 6);",
    "    const entorno = crearEntornoDePrueba(base as BaseDePruebas, 10);",
    "  let entorno = crearEntornoDePrueba( base as BaseDePruebas );",
  ])("violación inyectada: %s", (linea) => {
    expect(armaElEntornoAlCargar(`describe("x", () => {\n${linea}\n});`)).toBe(true);
  });

  it.each([
    "    entorno = crearEntornoDePrueba(base as BaseDePruebas, 6);",
    "  const entorno = crearEntornoDePrueba(propia.base, 4);",
    "  const propio = crearEntornoDePrueba(aparte.base, 5);",
    "  const otro = crearEntornoDePrueba(baseDeOtro);",
    "      const unaSola = crearEntornoDePrueba(base!, 1); // dentro de un it: corre solo si hay base",
  ])("lo permitido pasa: %s", (linea) => {
    expect(armaElEntornoAlCargar(linea)).toBe(false);
  });
});
