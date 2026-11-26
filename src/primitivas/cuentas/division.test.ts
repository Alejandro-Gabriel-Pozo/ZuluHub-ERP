import { describe, expect, it } from "vitest";
import { MAXIMO_DE_CUENTAS_POR_ITEMS } from "./limites-de-division";
import {
  cantidadPorPasos,
  cierraExactoPorPaso,
  pasosDeLaLinea,
  planDeDivision,
  totalesDeLaDivision,
  type Asignacion,
  type LineaADividir,
} from "./division";

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

describe("totalesDeLaDivision (lo que muestra la pantalla)", () => {
  const lineas = [linea("g", "3", "1000"), linea("p", "1", "3001")];
  const asignaciones: Asignacion[] = [
    { lineaId: "g", forma: "POR_UNIDADES", cantidades: ["1", "1", "1"] },
    { lineaId: "p", forma: "COMPARTIDO", partes: [1, 2, 3] },
  ];
  const totales = (a: Asignacion[], partes = 3, l = lineas) => {
    const plan = planDeDivision({ partes, lineas: l, asignaciones: a });
    return plan.ok ? totalesDeLaDivision(partes, l, plan.valor) : null;
  };

  it("3 gaseosas y un plato entre 3: el centavo que sobra va a la Cuenta 1 y la suma es el total", () => {
    expect(totales(asignaciones)).toEqual(["2000.34", "2000.33", "2000.33"]);
  });

  it("una línea entera a una cuenta y precio con decimales: redondea como el servidor", () => {
    const l = [linea("a", "3", "33.333333"), linea("b", "1", "10")];
    expect(
      totales(
        [
          { lineaId: "a", forma: "ENTERO", parte: 2 },
          { lineaId: "b", forma: "ENTERO", parte: 1 },
        ],
        2,
        l,
      ),
    ).toEqual(["10.00", "100.00"]);
  });

  it("un plan con una línea que no existe no da totales a medias", () => {
    expect(
      totalesDeLaDivision(2, lineas, [
        { lineaOrigenId: "x", parte: 1, modo: "COMPLETA", cantidad: "1" },
      ]),
    ).toBeNull();
  });
});

describe("pasosDeLaLinea y cantidadPorPasos (dividir por unidades)", () => {
  it("cuenta los pasos de la línea y arma la cantidad de N pasos sin pasar por number", () => {
    expect(pasosDeLaLinea("3", "1")).toBe(3);
    expect(pasosDeLaLinea("1.5", "0.5")).toBe(3);
    expect(pasosDeLaLinea("2.5", "1")).toBeNull();
    expect(pasosDeLaLinea("3", "0")).toBeNull();
    expect(pasosDeLaLinea("tres", "1")).toBeNull();
    expect(cantidadPorPasos("0.5", 3)).toBe(cantidadPorPasos("1.5", 1));
    expect(cantidadPorPasos("1", 0)).toBe(cantidadPorPasos("0", 1));
    expect(cantidadPorPasos("1", -1)).toBeNull();
    expect(cantidadPorPasos("x", 1)).toBeNull();
  });
});

describe("«Por unidades» solo con precio × paso exacto en centavos (SAL-E4, DEC-SAL-010)", () => {
  it("cierraExactoPorPaso: exacto cuando precio × paso es un número entero de centavos; no se lee, no cierra", () => {
    expect(cierraExactoPorPaso("1000.00", "0.5")).toBe(true); // 500,00 por paso
    expect(cierraExactoPorPaso("1000.01", "0.5")).toBe(false); // 500,005
    expect(cierraExactoPorPaso("1000.02", "0.5")).toBe(true); // 500,01
    expect(cierraExactoPorPaso("333.33", "0.5")).toBe(false); // 166,665
    expect(cierraExactoPorPaso("100.50", "1")).toBe(true);
    expect(cierraExactoPorPaso("100.505", "1")).toBe(false); // un precio de 3 decimales
    expect(cierraExactoPorPaso("14000.00", "0.001")).toBe(true); // el kilo a $ 14.000 en pasos de 1 g
    expect(cierraExactoPorPaso("14000.01", "0.001")).toBe(false);
    expect(cierraExactoPorPaso("no", "1")).toBe(false);
    expect(cierraExactoPorPaso("100", "no")).toBe(false);
  });

  it("2 kg de helado a $ 1.000,01 (paso 0,5) repartidos en 0,5 y 1,5: se rechaza (las cuentas sumarían $ 2.000,03 y la línea vale $ 2.000,02)", () => {
    const helado = linea("h", "2", "1000.01", "0.5");
    const r = planDeDivision({
      partes: 2,
      lineas: [helado],
      asignaciones: [{ lineaId: "h", forma: "POR_UNIDADES", cantidades: ["0.5", "1.5"] }],
    });
    expect(r).toEqual({ ok: false, error: "UNIDADES_NO_SUMAN" });
  });

  it("la misma línea a $ 1.000,01 sí se puede dar ENTERA o COMPARTIDA, y la suma de las cuentas es exacta", () => {
    const helado = linea("h", "2", "1000.01", "0.5");
    const entera = planDeDivision({
      partes: 2,
      lineas: [helado, linea("x", "1", "10")],
      asignaciones: [
        { lineaId: "h", forma: "ENTERO", parte: 1 },
        { lineaId: "x", forma: "ENTERO", parte: 2 },
      ],
    });
    expect(entera.ok).toBe(true);
    const compartida = planDeDivision({
      partes: 2,
      lineas: [helado],
      asignaciones: [{ lineaId: "h", forma: "COMPARTIDO", partes: [1, 2] }],
    });
    expect(compartida.ok).toBe(true);
    if (!compartida.ok) return;
    // La línea vale 2 × 1000,01 = 2000,02: 1000,01 + 1000,01.
    expect(totalesDeLaDivision(2, [helado], compartida.valor)).toEqual(["1000.01", "1000.01"]);
  });

  it("todas las unidades a UNA sola cuenta es pasar la línea entera: no se rechaza aunque el precio no cierre por paso", () => {
    const helado = linea("h", "2", "1000.01", "0.5");
    const r = planDeDivision({
      partes: 2,
      lineas: [helado, linea("x", "1", "10")],
      asignaciones: [
        { lineaId: "h", forma: "POR_UNIDADES", cantidades: ["2", "0"] },
        { lineaId: "x", forma: "ENTERO", parte: 2 },
      ],
    });
    expect(r.ok && r.valor[0]).toMatchObject({ lineaOrigenId: "h", parte: 1, modo: "COMPLETA" });
  });

  it("2 kg a $ 1.000,00 (paso 0,5): se reparte por unidades y las cuentas suman exacto la línea, en cualquier reparto", () => {
    const helado = linea("h", "2", "1000.00", "0.5");
    for (const cantidades of [
      ["0.5", "1.5"],
      ["1", "1"],
      ["1.5", "0.5"],
    ]) {
      const r = planDeDivision({
        partes: 2,
        lineas: [helado],
        asignaciones: [{ lineaId: "h", forma: "POR_UNIDADES", cantidades }],
      });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const totales = totalesDeLaDivision(2, [helado], r.valor) as readonly string[];
      expect(totales.reduce((suma, t) => suma + BigInt(t.replace(".", "")), 0n)).toBe(200000n);
    }
  });

  it("media pizza (cantidad 0,5, paso 0,5) a $ 1.000,01: Entero a una cuenta o Compartido entre dos, con el centavo a la Cuenta 1 y suma exacta", () => {
    const media = linea("m", "0.5", "1000.01", "0.5");
    const compartida = planDeDivision({
      partes: 2,
      lineas: [media],
      asignaciones: [{ lineaId: "m", forma: "COMPARTIDO", partes: [1, 2] }],
    });
    expect(compartida.ok).toBe(true);
    if (!compartida.ok) return;
    // 0,5 × 1000,01 = 500,005 → 500,01 (mitad hacia arriba): 250,01 para la Cuenta 1 y 250,00 para la 2.
    expect(totalesDeLaDivision(2, [media], compartida.valor)).toEqual(["250.01", "250.00"]);
    const entera = planDeDivision({
      partes: 2,
      lineas: [media, linea("x", "1", "10")],
      asignaciones: [
        { lineaId: "m", forma: "ENTERO", parte: 2 },
        { lineaId: "x", forma: "ENTERO", parte: 1 },
      ],
    });
    expect(entera.ok).toBe(true);
    if (!entera.ok) return;
    expect(totalesDeLaDivision(2, [media, linea("x", "1", "10")], entera.valor)).toEqual([
      "10.00",
      "500.01",
    ]);
  });
});
