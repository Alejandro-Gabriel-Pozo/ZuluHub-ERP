import { describe, expect, it } from "vitest";
import { cuitDesdeTexto } from "../../src/primitivas/identificacion-fiscal/cuit";
import { cuitUnico } from "./entorno";

/**
 * `cuitUnico()` no repite dentro de una corrida y siempre da un CUIT válido. Falla que previene: el sorteo puro repetía un CUIT de
 * vez en cuando (con 100 000 llamadas el sorteo viejo repetía el 97 % de las veces) y la unicidad de la base hacía fallar «Estabilidad» (#191).
 */
describe("cuitUnico", () => {
  it("40 000 llamadas seguidas: todos distintos y todos válidos", () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 40_000; i++) {
      const cuit = cuitUnico();
      expect(cuitDesdeTexto(String(cuit)).ok).toBe(true);
      vistos.add(String(cuit));
    }
    expect(vistos.size).toBe(40_000);
  });
});
