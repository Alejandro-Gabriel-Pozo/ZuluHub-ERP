import { describe, expect, it } from "vitest";
import { cantidadDesdeTexto } from "../../primitivas/cantidad/cantidad";
import { REGLA_DE_CANTIDAD } from "./cantidad-tipeada";
import { escribirNumero } from "./numero-argentino";

describe("REGLA_DE_CANTIDAD", () => {
  it("son los límites de la primitiva: 4 decimales y 14 enteros, sin completar con ceros", () => {
    expect(REGLA_DE_CANTIDAD).toEqual({ decimales: 4, enterosMaximos: 14 });
  });

  it("lo más grande que el campo deja escribir lo acepta la primitiva, y el campo no deja pasar de ahí", () => {
    const maximo = `${"9".repeat(14)},${"9".repeat(4)}`;
    const escrito = escribirNumero(maximo, maximo.length, REGLA_DE_CANTIDAD);
    expect(escrito.canonico).toBe(`${"9".repeat(14)}.${"9".repeat(4)}`);
    expect(() => cantidadDesdeTexto(escrito.canonico)).not.toThrow();
    const demas = escribirNumero(`${maximo}9`, maximo.length + 1, REGLA_DE_CANTIDAD);
    expect(demas.canonico).toBe(escrito.canonico);
  });

  it("una coma decimal se interpreta y el canónico no se rellena", () => {
    expect(escribirNumero("1,5", 3, REGLA_DE_CANTIDAD).canonico).toBe("1.5");
    expect(escribirNumero("2", 1, REGLA_DE_CANTIDAD).canonico).toBe("2");
  });
});
