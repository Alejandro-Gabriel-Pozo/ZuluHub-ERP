import { describe, expect, it } from "vitest";
import { celdasDeMesa } from "./celdas";
import { huellaDeDivision, planDeDivision, type Asignacion, type LineaADividir } from "./division";
import { posicionDeMesa } from "./mesa";
import { repartirEnPartesIguales, repartirItemCompartido, repartirPorPorcentaje } from "./reparto";

/**
 * Cada rechazo y cada desempate del dominio del salón, uno por uno: una rama de validación que ninguna prueba aísla es una regla que alguien puede
 * quitar sin que nada falle (mutación al 100 %). Los casos buscan que cada condición sea la ÚNICA que decide el resultado.
 */
const linea = (
  lineaId: string,
  cantidad: string,
  precioUnitario: string,
  pasoDeCantidad = "1",
): LineaADividir => ({ lineaId, cantidad, pasoDeCantidad, precioUnitario });
const entero = (lineaId: string, parte: number): Asignacion => ({
  lineaId,
  forma: "ENTERO",
  parte,
});
const error = (r: { ok: boolean; error?: unknown }) => (r.ok ? "ok" : r.error);

/** Un valor cuya lectura revienta con un error que NO es de valor: ningún `catch` lo puede confundir con «texto inválido». */
const explota = {
  toString(): string {
    throw new RangeError("falla ajena al dato");
  },
} as unknown as string;

describe("celdas y posición de la mesa", () => {
  it("una esquina fuera del plano se rechaza antes de mirar el tamaño", () => {
    expect(error(celdasDeMesa({ forma: "CUADRADA", tamano: "CHICA", columna: 0, fila: 1 }))).toBe(
      "MESA_FUERA_DEL_SALON",
    );
  });
  it("la posición válida devuelve exactamente columna y fila", () => {
    expect(posicionDeMesa({ columna: 3, fila: 4 })).toEqual({
      ok: true,
      valor: { columna: 3, fila: 4 },
    });
  });
});

describe("planDeDivision: cada rechazo por separado", () => {
  const una = [linea("a", "2", "10")];
  it("partes: 4 se acepta y 5 no", () => {
    const lineas = [
      linea("a", "1", "10"),
      linea("b", "1", "10"),
      linea("c", "1", "10"),
      linea("d", "1", "10"),
    ];
    const asignaciones = [entero("a", 1), entero("b", 2), entero("c", 3), entero("d", 4)];
    expect(error(planDeDivision({ partes: 4, lineas, asignaciones }))).toBe("ok");
    expect(error(planDeDivision({ partes: 5, lineas, asignaciones }))).toBe("PARTES_INVALIDAS");
  });
  it("sin líneas no hay qué dividir", () => {
    expect(error(planDeDivision({ partes: 2, lineas: [], asignaciones: [] }))).toBe(
      "DIVISION_INCOMPLETA",
    );
  });
  it("dos líneas con el mismo id", () => {
    const lineas = [linea("a", "1", "10"), linea("a", "1", "10")];
    expect(
      error(planDeDivision({ partes: 2, lineas, asignaciones: [entero("a", 1), entero("a", 2)] })),
    ).toBe("DIVISION_INCOMPLETA");
  });
  it("una asignación de más o de menos", () => {
    const lineas = [linea("a", "1", "10"), linea("b", "1", "10")];
    expect(
      error(
        planDeDivision({
          partes: 2,
          lineas,
          asignaciones: [entero("a", 1), entero("b", 2), entero("a", 2)],
        }),
      ),
    ).toBe("DIVISION_INCOMPLETA");
    expect(error(planDeDivision({ partes: 2, lineas, asignaciones: [entero("a", 1)] }))).toBe(
      "DIVISION_INCOMPLETA",
    );
  });
  it("una asignación repetida o ajena deja otra línea sin asignar", () => {
    const lineas = [linea("a", "1", "10"), linea("b", "1", "10")];
    expect(
      error(planDeDivision({ partes: 2, lineas, asignaciones: [entero("a", 1), entero("a", 2)] })),
    ).toBe("DIVISION_INCOMPLETA");
    expect(
      error(planDeDivision({ partes: 2, lineas, asignaciones: [entero("a", 1), entero("x", 2)] })),
    ).toBe("DIVISION_INCOMPLETA");
  });
  it("cantidad, paso o precio ilegibles, o paso cero", () => {
    const hacer = (l: LineaADividir) =>
      error(
        planDeDivision({
          partes: 2,
          lineas: [l, linea("b", "1", "10")],
          asignaciones: [entero(l.lineaId, 1), entero("b", 2)],
        }),
      );
    expect(hacer(linea("a", "x", "10"))).toBe("CANTIDAD_INVALIDA");
    expect(hacer(linea("a", "1", "10", "x"))).toBe("CANTIDAD_INVALIDA");
    expect(hacer(linea("a", "1", "x"))).toBe("CANTIDAD_INVALIDA");
    expect(hacer(linea("a", "1", "10", "0"))).toBe("CANTIDAD_INVALIDA");
  });
  it("un error que no es de valor al leer no se confunde con un dato inválido", () => {
    const planear = (l: LineaADividir) => () =>
      planDeDivision({ partes: 2, lineas: [l], asignaciones: [entero("a", 1)] });
    expect(planear({ ...linea("a", "1", "10"), cantidad: explota })).toThrow(RangeError);
    expect(planear({ ...linea("a", "1", "10"), precioUnitario: explota })).toThrow(RangeError);
  });
  it("entero a una cuenta que no existe (0, 1.5 o más que las partes)", () => {
    for (const parte of [0, 1.5, 3, Number.NaN]) {
      expect(
        error(
          planDeDivision({
            partes: 2,
            lineas: [linea("a", "1", "10"), linea("b", "1", "10")],
            asignaciones: [entero("a", parte), entero("b", 2)],
          }),
        ),
      ).toBe("PARTES_INVALIDAS");
    }
  });
  it("por unidades: una cantidad por cuenta, ni una más ni una menos", () => {
    expect(
      error(
        planDeDivision({
          partes: 3,
          lineas: [linea("a", "2", "10")],
          asignaciones: [{ lineaId: "a", forma: "POR_UNIDADES", cantidades: ["1", "1"] }],
        }),
      ),
    ).toBe("UNIDADES_NO_SUMAN");
  });
  it("compartido con una cuenta que no existe en esta división (válida para el reparto, no para estas partes)", () => {
    expect(
      error(
        planDeDivision({
          partes: 3,
          lineas: [linea("a", "1", "10"), linea("b", "1", "10")],
          asignaciones: [{ lineaId: "a", forma: "COMPARTIDO", partes: [1, 4] }, entero("b", 2)],
        }),
      ),
    ).toBe("PARTES_INVALIDAS");
    for (const partes of [
      [1, 1.5],
      [0, 1],
    ]) {
      expect(
        error(
          planDeDivision({
            partes: 3,
            lineas: [linea("a", "1", "10")],
            asignaciones: [{ lineaId: "a", forma: "COMPARTIDO", partes }],
          }),
        ),
      ).toBe("PARTES_INVALIDAS");
    }
  });
  it("una de las cuentas queda vacía aunque las otras tengan cosas", () => {
    expect(
      error(
        planDeDivision({
          partes: 3,
          lineas: [linea("a", "1", "10"), linea("b", "1", "10")],
          asignaciones: [entero("a", 1), entero("b", 2)],
        }),
      ),
    ).toBe("PARTE_VACIA");
  });
  it("todas las unidades de la segunda línea a una cuenta la pasan entera aunque la primera ya sumó copias", () => {
    const r = planDeDivision({
      partes: 2,
      lineas: [linea("a", "1", "10"), linea("b", "2", "10")],
      asignaciones: [
        entero("a", 1),
        { lineaId: "b", forma: "POR_UNIDADES", cantidades: ["0", "2"] },
      ],
    });
    expect(r).toEqual({
      ok: true,
      valor: [
        { lineaOrigenId: "a", parte: 1, modo: "COMPLETA", cantidad: "1.0000" },
        { lineaOrigenId: "b", parte: 2, modo: "COMPLETA", cantidad: "2.0000" },
      ],
    });
    expect(una).toHaveLength(1);
  });
});

describe("huellaDeDivision: cada parte de la asignación cuenta", () => {
  const huella = (asignaciones: readonly Asignacion[], cuentaId = "c", partes = 3) =>
    huellaDeDivision({ cuentaId, partes, asignaciones });
  it("cambia con la cuenta de un entero, las cantidades por unidades y las cuentas de un compartido", () => {
    expect(huella([entero("a", 1)])).not.toBe(huella([entero("a", 2)]));
    const unidades = (cantidades: string[]): Asignacion => ({
      lineaId: "a",
      forma: "POR_UNIDADES",
      cantidades,
    });
    expect(huella([unidades(["1", "2", "0"])])).not.toBe(huella([unidades(["2", "1", "0"])]));
    const compartido = (partes: number[]): Asignacion => ({
      lineaId: "a",
      forma: "COMPARTIDO",
      partes,
    });
    expect(huella([compartido([1, 2])])).not.toBe(huella([compartido([1, 3])]));
    expect(huella([compartido([2, 1])])).toBe(huella([compartido([1, 2])]));
    expect(huella([entero("a", 1)])).not.toBe(huella([entero("b", 1)]));
    expect(huella([entero("a", 1)])).not.toBe(huella([]));
    expect(huella([unidades(["1", "0", "0"])])).not.toBe(huella([entero("a", 1)]));
    expect(huella([compartido([1, 2])])).not.toBe(huella([unidades(["1", "2", "0"])]));
  });
  it("no depende del orden de las asignaciones, con ninguna permutación", () => {
    const a = entero("a", 1);
    const b: Asignacion = { lineaId: "b", forma: "POR_UNIDADES", cantidades: ["1", "1", "0"] };
    const c: Asignacion = { lineaId: "c", forma: "COMPARTIDO", partes: [3, 1] };
    const base = huella([a, b, c]);
    for (const orden of [
      [a, c, b],
      [b, a, c],
      [b, c, a],
      [c, a, b],
      [c, b, a],
    ]) {
      expect(huella(orden)).toBe(base);
    }
  });
});

describe("reparto: rechazos y desempates", () => {
  it("ítem compartido: cuentas repetidas, no enteras o fuera de rango", () => {
    expect(error(repartirItemCompartido("10.00", [1, 2, 2]))).toBe("PARTES_INVALIDAS");
    expect(error(repartirItemCompartido("10.00", [1, 1.5]))).toBe("PARTES_INVALIDAS");
    expect(error(repartirItemCompartido("10.00", [0, 1]))).toBe("PARTES_INVALIDAS");
    expect(error(repartirItemCompartido("10.00", [1, 5]))).toBe("PARTES_INVALIDAS");
    expect(error(repartirItemCompartido("10.00", [1, 4]))).toBe("ok");
  });
  it("un error ajeno al dato no se toma por importe inválido", () => {
    expect(() => repartirItemCompartido(explota, [1, 2])).toThrow(RangeError);
    expect(() => repartirPorPorcentaje("10.00", [explota])).toThrow(RangeError);
  });
  it("partes iguales y porcentaje: importe inválido o negativo", () => {
    for (const total of ["x", "-1.00"]) {
      expect(error(repartirEnPartesIguales(total, 3))).toBe("IMPORTE_INVALIDO");
      expect(error(repartirPorPorcentaje(total, ["50"]))).toBe("IMPORTE_INVALIDO");
    }
  });
  it("numera las partes desde la 1", () => {
    expect(repartirEnPartesIguales("1.00", 3)).toEqual({
      ok: true,
      valor: [
        { parte: 1, importe: "0.34" },
        { parte: 2, importe: "0.33" },
        { parte: 3, importe: "0.33" },
      ],
    });
    expect(repartirPorPorcentaje("1.00", ["50"])).toEqual({
      ok: true,
      valor: [
        { parte: 1, importe: "0.50" },
        { parte: 2, importe: "0.50" },
      ],
    });
  });
  it("el 100 % repartido entre las demás deja a la parte 1 en cero (se permite)", () => {
    expect(repartirPorPorcentaje("10.00", ["100"])).toEqual({
      ok: true,
      valor: [
        { parte: 1, importe: "0.00" },
        { parte: 2, importe: "10.00" },
      ],
    });
    expect(error(repartirPorPorcentaje("10.00", ["100.0001"]))).toBe("PORCENTAJE_INVALIDO");
  });
  it("restos mayores: coincide con una cuenta hecha aparte, en todos los casos chicos", () => {
    const pesos = ["0", "0.0001", "12.5", "20", "25", "33.3333", "40.1234", "50", "66.6667"];
    const escala = (p: string): bigint => {
      const [e = "0", d = ""] = p.split(".");
      return BigInt(e) * 10_000n + BigInt(d.padEnd(4, "0"));
    };
    let casos = 0;
    for (let total = 0n; total <= 40n; total++) {
      for (const p1 of pesos) {
        for (const p2 of [null, ...pesos]) {
          const dados = p2 === null ? [p1] : [p1, p2];
          const resto = 1_000_000n - dados.reduce((a, p) => a + escala(p), 0n);
          if (resto < 0n) continue;
          const pesosEscala = [resto, ...dados.map(escala)];
          const exactos = pesosEscala.map((w) => total * w);
          const pisos = exactos.map((e) => e / 1_000_000n);
          let faltan = total - pisos.reduce((a, p) => a + p, 0n);
          const esperado = [...pisos];
          const candidatos = exactos.map((e, i) => ({ i, r: e % 1_000_000n }));
          while (faltan > 0n) {
            let mejor = -1;
            for (const c of candidatos) {
              if (c.r < 0n) continue;
              const actual = candidatos[mejor];
              if (actual === undefined || c.r > actual.r) mejor = c.i;
            }
            esperado[mejor] = (esperado[mejor] as bigint) + 1n;
            (candidatos[mejor] as { r: bigint }).r = -1n;
            faltan--;
          }
          const r = repartirPorPorcentaje(
            `${total / 100n}.${(total % 100n).toString().padStart(2, "0")}`,
            dados,
          );
          if (!r.ok) throw new Error(`rechazó ${total} ${dados.join(",")}`);
          expect(r.valor.map((x) => BigInt(x.importe.replace(".", "")))).toEqual(esperado);
          casos++;
        }
      }
    }
    expect(casos).toBeGreaterThan(500);
  });
});
