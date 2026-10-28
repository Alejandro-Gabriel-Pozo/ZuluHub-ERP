import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import { CATALOGO_DE_MODELOS_DE_VIDRIERA, modeloEfectivo, type ModeloDeVidriera } from "./modelos";

/**
 * C-9: `modeloEfectivo` sobre TODAS las combinaciones (modelo × perillas × fotos visibles × Save-Data),
 * recorridas enteras y no muestreadas: el espacio es chico y así no queda ninguna sin mirar.
 */

const MODELOS = Object.keys(CATALOGO_DE_MODELOS_DE_VIDRIERA) as ModeloDeVidriera[];
const PERILLAS = [
  "vidriera_modelo_cuadricula",
  "vidriera_modelo_libro",
  "productos_con_foto",
] as const;
const CONJUNTOS = Array.from({ length: 2 ** PERILLAS.length }, (_, mascara) =>
  PERILLAS.filter((_, i) => (mascara >> i) & 1),
);

const combinaciones = MODELOS.flatMap((elegido) =>
  CONJUNTOS.flatMap((perillasEncendidas) =>
    [0, 1, 40].flatMap((fotosVisibles) =>
      [false, true].map((ahorroDeDatos) => ({
        elegido,
        perillasEncendidas,
        fotosVisibles,
        ahorroDeDatos,
      })),
    ),
  ),
);

describe("modeloEfectivo: todas las combinaciones", () => {
  it("recorre 3 modelos × 8 conjuntos de perillas × 3 conteos de fotos × 2 de Save-Data", () => {
    expect(combinaciones).toHaveLength(3 * 8 * 3 * 2);
  });

  it("siempre devuelve un modelo del catálogo", () => {
    for (const e of combinaciones) expect(MODELOS).toContain(modeloEfectivo(e));
  });

  it("nunca devuelve un modelo cuya perilla está apagada", () => {
    for (const e of combinaciones) {
      const perilla = CATALOGO_DE_MODELOS_DE_VIDRIERA[modeloEfectivo(e)].perilla;
      if (perilla !== null) expect(e.perillasEncendidas).toContain(perilla);
    }
  });

  it("Cuadrícula sin fotos visibles nunca sale, y con Save-Data siempre es Lista", () => {
    for (const e of combinaciones) {
      const m = modeloEfectivo(e);
      if (e.fotosVisibles === 0) expect(m).not.toBe("CUADRICULA");
      if (e.ahorroDeDatos) expect(m).toBe("LISTA");
    }
  });

  it("devuelve lo elegido si y solo si nada lo impide; si no, Lista", () => {
    for (const e of combinaciones) {
      const def = CATALOGO_DE_MODELOS_DE_VIDRIERA[e.elegido];
      const puede =
        (def.perilla === null || e.perillasEncendidas.includes(def.perilla)) &&
        (!def.requiereFotos || e.fotosVisibles > 0) &&
        !e.ahorroDeDatos;
      expect(modeloEfectivo(e)).toBe(puede ? e.elegido : "LISTA");
    }
  });

  it("con cualquier texto elegido y cualquier plan, devuelve un modelo del catálogo (jamás deja la carta caída)", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(""),
          fc.string(),
          fc.constantFrom("TABLERO", "CARRUSEL", "__proto__", "hasOwnProperty"),
        ),
        fc.array(fc.string(), { maxLength: 5 }),
        fc.oneof(fc.integer({ min: -5, max: 500 }), fc.constant(Number.NaN)),
        fc.boolean(),
        (elegido, perillasEncendidas, fotosVisibles, ahorroDeDatos) => {
          expect(MODELOS).toContain(
            modeloEfectivo({ elegido, perillasEncendidas, fotosVisibles, ahorroDeDatos }),
          );
        },
      ),
    );
  });

  it("es determinista: la misma entrada da siempre lo mismo", () => {
    for (const e of combinaciones) expect(modeloEfectivo(e)).toBe(modeloEfectivo({ ...e }));
  });
});
