import { describe, expect, it } from "vitest";
import { CATALOGO_DE_MODELOS_DE_CARTA } from "./modelos";

/**
 * C-16 (esqueleto): todo modelo del catálogo declara qué tramo trae su e2e y su axe. Hoy no existe
 * `apps/web`, así que se declara el tramo responsable; cuando exista el e2e, C-2/C-5/C-6 reemplazan el
 * valor por el archivo real y la prueba pasa a comprobar que el archivo existe. Un modelo nuevo en el
 * catálogo sin entrada acá hace fallar la primera prueba; una entrada sin modelo, la segunda.
 */
const PRUEBAS_POR_MODELO: Readonly<
  Record<keyof typeof CATALOGO_DE_MODELOS_DE_CARTA, { e2e: string; axe: string }>
> = {
  LISTA: { e2e: "C-2", axe: "C-2" },
  CUADRICULA: { e2e: "C-5", axe: "C-5" },
  LIBRO: { e2e: "C-6", axe: "C-6" },
};

describe("todo modelo tiene su prueba (C-16, esqueleto)", () => {
  it("cada modelo del catálogo declara el tramo de su e2e y de su axe", () => {
    for (const modelo of Object.keys(CATALOGO_DE_MODELOS_DE_CARTA)) {
      expect(PRUEBAS_POR_MODELO, modelo).toHaveProperty(modelo);
    }
  });

  it("no hay pruebas declaradas para un modelo que no existe", () => {
    expect(Object.keys(PRUEBAS_POR_MODELO).sort()).toEqual(
      Object.keys(CATALOGO_DE_MODELOS_DE_CARTA).sort(),
    );
  });

  it("los tramos declarados son de la experiencia de la carta", () => {
    for (const { e2e, axe } of Object.values(PRUEBAS_POR_MODELO)) {
      expect(e2e).toMatch(/^C-\d+$/);
      expect(axe).toMatch(/^C-\d+$/);
    }
  });
});
