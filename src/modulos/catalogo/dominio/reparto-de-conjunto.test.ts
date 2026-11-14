import { describe, expect, it } from "vitest";
import { importeATexto, importeDesdeTexto } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { precioUnitarioDesdeTexto } from "../../../primitivas/dinero/precio-unitario";
import { repartirPrecioDelConjunto } from "./reparto-de-conjunto";

/** Los ejemplos de E8 §3.2 (cantidades inventadas por la especificación; las alícuotas son de ejemplo, PP-1). */
const reparto = (importe: string, ...componentes: [string, string][]) => {
  const r = repartirPrecioDelConjunto(
    importeDesdeTexto(ARS, importe),
    componentes.map(([precio, alicuota]) => ({
      precioDeLista: precioUnitarioDesdeTexto(precio),
      alicuota,
    })),
  );
  if (!r.ok) throw new Error(`se esperaba un reparto, vino ${r.error}`);
  return {
    partes: r.valor.partes.map(importeATexto),
    porAlicuota: r.valor.porAlicuota.map((a) => [a.alicuota, importeATexto(a.importe)]),
  };
};

describe("repartirPrecioDelConjunto", () => {
  it("combo Funghi: 14.000 entre 12.500 y 2.200 → el centavo sobrante va al mayor resto (la gaseosa)", () => {
    expect(reparto("14000", ["12500", "21"], ["2200", "21"]).partes).toEqual([
      "11904.76",
      "2095.24",
    ]);
  });

  it("combo Merienda: 5.000 entre 3.300 y 2.100 → el sobrante lo gana el café, que tiene el mayor resto", () => {
    expect(reparto("5000", ["3300", "21"], ["2100", "21"]).partes).toEqual(["3055.56", "1944.44"]);
  });

  it("combo Desayuno: 4.000 entre café (21 %) y 2 medialunas (10,5 %) → partes y partes por alícuota", () => {
    const r = reparto("4000", ["3300", "21"], ["800", "10.5"], ["800", "10.5"]);
    expect(r.partes).toEqual(["2693.88", "653.06", "653.06"]);
    expect(r.porAlicuota).toEqual([
      ["21", "2693.88"],
      ["10.5", "1306.12"],
    ]);
  });

  it("las partes por alícuota suman el importe, con las alícuotas en el orden de su primera aparición", () => {
    const r = reparto("100", ["1", "10.5"], ["1", "21"], ["1", "10.5"]);
    expect(r.porAlicuota.map(([a]) => a)).toEqual(["10.5", "21"]);
    expect(r.partes).toEqual(["33.34", "33.33", "33.33"]);
    expect(r.porAlicuota).toEqual([
      ["10.5", "66.67"],
      ["21", "33.33"],
    ]);
  });

  it("un componente de precio de lista cero (precio abierto) recibe cero", () => {
    expect(reparto("1000", ["0", "21"], ["500", "21"]).partes).toEqual(["0.00", "1000.00"]);
  });

  it("con un importe cero reparte ceros, aunque todos los precios de lista sean cero", () => {
    expect(reparto("0", ["0", "21"], ["0", "21"]).partes).toEqual(["0.00", "0.00"]);
    expect(reparto("0", ["10", "21"], ["20", "21"]).partes).toEqual(["0.00", "0.00"]);
  });

  it("con todos los precios de lista en cero y un importe distinto de cero se rechaza, y sin componentes también", () => {
    const sinPrecios = repartirPrecioDelConjunto(importeDesdeTexto(ARS, "1000"), [
      { precioDeLista: precioUnitarioDesdeTexto("0"), alicuota: "21" },
    ]);
    expect(sinPrecios).toEqual({ ok: false, error: "CONJUNTO_SIN_PRECIOS_DE_REFERENCIA" });
    expect(repartirPrecioDelConjunto(importeDesdeTexto(ARS, "1000"), [])).toEqual({
      ok: false,
      error: "CONJUNTO_SIN_COMPONENTES",
    });
  });

  it("un solo componente se lleva todo el importe, y repetir la entrada da lo mismo (función de importe y precios sellados)", () => {
    expect(reparto("1234.56", ["77", "21"])).toEqual(reparto("1234.56", ["77", "21"]));
    expect(reparto("1234.56", ["77", "21"]).partes).toEqual(["1234.56"]);
  });
});
