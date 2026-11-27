import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOGO_DE_MODELOS_DE_VIDRIERA } from "./modelos";

const RAIZ = join(import.meta.dirname, "..", "..", "..", "..");

/**
 * C-16 (esqueleto): todo modelo del catálogo declara qué tramo trae su e2e y su axe. Hoy no existe
 * `apps/web`, así que se declara el tramo responsable; cuando existe el e2e, el valor es el archivo real y la prueba
 * comprueba que el archivo existe (el Libro ya lo tiene). Un modelo nuevo en el
 * catálogo sin entrada acá hace fallar la primera prueba; una entrada sin modelo, la segunda.
 */
const PRUEBAS_POR_MODELO: Readonly<
  Record<keyof typeof CATALOGO_DE_MODELOS_DE_VIDRIERA, { e2e: string; axe: string }>
> = {
  LISTA: { e2e: "C-2", axe: "C-2" },
  CUADRICULA: { e2e: "C-5", axe: "C-5" },
  LIBRO: {
    e2e: "test/recorrido/carta-libro.recorrido.ts",
    axe: "apps/web/ui/plantillas/vidriera/PlantillaLibro.test.tsx",
  },
};

describe("todo modelo tiene su prueba (C-16, esqueleto)", () => {
  it("cada modelo del catálogo declara el tramo de su e2e y de su axe", () => {
    for (const modelo of Object.keys(CATALOGO_DE_MODELOS_DE_VIDRIERA)) {
      expect(PRUEBAS_POR_MODELO, modelo).toHaveProperty(modelo);
    }
  });

  it("no hay pruebas declaradas para un modelo que no existe", () => {
    expect(Object.keys(PRUEBAS_POR_MODELO).sort()).toEqual(
      Object.keys(CATALOGO_DE_MODELOS_DE_VIDRIERA).sort(),
    );
  });

  it("lo declarado es un tramo (C-n) o un archivo de prueba que existe", () => {
    for (const { e2e, axe } of Object.values(PRUEBAS_POR_MODELO)) {
      for (const valor of [e2e, axe]) {
        if (/^C-\d+$/.test(valor)) continue;
        expect(existsSync(join(RAIZ, valor)), valor).toBe(true);
      }
    }
  });
});
