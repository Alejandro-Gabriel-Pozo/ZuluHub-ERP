import { describe, expect, it } from "vitest";
import { esPozoAgotado, traducirErrorDeBase } from "./errores";

/** El pozo agotado sale tipado (no como excepción cruda), sin detalle técnico; lo demás que no es de la base sigue sin traducirse. */
describe("pozo agotado", () => {
  it("el rechazo de `pg-pool` por espera agotada se reconoce y se traduce a un error inesperado sin sqlstate", () => {
    const error = new Error("timeout exceeded when trying to connect");
    expect(esPozoAgotado(error)).toBe(true);
    expect(traducirErrorDeBase(error)).toEqual({
      tipo: "Inesperado",
      sqlstate: null,
      mensaje: "no hubo una conexión libre a la base a tiempo (pozo agotado)",
    });
  });

  it("otras excepciones no se confunden con un pozo agotado ni se traducen", () => {
    for (const otro of [
      new Error("timeout exceeded"),
      new Error("Timeout exceeded when trying to connect"),
      new RangeError("timeout exceeded when trying to connect "),
      "timeout exceeded when trying to connect",
      null,
    ]) {
      expect(esPozoAgotado(otro)).toBe(false);
      expect(traducirErrorDeBase(otro)).toBeNull();
    }
  });
});
