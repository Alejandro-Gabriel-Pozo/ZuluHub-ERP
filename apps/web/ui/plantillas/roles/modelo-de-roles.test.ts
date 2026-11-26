import { describe, expect, it } from "vitest";
import { textoDeLaAccion } from "./modelo-de-roles";

describe("textoDeLaAccion", () => {
  it("da el nombre aprobado de una acción del catálogo", () => {
    expect(textoDeLaAccion({}, "usuarios.invitar")).toBe("Invitar usuarios");
  });

  it("una acción sin nombre falla en vez de mostrar el id", () => {
    expect(() => textoDeLaAccion({}, "no.existe")).toThrow(RangeError);
  });
});
