import { describe, expect, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../modulos/catalogo";
import { CATALOGO_DE_GRUPO } from "./grupo";
import { CATALOGO_DE_PLATAFORMA } from "./plataforma";

/**
 * Los tres catálogos de permisos (empresa, plataforma, grupo) están separados A PROPÓSITO: `reglas.cjs` prohíbe que
 * se importen entre sí. El compilador amarra cada catálogo con su matriz de roles, pero no cruza esa frontera: si
 * dos catálogos definieran la misma clave (o el mismo nombre de módulo), nada lo detectaría. Esta prueba es ese
 * cruce: cada clave de acción y cada módulo tiene UN solo dueño.
 */

type Catalogo = Readonly<Record<string, { acciones: Readonly<Record<string, unknown>> }>>;

const CATALOGOS: ReadonlyArray<readonly [string, Catalogo]> = [
  ["empresa", CATALOGO_DE_MODULOS],
  ["plataforma", CATALOGO_DE_PLATAFORMA],
  ["grupo", CATALOGO_DE_GRUPO],
];

/** Los valores que aparecen más de una vez, con los dueños de cada aparición. */
function repetidos(
  porDueno: ReadonlyArray<readonly [string, readonly string[]]>,
): Map<string, string[]> {
  const dueños = new Map<string, string[]>();
  for (const [dueño, valores] of porDueno) {
    for (const valor of valores) dueños.set(valor, [...(dueños.get(valor) ?? []), dueño]);
  }
  return new Map([...dueños].filter(([, lista]) => lista.length > 1));
}

const clavesDeAccion = CATALOGOS.map(
  ([dueño, catalogo]) =>
    [dueño, Object.values(catalogo).flatMap((modulo) => Object.keys(modulo.acciones))] as const,
);
const nombresDeModulo = CATALOGOS.map(
  ([dueño, catalogo]) => [dueño, Object.keys(catalogo)] as const,
);

describe("claves de permisos con un solo dueño", () => {
  it("ninguna clave de acción está en dos catálogos (ni dos veces en el mismo)", () => {
    expect([...repetidos(clavesDeAccion)]).toEqual([]);
    for (const [dueño, claves] of clavesDeAccion) {
      expect(claves.length, `el catálogo ${dueño} no tiene acciones`).toBeGreaterThan(0);
      expect(new Set(claves).size, `claves repetidas dentro de ${dueño}`).toBe(claves.length);
    }
  });

  it("ningún nombre de módulo está en dos catálogos", () => {
    expect([...repetidos(nombresDeModulo)]).toEqual([]);
  });

  it("el cruce detecta una clave repetida entre catálogos y dice quiénes la definen", () => {
    const sintetico = repetidos([
      ["empresa", ["usuarios.ver", "ventas.ver"]],
      ["plataforma", ["usuarios.ver", "soporte.ver"]],
      ["grupo", ["grupo.ver"]],
    ]);
    expect([...sintetico]).toEqual([["usuarios.ver", ["empresa", "plataforma"]]]);
  });
});
