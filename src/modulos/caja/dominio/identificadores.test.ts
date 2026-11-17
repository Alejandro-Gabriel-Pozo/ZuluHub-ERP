import { describe, expect, it } from "vitest";
import { esUuid } from "./identificadores";

const ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("la forma de un uuid", () => {
  it("acepta un uuid en minúscula o mayúscula", () => {
    expect(esUuid(ID)).toBe(true);
    expect(esUuid(ID.toUpperCase())).toBe(true);
  });
  it("rechaza lo que no tiene la forma", () => {
    for (const malo of [
      "",
      "abc",
      `${ID}0`,
      `0${ID}`,
      ID.replaceAll("-", ""),
      "g1b2c3d4-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
    ]) {
      expect(esUuid(malo)).toBe(false);
    }
  });
  it("solo es uuid un texto: un objeto que se convierte en uno no lo es", () => {
    expect(esUuid({ toString: () => ID })).toBe(false);
    expect(esUuid([ID])).toBe(false);
    expect(esUuid(null)).toBe(false);
    expect(esUuid(undefined)).toBe(false);
  });
});
