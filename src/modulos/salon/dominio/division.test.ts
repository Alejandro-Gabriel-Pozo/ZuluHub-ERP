import { describe, expect, it } from "vitest";
import { MAXIMO_DE_CUENTAS_POR_ITEMS } from "../../../primitivas/cuentas/limites-de-division";
import { huellaDeDivision, planDeDivision, type Asignacion, type LineaADividir } from "./division";

const linea = (
  lineaId: string,
  cantidad: string,
  precioUnitario: string,
  paso = "1",
): LineaADividir => ({
  lineaId,
  cantidad,
  pasoDeCantidad: paso,
  precioUnitario,
});

describe("planDeDivision", () => {
  it("3 gaseosas y un plato entre 3: unidades repartidas y el plato compartido con el centavo a la Cuenta 1", () => {
    const r = planDeDivision({
      partes: 3,
      lineas: [linea("gaseosa", "3", "1000"), linea("plato", "1", "100")],
      asignaciones: [
        { lineaId: "gaseosa", forma: "POR_UNIDADES", cantidades: ["1", "1", "1"] },
        { lineaId: "plato", forma: "COMPARTIDO", partes: [1, 2, 3] },
      ],
    });
    expect(r).toEqual({
      ok: true,
      valor: [
        { lineaOrigenId: "gaseosa", parte: 1, modo: "POR_UNIDADES", cantidad: "1.0000" },
        { lineaOrigenId: "gaseosa", parte: 2, modo: "POR_UNIDADES", cantidad: "1.0000" },
        { lineaOrigenId: "gaseosa", parte: 3, modo: "POR_UNIDADES", cantidad: "1.0000" },
        {
          lineaOrigenId: "plato",
          parte: 1,
          modo: "COMPARTIDA",
          cantidad: "1.0000",
          importeFijo: "33.34",
        },
        {
          lineaOrigenId: "plato",
          parte: 2,
          modo: "COMPARTIDA",
          cantidad: "1.0000",
          importeFijo: "33.33",
        },
        {
          lineaOrigenId: "plato",
          parte: 3,
          modo: "COMPARTIDA",
          cantidad: "1.0000",
          importeFijo: "33.33",
        },
      ],
    });
  });

  it("entero: la línea completa va a una cuenta", () => {
    const r = planDeDivision({
      partes: 2,
      lineas: [linea("a", "2", "10"), linea("b", "1", "5")],
      asignaciones: [
        { lineaId: "a", forma: "ENTERO", parte: 1 },
        { lineaId: "b", forma: "ENTERO", parte: 2 },
      ],
    });
    expect(r).toEqual({
      ok: true,
      valor: [
        { lineaOrigenId: "a", parte: 1, modo: "COMPLETA", cantidad: "2.0000" },
        { lineaOrigenId: "b", parte: 2, modo: "COMPLETA", cantidad: "1.0000" },
      ],
    });
  });

  it("el importe compartido se redondea una vez (mitad hacia arriba) antes de repartir", () => {
    // 0,5 × 9,95 = 4,975 → 4,98; entre dos: 2,49 y 2,49
    const r = planDeDivision({
      partes: 2,
      lineas: [linea("a", "0.5", "9.95", "0.5")],
      asignaciones: [{ lineaId: "a", forma: "COMPARTIDO", partes: [1, 2] }],
    });
    expect(r.ok && r.valor.map((c) => c.importeFijo)).toEqual(["2.49", "2.49"]);
  });

  const base = { partes: 2, lineas: [linea("a", "2", "10")] };
  const caso = (asignaciones: Asignacion[], partes = 2) =>
    planDeDivision({ ...base, partes, asignaciones });

  it("rechaza lo incompleto, repetido o ajeno", () => {
    const error = (e: string) => ({ ok: false, error: e });
    expect(caso([])).toEqual(error("DIVISION_INCOMPLETA"));
    expect(caso([{ lineaId: "x", forma: "ENTERO", parte: 1 }])).toEqual(
      error("DIVISION_INCOMPLETA"),
    );
    expect(
      caso([
        { lineaId: "a", forma: "ENTERO", parte: 1 },
        { lineaId: "a", forma: "ENTERO", parte: 2 },
      ]),
    ).toEqual(error("DIVISION_INCOMPLETA"));
  });
  it("rechaza partes fuera de 2 al máximo y cuentas fuera de rango", () => {
    expect(caso([{ lineaId: "a", forma: "ENTERO", parte: 1 }], 1)).toEqual({
      ok: false,
      error: "PARTES_INVALIDAS",
    });
    expect(
      caso([{ lineaId: "a", forma: "ENTERO", parte: 1 }], MAXIMO_DE_CUENTAS_POR_ITEMS + 1),
    ).toEqual({
      ok: false,
      error: "PARTES_INVALIDAS",
    });
    expect(caso([{ lineaId: "a", forma: "ENTERO", parte: 3 }])).toEqual({
      ok: false,
      error: "PARTES_INVALIDAS",
    });
    expect(caso([{ lineaId: "a", forma: "COMPARTIDO", partes: [1] }])).toEqual({
      ok: false,
      error: "PARTES_INVALIDAS",
    });
  });
  it("ninguna cuenta queda vacía", () => {
    expect(caso([{ lineaId: "a", forma: "ENTERO", parte: 1 }])).toEqual({
      ok: false,
      error: "PARTE_VACIA",
    });
  });
  it("las unidades suman la cantidad y cada una es múltiplo del paso", () => {
    expect(caso([{ lineaId: "a", forma: "POR_UNIDADES", cantidades: ["1", "2"] }])).toEqual({
      ok: false,
      error: "UNIDADES_NO_SUMAN",
    });
    expect(caso([{ lineaId: "a", forma: "POR_UNIDADES", cantidades: ["1"] }])).toEqual({
      ok: false,
      error: "UNIDADES_NO_SUMAN",
    });
    const medio = planDeDivision({
      partes: 2,
      lineas: [linea("a", "1", "10", "1")],
      asignaciones: [{ lineaId: "a", forma: "POR_UNIDADES", cantidades: ["0.5", "0.5"] }],
    });
    expect(medio).toEqual({ ok: false, error: "UNIDADES_NO_SUMAN" });
    expect(caso([{ lineaId: "a", forma: "POR_UNIDADES", cantidades: ["x", "2"] }])).toEqual({
      ok: false,
      error: "CANTIDAD_INVALIDA",
    });
  });
});

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

describe("planDeDivision: todas las unidades a una sola cuenta", () => {
  it("es pasar la línea entera (COMPLETA), no un reparto por unidades de una sola parte", () => {
    const r = planDeDivision({
      partes: 2,
      lineas: [
        { lineaId: "a", cantidad: "3", pasoDeCantidad: "1", precioUnitario: "100" },
        { lineaId: "b", cantidad: "1", pasoDeCantidad: "1", precioUnitario: "50" },
      ],
      asignaciones: [
        { lineaId: "a", forma: "POR_UNIDADES", cantidades: ["3", "0"] },
        { lineaId: "b", forma: "ENTERO", parte: 2 },
      ],
    });
    expect(r).toEqual({
      ok: true,
      valor: [
        { lineaOrigenId: "a", parte: 1, modo: "COMPLETA", cantidad: "3.0000" },
        { lineaOrigenId: "b", parte: 2, modo: "COMPLETA", cantidad: "1.0000" },
      ],
    });
  });
});
