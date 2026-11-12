import { describe, expect, it } from "vitest";
import { completarConsumos, mermaDeLote, recetaCambiada } from "./esperados";

const esp = [
  { articuloId: "harina", composicionId: "r1", unidades: 60_000n },
  { articuloId: "sal", composicionId: "r1", unidades: 100n },
];
describe("consumos reales del cierre", () => {
  it("completa en el orden de los esperados; lo que no viene queda en cero", () => {
    expect(
      completarConsumos(esp, [{ articuloId: "harina", composicionId: "r1", unidades: 61_000n }]),
    ).toEqual({
      ok: true,
      valor: [
        { articuloId: "harina", composicionId: "r1", unidades: 61_000n },
        { articuloId: "sal", composicionId: "r1", unidades: 0n },
      ],
    });
  });
  it("cero es válido; negativo, repetido o fuera de la orden no", () => {
    expect(
      completarConsumos(esp, [{ articuloId: "sal", composicionId: "r1", unidades: 0n }]).ok,
    ).toBe(true);
    expect(
      completarConsumos(esp, [{ articuloId: "sal", composicionId: "r1", unidades: -1n }]),
    ).toEqual({ ok: false, error: "CANTIDAD_INVALIDA" });
    expect(
      completarConsumos(esp, [{ articuloId: "azucar", composicionId: "r1", unidades: 1n }]),
    ).toEqual({ ok: false, error: "CONSUMO_FUERA_DE_LA_ORDEN" });
    expect(
      completarConsumos(esp, [{ articuloId: "sal", composicionId: "r2", unidades: 1n }]),
    ).toEqual({ ok: false, error: "CONSUMO_FUERA_DE_LA_ORDEN" });
    const dos = { articuloId: "sal", composicionId: "r1", unidades: 1n };
    expect(completarConsumos(esp, [dos, dos])).toEqual({ ok: false, error: "CONSUMO_REPETIDO" });
  });
  it("merma de lote y receta cambiada", () => {
    expect(mermaDeLote(100n, 90n)).toBe(10n);
    expect(mermaDeLote(100n, 110n)).toBe(-10n);
    expect(recetaCambiada(1, 2)).toBe(true);
    expect(recetaCambiada(2, 2)).toBe(false);
    expect(recetaCambiada(3, 2)).toBe(false);
  });
});
