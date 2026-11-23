import { describe, expect, it } from "vitest";
import { importeATexto, importeDesdeTexto, type Importe } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import {
  compararCentros,
  conSigno,
  distribucionDelEspejo,
  distribucionValida,
  distribuirPorCentroDeCosto,
  type Reparto,
} from "./distribucion";

const imp = (texto: string): Importe => importeDesdeTexto(ARS, texto);
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";
const texto = (r: readonly Reparto[]) =>
  r.map((x) => `${x.centroDeCosto ?? "NULL"}=${importeATexto(x.importe)}`);

function repartir(
  importe: string,
  imputaciones: Array<[string | null, string]> = [],
  pendientes: Array<[string | null, string]> = [],
) {
  return distribuirPorCentroDeCosto({
    importe: imp(importe),
    imputaciones: imputaciones.map(([centroDeCosto, i]) => ({ centroDeCosto, importe: imp(i) })),
    pendientePorCentro: pendientes.map(([centroDeCosto, p]) => ({
      centroDeCosto,
      pendiente: imp(p),
    })),
  });
}

describe("distribuirPorCentroDeCosto", () => {
  it("10,00 «a cuenta» con el mismo pendiente en tres centros: 3,34 / 3,33 / 3,33 (el sobrante, al primero por orden fijo)", () => {
    const r = repartir(
      "10.00",
      [],
      [
        [C, "100.00"],
        [A, "100.00"],
        [B, "100.00"],
      ],
    );
    expect(r.ok && texto(r.valor)).toEqual([`${A}=3.34`, `${B}=3.33`, `${C}=3.33`]);
  });

  it("TODO el sobrante del redondeo va al primero por orden fijo, aunque sea más de un centavo (0,10 entre siete centros iguales: 0,04 y seis de 0,01)", () => {
    const centros = ["a", "b", "c", "d", "e", "f", "g"].map(
      (c) => `00000000-0000-4000-8000-00000000000${c.charCodeAt(0) - 96}`,
    );
    const r = repartir(
      "0.10",
      [],
      centros.map((c) => [c, "10.00"]),
    );
    expect(r.ok && texto(r.valor)).toEqual(
      centros.map((c, i) => `${c}=${i === 0 ? "0.04" : "0.01"}`),
    );
  });

  it("lo que se imputa a comprobantes hereda su centro de costo; el resto va proporcional a lo pendiente", () => {
    const r = repartir(
      "100.00",
      [[A, "40.00"]],
      [
        [A, "10.00"],
        [B, "30.00"],
      ],
    );
    // Resto 60,00 repartido 10:30 → 15,00 y 45,00; el centro A suma además sus 40,00.
    expect(r.ok && texto(r.valor)).toEqual([`${A}=55.00`, `${B}=45.00`]);
  });

  it("solo reparte entre los centros con pendiente POSITIVO (los negativos y los cero quedan afuera)", () => {
    const r = repartir(
      "10.00",
      [],
      [
        [A, "-50.00"],
        [B, "0.00"],
        [C, "20.00"],
      ],
    );
    expect(r.ok && texto(r.valor)).toEqual([`${C}=10.00`]);
  });

  it("sin ningún pendiente positivo, el resto va todo a «sin centro de costo»", () => {
    for (const pendientes of [
      [],
      [[A, "-5.00"]],
      [
        [A, "0.00"],
        [null, "0.00"],
      ],
    ] as Array<Array<[string | null, string]>>) {
      const r = repartir("7.00", [], pendientes);
      expect(r.ok && texto(r.valor)).toEqual(["NULL=7.00"]);
    }
  });

  it("«sin centro de costo» con pendiente positivo es un centro más y va al final del orden fijo", () => {
    const r = repartir(
      "10.00",
      [],
      [
        [null, "100.00"],
        [A, "100.00"],
      ],
    );
    expect(r.ok && texto(r.valor)).toEqual([`${A}=5.00`, "NULL=5.00"]);
  });

  it("un centro repetido en las imputaciones se junta; los renglones en cero no salen", () => {
    const r = repartir("10.00", [
      [B, "4.00"],
      [B, "6.00"],
    ]);
    expect(r.ok && texto(r.valor)).toEqual([`${B}=10.00`]);
    const sin = repartir("10.00", [[A, "10.00"]], [[B, "5.00"]]);
    expect(sin.ok && texto(sin.valor)).toEqual([`${A}=10.00`]);
  });

  it("rechaza lo que no se puede repartir: importe no positivo, imputaciones que pasan el importe o no positivas, otra moneda", () => {
    expect(repartir("0.00").ok).toBe(false);
    expect(repartir("-1.00").ok).toBe(false);
    expect(repartir("10.00", [[A, "10.01"]]).ok).toBe(false);
    expect(
      repartir("10.00", [
        [A, "5.00"],
        [B, "5.01"],
      ]).ok,
    ).toBe(false);
    expect(repartir("10.00", [[A, "0.00"]]).ok).toBe(false);
    expect(repartir("10.00", [[A, "-1.00"]]).ok).toBe(false);
  });

  it("el orden fijo: por sucursal ascendente y «sin centro» al final", () => {
    expect([null, B, A].sort(compararCentros)).toEqual([A, B, null]);
    expect(compararCentros(A, A)).toBe(0);
    expect(compararCentros(null, null)).toBe(0);
  });

  it("es una función pura: el mismo pedido da siempre el mismo reparto, sin importar el orden en que llegan los centros", () => {
    const uno = repartir(
      "10.00",
      [],
      [
        [A, "1.00"],
        [B, "2.00"],
        [C, "3.00"],
      ],
    );
    const otro = repartir(
      "10.00",
      [],
      [
        [C, "3.00"],
        [A, "1.00"],
        [B, "2.00"],
      ],
    );
    expect(uno).toEqual(otro);
  });
});

describe("conSigno, distribucionDelEspejo y distribucionValida", () => {
  const r = [
    { centroDeCosto: A, importe: imp("3.34") },
    { centroDeCosto: null, importe: imp("6.66") },
  ] as const;

  it("conSigno niega o deja; el espejo es el negativo EXACTO del original", () => {
    expect(texto(conSigno(r, "-"))).toEqual([`${A}=-3.34`, "NULL=-6.66"]);
    expect(texto(conSigno(r, "+"))).toEqual([`${A}=3.34`, "NULL=6.66"]);
    expect(texto(distribucionDelEspejo(r))).toEqual([`${A}=-3.34`, "NULL=-6.66"]);
    expect(conSigno([], "-")).toEqual([]);
  });

  it("valida: suma exacta, un renglón por centro, todos del signo del importe, al menos uno", () => {
    expect(distribucionValida(imp("10.00"), r)).toBe(true);
    expect(distribucionValida(imp("-10.00"), conSigno(r, "-"))).toBe(true);
    expect(distribucionValida(imp("10.00"), [])).toBe(false);
    expect(distribucionValida(imp("10.01"), r)).toBe(false);
    expect(
      distribucionValida(imp("10.00"), [...r, { centroDeCosto: A, importe: imp("0.00") }]),
    ).toBe(false);
    expect(distribucionValida(imp("10.00"), conSigno(r, "-"))).toBe(false);
    expect(
      distribucionValida(imp("10.00"), [
        { centroDeCosto: A, importe: imp("12.00") },
        { centroDeCosto: B, importe: imp("-2.00") },
      ]),
    ).toBe(false);
    expect(
      distribucionValida(imp("10.00"), [
        { centroDeCosto: A, importe: imp("5.00") },
        { centroDeCosto: A, importe: imp("5.00") },
      ]),
    ).toBe(false);
  });
});
