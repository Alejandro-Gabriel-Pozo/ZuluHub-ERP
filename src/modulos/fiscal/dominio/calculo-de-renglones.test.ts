import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import {
  alicuotaArbitraria,
  renglonArbitrario,
  renglon,
} from "../../../../test/utilidades/facturacion";
import { cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import { porcentajeDesdeTexto } from "../../../primitivas/cantidad/porcentaje";
import {
  importeATexto,
  importeCero,
  importesIguales,
  sumar,
} from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import {
  multiplicarPrecioPorCantidad,
  quitarPorcentajeIncluido,
} from "../../../primitivas/dinero/monto-exacto";
import { precioUnitarioDesdeTexto } from "../../../primitivas/dinero/precio-unitario";
import { POLITICA_VIGENTE } from "../../../primitivas/dinero/redondeo";
import { CODIGOS_DE_ALICUOTA } from "./alicuota";
import { calcularComprobante } from "./comprobante";
import {
  MODOS_DE_PRECIO,
  TOPE_DE_TOTAL_EN_CENTAVOS,
  agregarPorcentaje,
  calcularRenglones,
  modoDePrecioInicial,
  type DatosDeCalculoDeRenglon,
  type ModoDePrecio,
} from "./calculo-de-renglones";

function calcular(
  renglones: readonly DatosDeCalculoDeRenglon[],
  modo: ModoDePrecio = "IVA_INCLUIDO",
  politica = POLITICA_VIGENTE,
) {
  const r = calcularRenglones(ARS, renglones, modo, politica);
  if (!r.ok) throw new Error(`cálculo inválido: ${r.error}`);
  const c = r.valor;
  return {
    total: importeATexto(c.total),
    renglones: c.renglones.map(importeATexto),
    neto: importeATexto(c.neto),
    iva: importeATexto(c.iva),
    desglose: c.desglose.map((d) => ({
      alicuota: d.alicuota,
      total: importeATexto(d.total),
      neto: importeATexto(d.neto),
      iva: importeATexto(d.iva),
    })),
  };
}

describe("agregarPorcentaje", () => {
  it("suma el porcentaje de forma exacta, sin redondear", () => {
    const unPeso = multiplicarPrecioPorCantidad(
      ARS,
      precioUnitarioDesdeTexto("1"),
      cantidadDesdeTexto("1"),
    );
    // 1 peso = 100 centavos; +21 % = 121 centavos exactos
    expect(agregarPorcentaje(unPeso, porcentajeDesdeTexto("21"))).toEqual(
      multiplicarPrecioPorCantidad(ARS, precioUnitarioDesdeTexto("1.21"), cantidadDesdeTexto("1")),
    );
    // 0,01 peso + 10,5 % = 1,105 centavos: una fracción, no un centavo
    const centavo = multiplicarPrecioPorCantidad(
      ARS,
      precioUnitarioDesdeTexto("0.01"),
      cantidadDesdeTexto("1"),
    );
    const con = agregarPorcentaje(centavo, porcentajeDesdeTexto("10.5"));
    expect(con).toEqual(
      multiplicarPrecioPorCantidad(
        ARS,
        precioUnitarioDesdeTexto("0.01105"),
        cantidadDesdeTexto("1"),
      ),
    );
  });

  it("con 0 % deja el monto igual", () => {
    const m = multiplicarPrecioPorCantidad(
      ARS,
      precioUnitarioDesdeTexto("3.33"),
      cantidadDesdeTexto("3"),
    );
    expect(agregarPorcentaje(m, porcentajeDesdeTexto("0"))).toEqual(m);
  });

  it("propiedad: es la inversa exacta de quitarPorcentajeIncluido", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 12n }),
        fc.bigInt({ min: 0n, max: 10n ** 6n }),
        fc.bigInt({ min: 0n, max: 1_000_000n }),
        (precio, cantidad, porcentaje) => {
          const monto = multiplicarPrecioPorCantidad(
            ARS,
            precioUnitarioDesdeTexto(
              `${precio / 10n ** 6n}.${String(precio % 10n ** 6n).padStart(6, "0")}`,
            ),
            cantidadDesdeTexto(
              `${cantidad / 10n ** 4n}.${String(cantidad % 10n ** 4n).padStart(4, "0")}`,
            ),
          );
          const p = porcentajeDesdeTexto(
            `${porcentaje / 10n ** 4n}.${String(porcentaje % 10n ** 4n).padStart(4, "0")}`,
          );
          expect(quitarPorcentajeIncluido(agregarPorcentaje(monto, p), p)).toEqual(monto);
        },
      ),
    );
  });
});

describe("calcularRenglones: ejemplos de ADR-006 con IVA incluido", () => {
  it("E1: tres renglones de 3 × $ 9,95 con −10 % → total 80,60 y 26,87 / 26,87 / 26,86", () => {
    const r = renglon("9.95", "3", "21", "10");
    const c = calcular([r, r, r]);
    expect(c.total).toBe("80.60");
    expect(c.renglones).toEqual(["26.87", "26.87", "26.86"]);
  });

  it("E2: dos alícuotas → neto 1.950,23, IVA 309,77 y total 2.260,00", () => {
    const c = calcular([renglon("1210.00", "1", "21"), renglon("1050.00", "1", "10.5")]);
    expect(c.total).toBe("2260.00");
    expect(c.desglose).toEqual([
      { alicuota: "10.5", total: "1050.00", neto: "950.23", iva: "99.77" },
      { alicuota: "21", total: "1210.00", neto: "1000.00", iva: "210.00" },
    ]);
    expect(c.neto).toBe("1950.23");
    expect(c.iva).toBe("309.77");
  });

  it("exento y no gravado: sin IVA, neto = total; la alícuota 0 % es gravada pero sin IVA", () => {
    const c = calcular([
      renglon("10.00", "1", "EXENTO"),
      renglon("20.00", "1", "NO_GRAVADO"),
      renglon("30.00", "1", "0"),
    ]);
    expect(c.desglose).toEqual([
      { alicuota: "0", total: "30.00", neto: "30.00", iva: "0.00" },
      { alicuota: "EXENTO", total: "10.00", neto: "10.00", iva: "0.00" },
      { alicuota: "NO_GRAVADO", total: "20.00", neto: "20.00", iva: "0.00" },
    ]);
    expect(c.neto).toBe("60.00");
    expect(c.iva).toBe("0.00");
  });

  it("los desgloses salen en el orden de CODIGOS_DE_ALICUOTA, sin importar el orden de los renglones", () => {
    const c = calcular([
      renglon("1.00", "1", "27"),
      renglon("1.00", "1", "2.5"),
      renglon("1.00", "1", "21"),
    ]);
    expect(c.desglose.map((d) => d.alicuota)).toEqual(["2.5", "21", "27"]);
  });
});

describe("calcularRenglones: IVA discriminado (precio neto)", () => {
  it("$ 1.000 + 21 % = $ 1.210 en un renglón", () => {
    const c = calcular([renglon("1000.00", "1", "21")], "IVA_DISCRIMINADO");
    expect(c.total).toBe("1210.00");
    expect(c.desglose).toEqual([
      { alicuota: "21", total: "1210.00", neto: "1000.00", iva: "210.00" },
    ]);
  });

  it("el descuento se aplica al neto y después se suma el IVA", () => {
    // 3 × 9,95 = 29,85; −10 % = 26,865; × 1,21 = 32,50665 → 32,51
    const c = calcular([renglon("9.95", "3", "21", "10")], "IVA_DISCRIMINADO");
    expect(c.total).toBe("32.51");
    expect(c.desglose[0]).toEqual({ alicuota: "21", total: "32.51", neto: "26.87", iva: "5.64" });
  });

  it("el total se redondea una sola vez: tres renglones netos de $ 0,01 al 10,5 % dan 0,03 y no 0,04", () => {
    // cada uno vale 0,01105 exacto: redondeado de a uno sería 0,01 (suma 0,03); el total exacto es 0,03315 → 0,03
    const c = calcular(
      [renglon("0.01", "1", "10.5"), renglon("0.01", "1", "10.5"), renglon("0.01", "1", "10.5")],
      "IVA_DISCRIMINADO",
    );
    expect(c.total).toBe("0.03");
    // y con seis renglones el total exacto es 0,0663 → 0,07, aunque cada uno de a uno daría 0,01 (0,06)
    const seis = calcular(
      Array.from({ length: 6 }, () => renglon("0.01", "1", "10.5")),
      "IVA_DISCRIMINADO",
    );
    expect(seis.total).toBe("0.07");
  });

  it("exento, no gravado y sin alícuota no suman IVA", () => {
    const c = calcular(
      [
        renglon("100.00", "1", "EXENTO"),
        renglon("50.00", "1", "NO_GRAVADO"),
        renglon("25.00", "1", null),
      ],
      "IVA_DISCRIMINADO",
    );
    expect(c.total).toBe("175.00");
    expect(c.iva).toBe("0.00");
    expect(c.neto).toBe("175.00");
  });

  it("la alícuota 0 % no agrega nada", () => {
    expect(calcular([renglon("100.00", "1", "0")], "IVA_DISCRIMINADO").total).toBe("100.00");
  });

  it("con varias alícuotas el neto impreso de una alícuota puede diferir en un centavo de lo cargado (límite conocido)", () => {
    // 22,46 al 21 % y 36,44 al 10,5 %: el total (67,44) se reparte entre los renglones por restos mayores y
    // el 10,5 % queda con 40,26 → neto 36,43, un centavo menos que el cargado. Con UNA alícuota esto no pasa.
    const c = calcular(
      [renglon("22.46", "1", "21"), renglon("36.44", "1", "10.5")],
      "IVA_DISCRIMINADO",
    );
    expect(c.total).toBe("67.44");
    expect(c.desglose).toEqual([
      { alicuota: "10.5", total: "40.26", neto: "36.43", iva: "3.83" },
      { alicuota: "21", total: "27.18", neto: "22.46", iva: "4.72" },
    ]);
  });
});

describe("calcularRenglones: renglones sin alícuota (letra C)", () => {
  it("todo es neto: neto = total, IVA 0 y sin desglose", () => {
    const c = calcular([renglon("9.95", "3", null, "10"), renglon("10.00", "1", null)]);
    expect(c.total).toBe("36.87");
    expect(c.neto).toBe("36.87");
    expect(c.iva).toBe("0.00");
    expect(c.desglose).toEqual([]);
  });

  it("mezclado con renglones con alícuota, solo estos figuran en el desglose y lo demás es neto", () => {
    const c = calcular([renglon("121.00", "1", "21"), renglon("10.00", "1", null)]);
    expect(c.total).toBe("131.00");
    expect(c.desglose).toEqual([{ alicuota: "21", total: "121.00", neto: "100.00", iva: "21.00" }]);
    expect(c.neto).toBe("110.00");
    expect(c.iva).toBe("21.00");
  });
});

describe("calcularRenglones: política de redondeo", () => {
  it("usa la política que recibe", () => {
    // 10,005 exacto: 0,01 × 1000,5 → la mitad sube o va al par
    const r = renglon("0.01", "1000.5", "EXENTO");
    expect(calcular([r], "IVA_INCLUIDO", "MITAD_SUBE_SIMETRICA").total).toBe("10.01");
    expect(calcular([r], "IVA_INCLUIDO", "MITAD_PAR").total).toBe("10.00");
  });
});

describe("calcularRenglones: rango del total", () => {
  const unico = (precio: string, cantidad = "1") => [renglon(precio, cantidad, "EXENTO")];
  const error = (renglones: ReturnType<typeof unico>) =>
    calcularRenglones(ARS, renglones, "IVA_INCLUIDO", POLITICA_VIGENTE);

  it("un total de cero no se informa", () => {
    expect(error(unico("0"))).toEqual({ ok: false, error: "TOTAL_FUERA_DE_RANGO" });
    expect(error(unico("1", "0"))).toEqual({ ok: false, error: "TOTAL_FUERA_DE_RANGO" });
    // 0,004 redondea a cero
    expect(error(unico("0.004"))).toEqual({ ok: false, error: "TOTAL_FUERA_DE_RANGO" });
  });

  it("un centavo es el mínimo", () => {
    expect(calcular(unico("0.01")).total).toBe("0.01");
    expect(calcular(unico("0.005")).total).toBe("0.01");
  });

  it("el tope son trece enteros y dos decimales", () => {
    expect(TOPE_DE_TOTAL_EN_CENTAVOS).toBe(999_999_999_999_999n);
    // 999.999.999.999,999 × 10 = 9.999.999.999.999,99 exacto: justo en el tope
    expect(calcular(unico("999999999999.999", "10")).total).toBe("9999999999999.99");
    // 9.999.999.999.999,994 redondea al tope
    expect(calcular(unico("999999999999.9994", "10")).total).toBe("9999999999999.99");
    // 9.999.999.999.999,995 redondea a 10^13, ya fuera del tope
    expect(error(unico("999999999999.9995", "10"))).toEqual({
      ok: false,
      error: "TOTAL_FUERA_DE_RANGO",
    });
    // un centavo entero de más
    expect(error(unico("999999999999.999999", "11"))).toEqual({
      ok: false,
      error: "TOTAL_FUERA_DE_RANGO",
    });
  });

  it("un total desmesurado es un error, no una excepción", () => {
    expect(error(unico("999999999999.999999", "99999999999999"))).toEqual({
      ok: false,
      error: "TOTAL_FUERA_DE_RANGO",
    });
  });
});

describe("modoDePrecioInicial", () => {
  it("A parte de precios netos; B y C, de precios finales", () => {
    expect(modoDePrecioInicial("A")).toBe("IVA_DISCRIMINADO");
    expect(modoDePrecioInicial("B")).toBe("IVA_INCLUIDO");
    expect(modoDePrecioInicial("C")).toBe("IVA_INCLUIDO");
    expect(MODOS_DE_PRECIO).toEqual(["IVA_INCLUIDO", "IVA_DISCRIMINADO"]);
  });
});

describe("calcularRenglones: propiedades", () => {
  const lista = fc.array(renglonArbitrario(), { minLength: 1, maxLength: 8 });
  const modo = fc.constantFrom(...MODOS_DE_PRECIO);

  it("los renglones suman el total y en cada alícuota neto + IVA = total", () => {
    fc.assert(
      fc.property(lista, modo, (renglones, m) => {
        const r = calcularRenglones(ARS, renglones, m, POLITICA_VIGENTE);
        if (!r.ok) return; // total cero: no hay nada que afirmar
        const c = r.valor;
        expect(c.renglones).toHaveLength(renglones.length);
        expect(importesIguales(c.renglones.reduce(sumar, importeCero(ARS)), c.total)).toBe(true);
        for (const d of c.desglose) {
          expect(importesIguales(sumar(d.neto, d.iva), d.total)).toBe(true);
        }
        expect(importesIguales(sumar(c.neto, c.iva), c.total)).toBe(true);
      }),
    );
  });

  it("con IVA incluido da lo mismo que calcularComprobante (un solo algoritmo)", () => {
    fc.assert(
      fc.property(fc.array(renglonArbitrario(), { minLength: 1, maxLength: 8 }), (renglones) => {
        const nuevo = calcularRenglones(ARS, renglones, "IVA_INCLUIDO", POLITICA_VIGENTE);
        if (!nuevo.ok) return;
        const viejo = calcularComprobante(
          ARS,
          renglones.map((r) => ({
            precioUnitario: r.precioUnitario,
            cantidad: r.cantidad,
            alicuota: r.alicuota ?? "NO_GRAVADO",
            ...(r.descuento === null ? {} : { descuento: r.descuento }),
          })),
          POLITICA_VIGENTE,
        );
        expect(nuevo.valor).toEqual({
          total: viejo.total,
          renglones: viejo.lineas,
          desglose: viejo.desglose,
          neto: viejo.neto,
          iva: viejo.iva,
        });
      }),
    );
  });

  it("el total no depende del orden de los renglones", () => {
    fc.assert(
      fc.property(lista, modo, (renglones, m) => {
        const a = calcularRenglones(ARS, renglones, m, POLITICA_VIGENTE);
        const b = calcularRenglones(ARS, [...renglones].reverse(), m, POLITICA_VIGENTE);
        expect(a.ok).toBe(b.ok);
        if (a.ok && b.ok) expect(importesIguales(a.valor.total, b.valor.total)).toBe(true);
      }),
    );
  });

  it("sin alícuota nunca hay IVA ni desglose", () => {
    fc.assert(
      fc.property(
        fc.array(renglonArbitrario(fc.constant(null)), { minLength: 1, maxLength: 8 }),
        (renglones) => {
          const r = calcularRenglones(ARS, renglones, "IVA_INCLUIDO", POLITICA_VIGENTE);
          if (!r.ok) return;
          expect(r.valor.iva.unidades).toBe(0n);
          expect(r.valor.desglose).toEqual([]);
          expect(importesIguales(r.valor.neto, r.valor.total)).toBe(true);
        },
      ),
    );
  });

  it("IVA discriminado con UNA alícuota: si la suma de los netos cargados es exacta en centavos, el neto impreso es esa suma (§B.3.3)", () => {
    const netoEnCentavos = fc.bigInt({ min: 0n, max: 10_000_000n });
    const gravadas = alicuotaArbitraria.filter((a) => a !== "EXENTO" && a !== "NO_GRAVADO");
    fc.assert(
      fc.property(
        gravadas,
        fc.array(fc.tuple(netoEnCentavos, fc.integer({ min: 1, max: 20 })), {
          minLength: 1,
          maxLength: 8,
        }),
        (alicuota, partes) => {
          const renglones = partes.map(([centavos, cantidad]) =>
            renglon(
              `${centavos / 100n}.${String(centavos % 100n).padStart(2, "0")}`,
              String(cantidad),
              alicuota,
            ),
          );
          const cargado = partes.reduce(
            (a, [centavos, cantidad]) => a + centavos * BigInt(cantidad),
            0n,
          );
          const r = calcularRenglones(ARS, renglones, "IVA_DISCRIMINADO", POLITICA_VIGENTE);
          if (!r.ok) return;
          expect(r.valor.desglose).toHaveLength(1);
          expect(r.valor.desglose[0]?.neto.unidades).toBe(cargado);
        },
      ),
    );
  });

  it("el desglose solo trae alícuotas conocidas, sin repetir", () => {
    fc.assert(
      fc.property(lista, modo, (renglones, m) => {
        const r = calcularRenglones(ARS, renglones, m, POLITICA_VIGENTE);
        if (!r.ok) return;
        const codigos = r.valor.desglose.map((d) => d.alicuota);
        expect(new Set(codigos).size).toBe(codigos.length);
        for (const c of codigos) expect(CODIGOS_DE_ALICUOTA).toContain(c);
      }),
    );
  });
});

describe("calcularRenglones: golden del cálculo (ADR-006 y redondeo-e-iva §3)", () => {
  it("los ejemplos del dueño, en los dos modos de precio, quedan fijados en un archivo", async () => {
    const e1 = renglon("9.95", "3", "21", "10");
    const dosAlicuotas = [renglon("1210.00", "1", "21"), renglon("1050.00", "1", "10.5")];
    const caso = (renglones: readonly DatosDeCalculoDeRenglon[], modo: ModoDePrecio) =>
      calcular(renglones, modo);
    const golden = {
      "ADR-006 ejemplo 1 (3 × $ 9,95 − 10 %, IVA incluido)": caso([e1, e1, e1], "IVA_INCLUIDO"),
      "redondeo-e-iva §3 (dos alícuotas, IVA incluido)": caso(dosAlicuotas, "IVA_INCLUIDO"),
      "los mismos netos cargados con IVA discriminado": caso(
        [renglon("1000.00", "1", "21"), renglon("950.23", "1", "10.5")],
        "IVA_DISCRIMINADO",
      ),
      "letra C (sin alícuota)": caso(
        [renglon("9.95", "3", null, "10"), renglon("10.00", "1", null)],
        "IVA_INCLUIDO",
      ),
    };
    await expect(JSON.stringify(golden, null, 2)).toMatchFileSnapshot(
      "./golden/calculo-de-renglones.golden.txt",
    );
    expect(golden["ADR-006 ejemplo 1 (3 × $ 9,95 − 10 %, IVA incluido)"].total).toBe("80.60");
    expect(golden["redondeo-e-iva §3 (dos alícuotas, IVA incluido)"].neto).toBe("1950.23");
    expect(golden["redondeo-e-iva §3 (dos alícuotas, IVA incluido)"].iva).toBe("309.77");
  });
});
