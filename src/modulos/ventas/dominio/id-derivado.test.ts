import { describe, expect, it } from "vitest";
import { esUuid } from "./identificadores";
import { idDerivado } from "./id-derivado";

describe("idDerivado", () => {
  it("es un uuid v5-like, estable, y cambia con el propósito o con cualquier parte", () => {
    const id = idDerivado("cobranza", "e", "k");
    expect(esUuid(id)).toBe(true);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(idDerivado("cobranza", "e", "k")).toBe(id);
    expect(idDerivado("otra", "e", "k")).not.toBe(id);
    expect(idDerivado("cobranza", "x", "k")).not.toBe(id);
    expect(idDerivado("cobranza", "e", "x")).not.toBe(id);
  });
  it("no confunde partes contiguas", () => {
    expect(idDerivado("p", "ab", "c")).not.toBe(idDerivado("p", "a", "bc"));
  });
});
