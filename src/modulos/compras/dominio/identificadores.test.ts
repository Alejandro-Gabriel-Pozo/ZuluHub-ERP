import { describe, expect, it } from "vitest";
import { esUuid } from "./identificadores";

describe("esUuid", () => {
  it("acepta un uuid en minúscula o mayúscula", () => {
    expect(esUuid("0b0c3a62-4f6e-4a53-9a43-0d3cde7a90aa")).toBe(true);
    expect(esUuid("0B0C3A62-4F6E-4A53-9A43-0D3CDE7A90AA")).toBe(true);
  });
  it("rechaza lo que no es un uuid completo", () => {
    for (const t of [
      "",
      "x",
      "0b0c3a62-4f6e-4a53-9a43-0d3cde7a90a",
      "0b0c3a62-4f6e-4a53-9a43-0d3cde7a90aaa",
      " 0b0c3a62-4f6e-4a53-9a43-0d3cde7a90aa",
      "0b0c3a62-4f6e-4a53-9a43-0d3cde7a90aa\n",
      "zb0c3a62-4f6e-4a53-9a43-0d3cde7a90aa",
    ]) {
      expect(esUuid(t)).toBe(false);
    }
  });
});
