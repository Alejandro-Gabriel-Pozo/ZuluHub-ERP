import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Contraste from "../../../primitivas/color/contraste";

/**
 * Los bordes que con colores reales casi no se tocan, con la razón de contraste simulada: contraste EXACTAMENTE igual al mínimo (7 pasa, no hace falta que sea más), empate entre blanco y
 * negro (gana el blanco) y el caso donde ningún candidato llega (cae al negro, y se probaron todos los puntos de luminosidad hasta el mínimo, inclusive).
 */
const razon = vi.hoisted(() => {
  const ver: (a: string, b: string) => number = () => 0;
  return { ver, llamadas: [] as string[][] };
});
vi.mock("../../../primitivas/color/contraste", async (importar) => {
  const real = await importar<typeof Contraste>();
  return {
    ...real,
    razonDeContraste: (a: string, b: string) => {
      razon.llamadas.push([a, b]);
      return razon.ver(a, b);
    },
  };
});

import { colorDeLaCarta } from "./color-de-la-carta";

beforeEach(() => {
  razon.llamadas = [];
});

describe("colorDeLaCarta: bordes con la razón de contraste simulada", () => {
  it("un color que llega justo a 7 se queda como está (7 alcanza) y, si blanco y negro empatan, el texto es blanco", () => {
    razon.ver = () => 7;
    expect(colorDeLaCarta("#123456")).toEqual({
      ok: true,
      valor: { hex: "#123456", textoSobreColor: "BLANCO", ajustado: false, contraste: 7 },
    });
  });

  it("si el negro da más contraste que el blanco, el texto es negro", () => {
    razon.ver = (_a, b) => (b === "#000000" ? 9 : 2);
    expect(colorDeLaCarta("#123456")).toEqual({
      ok: true,
      valor: { hex: "#123456", textoSobreColor: "NEGRO", ajustado: false, contraste: 9 },
    });
  });

  it("al oscurecer, el primer candidato que da justo 7 con blanco es el elegido (7 alcanza)", () => {
    // Las tres primeras consultas son las del color elegido (blanco, negro, el texto elegido): no llega. Desde ahí, todo da 7.
    let n = 0;
    razon.ver = () => (++n <= 3 ? 3 : 7);
    const r = colorDeLaCarta("#808081");
    // luminosidad 50 (floor de 50,39): el primer candidato es #7f7f80 (matiz 240, saturación casi 0): se toma ese y no el siguiente.
    expect(r).toEqual({
      ok: true,
      valor: { hex: "#7f7f80", textoSobreColor: "BLANCO", ajustado: true, contraste: 7 },
    });
    expect(razon.llamadas.filter(([a]) => a !== "#808081")).toHaveLength(1 + 2 + 1);
  });

  it("si ningún candidato llega, prueba todas las luminosidades hasta el mínimo (4) inclusive y cae al negro, ajustado", () => {
    razon.ver = () => 3;
    const r = colorDeLaCarta("#808081");
    expect(r).toEqual({
      ok: true,
      valor: { hex: "#000000", textoSobreColor: "BLANCO", ajustado: true, contraste: 3 },
    });
    // 3 del color elegido + (50 − 4 + 1) candidatos + 2 del texto de #000000 + 1 de su contraste.
    expect(razon.llamadas).toHaveLength(3 + 47 + 2 + 1);
  });

  it("un gris puro en el extremo (blanco, luminosidad 100) no genera números inválidos al oscurecer: sin tono ni saturación, la saturación es 0 y no 0/0", () => {
    let n = 0;
    razon.ver = () => (++n <= 3 ? 3 : 7);
    expect(colorDeLaCarta("#ffffff")).toEqual({
      ok: true,
      valor: { hex: "#ffffff", textoSobreColor: "BLANCO", ajustado: true, contraste: 7 },
    });
  });
});
