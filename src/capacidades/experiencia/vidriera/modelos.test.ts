import { describe, expect, it } from "vitest";
import {
  CATALOGO_DE_MODELOS_DE_VIDRIERA,
  MODELO_DE_RESERVA,
  esModeloDeVidriera,
  modeloEfectivo,
  type EntradaDelModeloEfectivo,
} from "./modelos";

const TODAS = ["carta_modelo_cuadricula", "carta_modelo_libro"];

function entrada(parcial: Partial<EntradaDelModeloEfectivo>): EntradaDelModeloEfectivo {
  return {
    elegido: "LISTA",
    perillasEncendidas: TODAS,
    fotosVisibles: 10,
    ahorroDeDatos: false,
    ...parcial,
  };
}

describe("CATALOGO_DE_MODELOS_DE_VIDRIERA (§4.5)", () => {
  it("v1: Lista de base y reserva, Cuadrícula y Libro con su perilla; Tablero y Carrusel no están", () => {
    expect(CATALOGO_DE_MODELOS_DE_VIDRIERA).toEqual({
      LISTA: { perilla: null, requiereFotos: false },
      CUADRICULA: { perilla: "carta_modelo_cuadricula", requiereFotos: true },
      LIBRO: { perilla: "carta_modelo_libro", requiereFotos: false },
    });
    expect(MODELO_DE_RESERVA).toBe("LISTA");
  });

  it("solo la Lista no se cobra aparte: es la única sin perilla", () => {
    const sinPerilla = Object.entries(CATALOGO_DE_MODELOS_DE_VIDRIERA)
      .filter(([, d]) => d.perilla === null)
      .map(([clave]) => clave);
    expect(sinPerilla).toEqual(["LISTA"]);
  });
});

describe("esModeloDeVidriera", () => {
  it.each(["LISTA", "CUADRICULA", "LIBRO"])("%s es un modelo", (m) => {
    expect(esModeloDeVidriera(m)).toBe(true);
  });

  it.each(["TABLERO", "CARRUSEL", "lista", "", "constructor", "toString", "__proto__"])(
    "%j no lo es",
    (m) => {
      expect(esModeloDeVidriera(m)).toBe(false);
    },
  );
});

describe("modeloEfectivo (§4.4, servidor)", () => {
  it("con todo habilitado respeta la elección", () => {
    expect(modeloEfectivo(entrada({ elegido: "LISTA" }))).toBe("LISTA");
    expect(modeloEfectivo(entrada({ elegido: "CUADRICULA" }))).toBe("CUADRICULA");
    expect(modeloEfectivo(entrada({ elegido: "LIBRO" }))).toBe("LIBRO");
  });

  it("sin elección (vacía), o con una elección que no existe, es Lista", () => {
    expect(modeloEfectivo(entrada({ elegido: "" }))).toBe("LISTA");
    expect(modeloEfectivo(entrada({ elegido: "TABLERO" }))).toBe("LISTA");
    expect(modeloEfectivo(entrada({ elegido: "toString" }))).toBe("LISTA");
  });

  it("si la perilla del modelo está apagada (plan bajado), cae a Lista", () => {
    expect(modeloEfectivo(entrada({ elegido: "LIBRO", perillasEncendidas: [] }))).toBe("LISTA");
    expect(
      modeloEfectivo(
        entrada({ elegido: "LIBRO", perillasEncendidas: ["carta_modelo_cuadricula"] }),
      ),
    ).toBe("LISTA");
    expect(
      modeloEfectivo(
        entrada({ elegido: "CUADRICULA", perillasEncendidas: ["carta_modelo_libro"] }),
      ),
    ).toBe("LISTA");
  });

  it("la Lista no necesita ninguna perilla", () => {
    expect(modeloEfectivo(entrada({ elegido: "LISTA", perillasEncendidas: [] }))).toBe("LISTA");
  });

  it("Cuadrícula sin ninguna foto visible cae a Lista; con una sola se queda", () => {
    expect(modeloEfectivo(entrada({ elegido: "CUADRICULA", fotosVisibles: 0 }))).toBe("LISTA");
    expect(modeloEfectivo(entrada({ elegido: "CUADRICULA", fotosVisibles: 1 }))).toBe("CUADRICULA");
  });

  it("un conteo de fotos absurdo (negativo o NaN) cuenta como ninguna", () => {
    expect(modeloEfectivo(entrada({ elegido: "CUADRICULA", fotosVisibles: -3 }))).toBe("LISTA");
    expect(modeloEfectivo(entrada({ elegido: "CUADRICULA", fotosVisibles: Number.NaN }))).toBe(
      "LISTA",
    );
  });

  it("el Libro no necesita fotos", () => {
    expect(modeloEfectivo(entrada({ elegido: "LIBRO", fotosVisibles: 0 }))).toBe("LIBRO");
  });

  it("con Save-Data cae a Lista, sea cual sea la elección", () => {
    for (const elegido of ["LISTA", "CUADRICULA", "LIBRO"]) {
      expect(modeloEfectivo(entrada({ elegido, ahorroDeDatos: true }))).toBe("LISTA");
    }
  });
});
