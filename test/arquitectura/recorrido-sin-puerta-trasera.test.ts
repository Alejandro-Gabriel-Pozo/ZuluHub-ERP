import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * El recorrido de punta a punta (`test/recorrido`) reemplaza ARCA con un módulo de pruebas que se carga con `NODE_OPTIONS=--import` solo
 * en el proceso de `next start` que lanza la prueba. Falla que previene: que algo de producción (código de `src/`, de `apps/` o de los
 * scripts, o la configuración de Vercel) nombre ese módulo, su variable o `NODE_OPTIONS`; ahí el «modo de prueba» dejaría de ser
 * imposible en un despliegue real y habría una puerta que desvía las llamadas a ARCA. Todo nace cerrado: la única forma de activarlo es que
 * la prueba lo cargue desde afuera, y esta regla impide que el código lo cargue por su cuenta.
 */
const RAIZ = join(import.meta.dirname, "../..");

/** Lo que ningún archivo de producción puede contener. */
const PROHIBIDO_EN_PRODUCCION = [
  "conectar-arca-simulada",
  "PEDERNAL_RECORRIDO",
  "arca-simulada",
  "NODE_OPTIONS",
] as const;

/** Las líneas de `texto` que nombran algo prohibido (para el informe de la falla). */
function referenciasProhibidas(texto: string): string[] {
  return texto
    .split("\n")
    .filter((linea) => PROHIBIDO_EN_PRODUCCION.some((p) => linea.includes(p)))
    .map((linea) => linea.trim());
}

const IGNORAR = new Set(["node_modules", ".next", ".turbo"]);
function archivosDe(carpeta: string): string[] {
  return readdirSync(carpeta).flatMap((nombre) => {
    if (IGNORAR.has(nombre)) return [];
    const ruta = join(carpeta, nombre);
    return statSync(ruta).isDirectory() ? archivosDe(ruta) : [ruta];
  });
}

describe("el módulo de ARCA simulada no puede llegar a producción", () => {
  const produccion = [
    ...archivosDe(join(RAIZ, "src")),
    ...archivosDe(join(RAIZ, "apps")),
    ...archivosDe(join(RAIZ, "scripts")),
  ].filter((ruta) => !/\.(png|jpe?g|webp|ico|woff2?|svg)$/.test(ruta));

  it("ningún archivo de src/, apps/ ni scripts/ lo nombra ni toca NODE_OPTIONS", () => {
    const halladas = produccion.flatMap((ruta) =>
      referenciasProhibidas(readFileSync(ruta, "utf8")).map((linea) => `${ruta}: ${linea}`),
    );
    expect(halladas).toEqual([]);
  });

  it("vercel.json no lo nombra ni define NODE_OPTIONS", () => {
    const vercel = readFileSync(join(RAIZ, "apps/web/vercel.json"), "utf8");
    expect(referenciasProhibidas(vercel)).toEqual([]);
  });

  it("la regla detecta la violación inyectada (las cuatro formas)", () => {
    for (const prohibido of PROHIBIDO_EN_PRODUCCION) {
      const inyectado = `const a = 1;\nimport "${prohibido}";\n`;
      expect(referenciasProhibidas(inyectado)).toEqual([`import "${prohibido}";`]);
    }
    expect(referenciasProhibidas("const todoBien = true;")).toEqual([]);
  });
});
