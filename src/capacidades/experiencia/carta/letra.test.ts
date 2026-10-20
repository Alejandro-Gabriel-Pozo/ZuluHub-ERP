import { describe, expect, it } from "vitest";
import {
  CLAVE_DE_LETRA_GUARDADA,
  LETRAS_BASE,
  LETRA_BASE_POR_DEFECTO,
  PASOS_DE_LETRA,
  PASO_DE_LETRA_POR_DEFECTO,
  leerLetraBase,
  leerPasoDeLetra,
} from "./letra";

describe("letra de la carta (D10)", () => {
  it("son tres pasos, del menor al mayor, y el normal es el de partida", () => {
    expect(PASOS_DE_LETRA).toEqual(["NORMAL", "GRANDE", "MUY_GRANDE"]);
    expect(PASO_DE_LETRA_POR_DEFECTO).toBe("NORMAL");
  });

  it("la perilla del comerciante tiene dos valores, y por defecto es NORMAL", () => {
    expect(LETRAS_BASE).toEqual(["NORMAL", "GRANDE"]);
    expect(LETRA_BASE_POR_DEFECTO).toBe("NORMAL");
  });

  it("la única clave que se guarda en el navegador tiene el prefijo de la carta", () => {
    expect(CLAVE_DE_LETRA_GUARDADA).toBe("pd-carta-letra");
  });

  describe("leerPasoDeLetra", () => {
    it.each(PASOS_DE_LETRA)("%s se conserva", (paso) => {
      expect(leerPasoDeLetra(paso)).toBe(paso);
    });

    it.each([
      ["nada guardado", null],
      ["indefinido", undefined],
      ["vacío", ""],
      ["minúsculas", "grande"],
      ["un paso que no existe", "ENORME"],
      ["un número", "2"],
      ["un objeto", "{}"],
      ["un nombre heredado de Object", "constructor"],
      ["un nombre heredado de Object (toString)", "toString"],
    ])("%s vuelve al paso normal", (_nombre, guardado) => {
      expect(leerPasoDeLetra(guardado)).toBe("NORMAL");
    });
  });

  describe("leerLetraBase", () => {
    it.each(LETRAS_BASE)("%s se conserva", (valor) => {
      expect(leerLetraBase(valor)).toBe(valor);
    });

    it.each([
      ["nada", null],
      ["indefinido", undefined],
      ["muy grande: la perilla no lo admite", "MUY_GRANDE"],
      ["un tamaño libre", "30px"],
      ["minúsculas", "grande"],
    ])("%s es NORMAL", (_nombre, valor) => {
      expect(leerLetraBase(valor)).toBe("NORMAL");
    });
  });
});
