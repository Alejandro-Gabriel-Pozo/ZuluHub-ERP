import { describe, expect, it } from "vitest";
import { CLASES_COMPRABLES, esClaseComprable } from "./clase-comprable";

describe("esClaseComprable", () => {
  it("acepta materia prima, insumo y reventa", () => {
    for (const c of CLASES_COMPRABLES) expect(esClaseComprable(c)).toBe(true);
    expect(CLASES_COMPRABLES).toEqual(["MATERIA_PRIMA", "INSUMO", "REVENTA"]);
  });
  it("rechaza elaborado, vendible y cualquier otra cosa", () => {
    for (const c of ["ELABORADO", "VENDIBLE", "", "materia_prima", "MATERIA_PRIMA "]) {
      expect(esClaseComprable(c)).toBe(false);
    }
  });
});
