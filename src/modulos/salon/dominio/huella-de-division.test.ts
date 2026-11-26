import { describe, expect, it } from "vitest";
import type { Asignacion } from "../../../primitivas/cuentas/division";
import { huellaDeDivision } from "./huella-de-division";

describe("huellaDeDivision", () => {
  const a: Asignacion[] = [
    { lineaId: "a", forma: "ENTERO", parte: 1 },
    { lineaId: "b", forma: "COMPARTIDO", partes: [2, 1] },
  ];
  it("no depende del orden de las asignaciones ni de las partes, y cambia con el contenido", () => {
    const h = huellaDeDivision({ cuentaId: "c", partes: 2, asignaciones: a });
    expect(huellaDeDivision({ cuentaId: "c", partes: 2, asignaciones: [...a].reverse() })).toBe(h);
    expect(
      huellaDeDivision({
        cuentaId: "c",
        partes: 2,
        asignaciones: [a[0] as Asignacion, { lineaId: "b", forma: "COMPARTIDO", partes: [1, 2] }],
      }),
    ).toBe(h);
    expect(huellaDeDivision({ cuentaId: "c", partes: 3, asignaciones: a })).not.toBe(h);
    expect(huellaDeDivision({ cuentaId: "d", partes: 2, asignaciones: a })).not.toBe(h);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});
