import { describe, expect, it } from "vitest";
import {
  disponibleDeLotes,
  diferenciasDeApertura,
  situacionDeVencimiento,
  type LoteConExistencia,
} from "./vencimientos";

const hoy = "2026-11-10";
const lote = (existencia: bigint, calidad: LoteConExistencia["calidad"], vence: string | null) => ({
  existencia,
  calidad,
  vence,
});

describe("disponibleDeLotes", () => {
  it("suma solo lo disponible: sin calidad o liberado, no vencido (vence hoy cuenta)", () => {
    expect(
      disponibleDeLotes(
        [
          lote(10_000n, null, null),
          lote(20_000n, "LIBERADO", hoy),
          lote(40_000n, "EN_CUARENTENA", null),
          lote(80_000n, "EN_REVISION", null),
          lote(160_000n, "RECHAZADO", null),
          lote(320_000n, null, "2026-11-09"),
        ],
        hoy,
      ),
    ).toBe(30_000n);
  });
  it("una existencia negativa o cero no resta ni suma; sin lotes es cero", () => {
    expect(disponibleDeLotes([lote(-50_000n, null, null), lote(0n, null, null)], hoy)).toBe(0n);
    expect(disponibleDeLotes([lote(-50_000n, null, null), lote(10_000n, null, null)], hoy)).toBe(
      10_000n,
    );
    expect(disponibleDeLotes([], hoy)).toBe(0n);
  });
});

describe("diferenciasDeApertura", () => {
  it("lleva al «sin asignar» lo que el libro tiene y los lotes no suman, por depósito y en orden; lo que ya cierra no figura", () => {
    const libro = new Map([
      ["b", 50_000n],
      ["a", 30_000n],
      ["c", -20_000n],
      ["d", 10_000n],
    ]);
    const lotes = new Map([
      ["d", 10_000n],
      ["a", 10_000n],
      ["e", 5_000n],
    ]);
    expect(diferenciasDeApertura(libro, lotes)).toEqual([
      { depositoId: "a", unidades: 20_000n },
      { depositoId: "b", unidades: 50_000n },
      { depositoId: "c", unidades: -20_000n },
      { depositoId: "e", unidades: -5_000n },
    ]);
    expect(diferenciasDeApertura(new Map(), new Map())).toEqual([]);
  });
});

describe("situacionDeVencimiento", () => {
  it("vencido con sus jornadas de atraso, vence hoy y por vencer dentro del horizonte; fuera o sin fecha, nada", () => {
    expect(situacionDeVencimiento("2026-11-08", hoy, 7)).toEqual({ tipo: "VENCIDO", dias: 2 });
    expect(situacionDeVencimiento(hoy, hoy, 7)).toEqual({ tipo: "VENCE_HOY" });
    expect(situacionDeVencimiento("2026-11-13", hoy, 7)).toEqual({ tipo: "POR_VENCER", dias: 3 });
    expect(situacionDeVencimiento("2026-11-17", hoy, 7)).toEqual({ tipo: "POR_VENCER", dias: 7 });
    expect(situacionDeVencimiento("2026-11-18", hoy, 7)).toBeNull();
    expect(situacionDeVencimiento(null, hoy, 7)).toBeNull();
    expect(situacionDeVencimiento("2026-11-11", hoy, 0)).toBeNull();
  });
});
