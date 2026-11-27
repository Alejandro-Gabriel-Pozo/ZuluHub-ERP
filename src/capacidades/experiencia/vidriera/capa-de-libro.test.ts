import { describe, expect, it } from "vitest";
import {
  MS_MAXIMOS_PARA_MONTAR_EL_LIBRO,
  PAGINA_INDICE,
  PAGINA_PORTADA,
  numeroDeSeccion,
  paginaDeLaSeccion,
  paginaDelAncla,
  paginaVecina,
  paginaVisible,
  puedeMontarseElLibro,
  type EntornoDelLibro,
} from "./capa-de-libro";

const BUENO: EntornoDelLibro = {
  msHastaElScript: 800,
  ahorroDeDatos: false,
  tipoDeRed: "4g",
  movimientoReducido: false,
};

describe("puedeMontarseElLibro", () => {
  it("monta con buena red, sin ahorro de datos y sin movimiento reducido", () => {
    expect(puedeMontarseElLibro(BUENO)).toBe(true);
  });
  it("monta cuando el navegador no informa el tipo de red", () => {
    expect(puedeMontarseElLibro({ ...BUENO, tipoDeRed: null })).toBe(true);
  });
  it("el límite de tiempo es inclusivo: 2,5 s entra y un milisegundo más no", () => {
    expect(
      puedeMontarseElLibro({ ...BUENO, msHastaElScript: MS_MAXIMOS_PARA_MONTAR_EL_LIBRO }),
    ).toBe(true);
    expect(
      puedeMontarseElLibro({ ...BUENO, msHastaElScript: MS_MAXIMOS_PARA_MONTAR_EL_LIBRO + 1 }),
    ).toBe(false);
  });
  it("un tiempo que no se pudo medir no monta", () => {
    expect(puedeMontarseElLibro({ ...BUENO, msHastaElScript: Number.NaN })).toBe(false);
    expect(puedeMontarseElLibro({ ...BUENO, msHastaElScript: Number.POSITIVE_INFINITY })).toBe(
      false,
    );
  });
  it("no monta con ahorro de datos", () => {
    expect(puedeMontarseElLibro({ ...BUENO, ahorroDeDatos: true })).toBe(false);
  });
  it("no monta con movimiento reducido", () => {
    expect(puedeMontarseElLibro({ ...BUENO, movimientoReducido: true })).toBe(false);
  });
  it("no monta con 2g ni slow-2g, y sí con 3g", () => {
    expect(puedeMontarseElLibro({ ...BUENO, tipoDeRed: "2g" })).toBe(false);
    expect(puedeMontarseElLibro({ ...BUENO, tipoDeRed: "slow-2g" })).toBe(false);
    expect(puedeMontarseElLibro({ ...BUENO, tipoDeRed: "3g" })).toBe(true);
  });
});

describe("paginas", () => {
  it("la portada es la 0, el índice la 1 y las secciones siguen", () => {
    expect(PAGINA_PORTADA).toBe(0);
    expect(PAGINA_INDICE).toBe(1);
    expect(paginaDeLaSeccion(0)).toBe(2);
    expect(paginaDeLaSeccion(3)).toBe(5);
  });
  it("el contador no aparece en la portada ni en el índice y cuenta desde 1", () => {
    expect(numeroDeSeccion(0)).toBeNull();
    expect(numeroDeSeccion(1)).toBeNull();
    expect(numeroDeSeccion(2)).toBe(1);
    expect(numeroDeSeccion(5)).toBe(4);
  });
  it("paginaVisible redondea a la página más cercana y se acota", () => {
    expect(paginaVisible(0, 400, 5)).toBe(0);
    expect(paginaVisible(199, 400, 5)).toBe(0);
    expect(paginaVisible(200, 400, 5)).toBe(1);
    expect(paginaVisible(1600, 400, 5)).toBe(4);
    expect(paginaVisible(99999, 400, 5)).toBe(4);
    expect(paginaVisible(-50, 400, 5)).toBe(0);
  });
  it("paginaVisible con medidas inservibles vuelve a la portada", () => {
    expect(paginaVisible(400, 0, 5)).toBe(0);
    expect(paginaVisible(400, Number.NaN, 5)).toBe(0);
    expect(paginaVisible(Number.NaN, 400, 5)).toBe(0);
    expect(paginaVisible(400, 400, 0)).toBe(0);
  });
  it("paginaDelAncla lleva a la sección con ese slug, con o sin «#»", () => {
    const ids = ["entradas", "pastas", "postres"];
    expect(paginaDelAncla("#pastas", ids)).toBe(3);
    expect(paginaDelAncla("postres", ids)).toBe(4);
    expect(paginaDelAncla("#no-existe", ids)).toBeNull();
    expect(paginaDelAncla("", ids)).toBeNull();
    expect(paginaDelAncla("#%E0%A4%A", ids)).toBeNull();
    expect(paginaDelAncla("#caf%C3%A9", ["café"])).toBe(2);
  });
  it("paginaVecina no se sale de los extremos", () => {
    expect(paginaVecina(0, -1, 4)).toBe(0);
    expect(paginaVecina(0, 1, 4)).toBe(1);
    expect(paginaVecina(3, 1, 4)).toBe(3);
    expect(paginaVecina(3, -1, 4)).toBe(2);
  });
});
