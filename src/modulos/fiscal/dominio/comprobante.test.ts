import { describe, expect, it } from "vitest";
import { cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import { porcentajeDesdeTexto } from "../../../primitivas/cantidad/porcentaje";
import { importeATexto } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { precioUnitarioDesdeTexto } from "../../../primitivas/dinero/precio-unitario";
import { POLITICA_VIGENTE, type Politica } from "../../../primitivas/dinero/redondeo";
import { esCodigoDeAlicuota, porcentajeDeAlicuota, type CodigoDeAlicuota } from "./alicuota";
import { calcularComprobante, type LineaDeComprobante } from "./comprobante";

function linea(
  precio: string,
  cantidad: string,
  alicuota: CodigoDeAlicuota,
  descuento?: string,
): LineaDeComprobante {
  return {
    precioUnitario: precioUnitarioDesdeTexto(precio),
    cantidad: cantidadDesdeTexto(cantidad),
    alicuota,
    ...(descuento === undefined ? {} : { descuento: porcentajeDesdeTexto(descuento) }),
  };
}

function calcular(lineas: LineaDeComprobante[], politica: Politica = POLITICA_VIGENTE) {
  const c = calcularComprobante(ARS, lineas, politica);
  return {
    total: importeATexto(c.total),
    lineas: c.lineas.map(importeATexto),
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

describe("ejemplos validados por el dueño (caso 0b §3)", () => {
  it("E1: tres líneas de 3 × $ 9,95 con −10 % → total 80,60 (no 80,61)", () => {
    const l = linea("9.95", "3", "21", "10");
    const c = calcular([l, l, l]);
    expect(c.total).toBe("80.60");
    expect(c.lineas).toEqual(["26.87", "26.87", "26.86"]);
  });

  it("E2: dos alícuotas → neto 1.950,23, IVA 309,77, total 2.260,00", () => {
    const c = calcular([linea("1210.00", "1", "21"), linea("1050.00", "1", "10.5")]);
    expect(c.total).toBe("2260.00");
    expect(c.desglose).toEqual([
      { alicuota: "10.5", total: "1050.00", neto: "950.23", iva: "99.77" },
      { alicuota: "21", total: "1210.00", neto: "1000.00", iva: "210.00" },
    ]);
    expect(c.neto).toBe("1950.23");
    expect(c.iva).toBe("309.77");
  });

  it("E3: 3 × $ 3,50 al 10,5 % → neto 9,50, IVA 1,00, total 10,50", () => {
    const c = calcular([linea("3.50", "3", "10.5")]);
    expect(c.desglose).toEqual([{ alicuota: "10.5", total: "10.50", neto: "9.50", iva: "1.00" }]);
  });

  it("E4: $ 1.210,00 al 21 % con −10 % → total 1.089,00, neto 900,00, IVA 189,00", () => {
    const c = calcular([linea("1210.00", "1", "21", "10")]);
    expect(c.total).toBe("1089.00");
    expect(c.desglose).toEqual([
      { alicuota: "21", total: "1089.00", neto: "900.00", iva: "189.00" },
    ]);
  });

  it("E5: 10,005 y 10,015 con la política vigente → 10,01 y 10,02", () => {
    expect(calcular([linea("10.005", "1", "0")]).total).toBe("10.01");
    expect(calcular([linea("10.015", "1", "0")]).total).toBe("10.02");
  });

  it("E6: exento y no gravado → IVA 0, neto = total", () => {
    const c = calcular([linea("100.00", "1", "EXENTO"), linea("50.50", "1", "NO_GRAVADO")]);
    expect(c.desglose).toEqual([
      { alicuota: "EXENTO", total: "100.00", neto: "100.00", iva: "0.00" },
      { alicuota: "NO_GRAVADO", total: "50.50", neto: "50.50", iva: "0.00" },
    ]);
    expect(c.iva).toBe("0.00");
  });
});

describe("otros casos del comprobante", () => {
  it("sin líneas: todo en cero", () => {
    const c = calcular([]);
    expect(c).toEqual({ total: "0.00", lineas: [], neto: "0.00", iva: "0.00", desglose: [] });
  });

  it("alícuota 0 % gravada: neto = total, IVA 0", () => {
    expect(calcular([linea("100.00", "1", "0")]).desglose).toEqual([
      { alicuota: "0", total: "100.00", neto: "100.00", iva: "0.00" },
    ]);
  });

  it("una línea a precio cero convive con las demás", () => {
    const c = calcular([linea("0", "5", "21"), linea("10.00", "1", "21")]);
    expect(c.lineas).toEqual(["0.00", "10.00"]);
  });

  it("descuento del 100 % deja la línea en cero", () => {
    expect(calcular([linea("10.00", "2", "21", "100")]).total).toBe("0.00");
  });

  it("con la mitad al par el total puede diferir en un centavo; el resto del cálculo se mantiene", () => {
    expect(calcular([linea("10.005", "1", "0")], "MITAD_PAR").total).toBe("10.00");
  });

  it("agrupa por alícuota las líneas que no son contiguas", () => {
    const c = calcular([
      linea("121.00", "1", "21"),
      linea("10.50", "1", "10.5"),
      linea("121.00", "1", "21"),
    ]);
    expect(c.desglose.map((d) => [d.alicuota, d.total])).toEqual([
      ["10.5", "10.50"],
      ["21", "242.00"],
    ]);
  });
});

describe("alícuotas", () => {
  it("reconoce las sembradas desde ARCA y nada más", () => {
    for (const ok of ["0", "2.5", "5", "10.5", "21", "27", "EXENTO", "NO_GRAVADO"]) {
      expect(esCodigoDeAlicuota(ok)).toBe(true);
    }
    for (const mal of ["", "21.0", "9", "exento", "IVA21"]) {
      expect(esCodigoDeAlicuota(mal)).toBe(false);
    }
  });

  it("exento y no gravado no tienen porcentaje; las demás sí", () => {
    expect(porcentajeDeAlicuota("EXENTO")).toBeNull();
    expect(porcentajeDeAlicuota("NO_GRAVADO")).toBeNull();
    expect(porcentajeDeAlicuota("27")?.unidades).toBe(270000n);
  });
});
