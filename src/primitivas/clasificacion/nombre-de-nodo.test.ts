import { describe, expect, it } from "vitest";
import { LARGO_MAXIMO_DEL_NOMBRE_DE_NODO, nombreDeNodoDesdeTexto } from "./nombre-de-nodo";

describe("nombre de un nodo de la clasificación", () => {
  it("el largo máximo es 80", () => {
    expect(LARGO_MAXIMO_DEL_NOMBRE_DE_NODO).toBe(80);
  });

  it("acepta un nombre usual y recorta los extremos", () => {
    expect(nombreDeNodoDesdeTexto("  Restaurante ")).toEqual({ ok: true, valor: "Restaurante" });
    expect(nombreDeNodoDesdeTexto("Bebidas sin alcohol")).toEqual({
      ok: true,
      valor: "Bebidas sin alcohol",
    });
  });

  it("justo 80 pasa, 81 no", () => {
    const justo = "a".repeat(80);
    expect(nombreDeNodoDesdeTexto(justo)).toEqual({ ok: true, valor: justo });
    expect(nombreDeNodoDesdeTexto(justo + "a")).toEqual({ ok: false, error: "DEMASIADO_LARGO" });
  });

  it("rechaza vacío y lo que ningún nombre puede tener", () => {
    expect(nombreDeNodoDesdeTexto("")).toEqual({ ok: false, error: "VACIO" });
    for (const t of ["a\nb", "a<b", "a😀", "+a"]) {
      expect(nombreDeNodoDesdeTexto(t)).toEqual({ ok: false, error: "CARACTER_PROHIBIDO" });
    }
  });
});
