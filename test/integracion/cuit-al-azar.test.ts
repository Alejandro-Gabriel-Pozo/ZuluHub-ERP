import { describe, expect, it } from "vitest";
import { cuitDesdeTexto } from "../../src/primitivas/identificacion-fiscal/cuit";
import { cuitAlAzar } from "./entorno";

/**
 * `cuitAlAzar()` no repite dentro de una corrida y siempre da un CUIT válido. Falla que previene: el sorteo puro repetía un CUIT de
 * vez en cuando (con 100 000 llamadas el sorteo viejo repetía el 97 % de las veces) y la unicidad de la base hacía fallar «Estabilidad» (#191).
 */
describe("cuitAlAzar", () => {
  it("100 000 llamadas seguidas: todos distintos y todos válidos", () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 100_000; i++) {
      const cuit = cuitAlAzar();
      expect(cuitDesdeTexto(String(cuit)).ok).toBe(true);
      vistos.add(String(cuit));
    }
    expect(vistos.size).toBe(100_000);
  });
});
