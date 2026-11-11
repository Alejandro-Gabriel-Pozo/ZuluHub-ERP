import { describe, expect, it } from "vitest";
import { analizarArbolDeRecetas, MAXIMO_DE_NIVELES_DE_RECETA } from "./subcomposicion";

const recetas = (o: Record<string, string[]>) => new Map(Object.entries(o));

describe("árbol de recetas: ciclos y niveles", () => {
  it("la receta propia es el nivel 1", () => {
    expect(analizarArbolDeRecetas("A", recetas({ A: [] }))).toEqual({ ok: true, valor: 1 });
    expect(analizarArbolDeRecetas("A", recetas({}))).toEqual({ ok: true, valor: 1 });
    expect(analizarArbolDeRecetas("A", recetas({ A: ["B"], B: [] }))).toEqual({
      ok: true,
      valor: 2,
    });
  });
  it("cinco niveles pasan y seis son demasiado", () => {
    expect(MAXIMO_DE_NIVELES_DE_RECETA).toBe(5);
    const cadena = (n: number) =>
      recetas(
        Object.fromEntries(
          Array.from({ length: n }, (_, i) => [`P${i}`, i + 1 < n ? [`P${i + 1}`] : []]),
        ),
      );
    expect(analizarArbolDeRecetas("P0", cadena(5))).toEqual({ ok: true, valor: 5 });
    expect(analizarArbolDeRecetas("P0", cadena(6))).toEqual({
      ok: false,
      error: { codigo: "RECETA_DEMASIADO_ANIDADA" },
    });
  });
  it("cuenta el camino más largo, no la suma de las ramas", () => {
    expect(analizarArbolDeRecetas("A", recetas({ A: ["B", "C"], B: ["D"], C: [], D: [] }))).toEqual(
      { ok: true, valor: 3 },
    );
    // el rombo (dos caminos al mismo hijo) no es un ciclo
    expect(analizarArbolDeRecetas("A", recetas({ A: ["B", "C"], B: ["D"], C: ["D"] }))).toEqual({
      ok: true,
      valor: 3,
    });
  });
  it("no revisa dos veces el mismo producto (el rombo se calcula una vez)", () => {
    const pedidos: string[] = [];
    const mapa = new Map(Object.entries({ A: ["B", "C"], B: ["D"], C: ["D"], D: ["E"], E: [] }));
    const contador = {
      get: (k: string) => {
        pedidos.push(k);
        return mapa.get(k);
      },
    } as unknown as ReadonlyMap<string, readonly string[]>;
    expect(analizarArbolDeRecetas("A", contador)).toEqual({ ok: true, valor: 4 });
    expect(pedidos.filter((p) => p === "D")).toHaveLength(1);
    expect(pedidos.filter((p) => p === "E")).toHaveLength(1);
  });
  it("informa el primer ciclo que encuentra y no lo pisa con otro", () => {
    expect(analizarArbolDeRecetas("A", recetas({ A: ["B", "C"], B: ["A"], C: ["A"] }))).toEqual({
      ok: false,
      error: { codigo: "CICLO_EN_LA_RECETA", camino: ["A", "B", "A"] },
    });
  });
  it("un ciclo directo, indirecto o sobre sí mismo se rechaza con su camino", () => {
    expect(analizarArbolDeRecetas("A", recetas({ A: ["A"] }))).toEqual({
      ok: false,
      error: { codigo: "CICLO_EN_LA_RECETA", camino: ["A", "A"] },
    });
    expect(analizarArbolDeRecetas("A", recetas({ A: ["B"], B: ["A"] }))).toEqual({
      ok: false,
      error: { codigo: "CICLO_EN_LA_RECETA", camino: ["A", "B", "A"] },
    });
    expect(analizarArbolDeRecetas("A", recetas({ A: ["B"], B: ["C"], C: ["B"] }))).toEqual({
      ok: false,
      error: { codigo: "CICLO_EN_LA_RECETA", camino: ["B", "C", "B"] },
    });
  });
});
