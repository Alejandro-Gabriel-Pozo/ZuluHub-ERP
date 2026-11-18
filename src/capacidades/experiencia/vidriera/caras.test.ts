import { describe, expect, it } from "vitest";
import { CARAS_DE_VIDRIERA, CARA_POR_DEFECTO, esCaraDeVidriera } from "./caras";

describe("caras de la carta: lista cerrada", () => {
  it("son exactamente tres, en este orden (la base copia las mismas claves en `carta_publica_cara_ck`)", () => {
    expect([...CARAS_DE_VIDRIERA]).toEqual(["DIA", "BOLICHE", "NOCHE"]);
  });

  it("la cara de una carta que no eligió ninguna es DIA y es una de la lista", () => {
    expect(CARA_POR_DEFECTO).toBe("DIA");
    expect(esCaraDeVidriera(CARA_POR_DEFECTO)).toBe(true);
  });

  it.each(["DIA", "BOLICHE", "NOCHE"])("acepta %s", (cara) => {
    expect(esCaraDeVidriera(cara)).toBe(true);
  });

  it.each([
    ["minúsculas", "dia"],
    ["con espacio", "DIA "],
    ["vacía", ""],
    ["inventada", "TARDE"],
    ["parte de otra", "DI"],
    ["un método heredado", "toString"],
    ["una clave de objeto", "length"],
  ])("rechaza un texto que no es una cara (%s)", (_caso, valor) => {
    expect(esCaraDeVidriera(valor)).toBe(false);
  });

  it.each([null, undefined, 0, 1, true, {}, [], ["DIA"], Symbol("DIA")])(
    "rechaza lo que no es texto (%s)",
    (valor) => {
      expect(esCaraDeVidriera(valor)).toBe(false);
    },
  );
});
