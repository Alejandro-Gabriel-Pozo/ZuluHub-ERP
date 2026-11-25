import { describe, expect, it } from "vitest";
import { comoPrefijo } from "./como-prefijo";

describe("comoPrefijo", () => {
  it("agrega el comodín final y deja intacto un texto común", () => {
    expect(comoPrefijo("harina")).toBe("harina%");
    expect(comoPrefijo("")).toBe("%");
  });

  it("escapa %, _ y la barra, todas las veces que aparecen", () => {
    expect(comoPrefijo("50%")).toBe("50\\%%");
    expect(comoPrefijo("a_b_c")).toBe("a\\_b\\_c%");
    expect(comoPrefijo("a\\b")).toBe("a\\\\b%");
    expect(comoPrefijo("%_\\")).toBe("\\%\\_\\\\%");
  });
});
