import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  paginar,
  type EntradaDelPaginador,
  type Paginacion,
} from "../../apps/web/ui/plantillas/facturacion/impresion/paginador";
import "../propiedades/configuracion";

/**
 * El paginador de la hoja A4 (pieza pura): un renglón nunca se parte, el pie se reserva siempre, los parciales son exactos y «Hoja k de n»
 * usa el `n` real. El oráculo de dinero es aritmética `bigint` en centavos escrita aparte; el de alturas, una resta explícita.
 */

const aTexto = (centavos: bigint): string => {
  const s = String(centavos).padStart(3, "0");
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
};

const base = {
  altoUtilDeLaHoja: 1000,
  altoDelPie: 150,
  altoDelEncabezadoDeLaTabla: 24,
  altoDeLaFilaDeTransporte: 22,
} as const;

function entradaDe(
  altos: readonly number[],
  centavos: readonly bigint[],
  resto = {},
): EntradaDelPaginador {
  return { ...base, ...resto, altosDeLosRenglones: altos, importes: centavos.map(aTexto) };
}

/** Lo que ocupa una hoja de la paginación: tabla (encabezado, transporte si no es la primera y renglones) más el pie. */
function ocupa(e: EntradaDelPaginador, p: Paginacion, k: number): number {
  const hoja = p.hojas[k];
  if (hoja === undefined) throw new Error("hoja inexistente");
  const renglones = e.altosDeLosRenglones.slice(hoja.desde, hoja.hasta).reduce((a, h) => a + h, 0);
  return (
    renglones +
    e.altoDelEncabezadoDeLaTabla +
    (k === 0 ? 0 : e.altoDeLaFilaDeTransporte) +
    e.altoDelPie
  );
}

const cuantos = fc.integer({ min: 0, max: 80 });
const entradas = cuantos.chain((n) =>
  fc.record({
    altos: fc.array(fc.double({ min: 6, max: 140, noNaN: true }), { minLength: n, maxLength: n }),
    centavos: fc.array(fc.bigInt({ min: 1n, max: 99_999_999_999n }), {
      minLength: n,
      maxLength: n,
    }),
    util: fc.double({ min: 600, max: 1100, noNaN: true }),
    pie: fc.double({ min: 90, max: 220, noNaN: true }),
    encabezadoDeTabla: fc.double({ min: 12, max: 40, noNaN: true }),
    transporte: fc.double({ min: 12, max: 40, noNaN: true }),
  }),
);

function armar(r: {
  altos: number[];
  centavos: bigint[];
  util: number;
  pie: number;
  encabezadoDeTabla: number;
  transporte: number;
}): EntradaDelPaginador {
  return entradaDe(r.altos, r.centavos, {
    altoUtilDeLaHoja: r.util,
    altoDelPie: r.pie,
    altoDelEncabezadoDeLaTabla: r.encabezadoDeTabla,
    altoDeLaFilaDeTransporte: r.transporte,
  });
}

describe("paginar: propiedades", () => {
  it("las hojas cubren los renglones en orden, sin repetir ni saltear, y cada una lleva al menos uno (salvo la lista vacía)", () => {
    fc.assert(
      fc.property(entradas, (r) => {
        const p = paginar(armar(r));
        let siguiente = 0;
        for (const hoja of p.hojas) {
          expect(hoja.desde).toBe(siguiente);
          expect(hoja.hasta).toBeGreaterThanOrEqual(hoja.desde);
          if (r.altos.length > 0) expect(hoja.hasta).toBeGreaterThan(hoja.desde);
          siguiente = hoja.hasta;
        }
        expect(siguiente).toBe(r.altos.length);
      }),
    );
  });

  it("cada hoja entra en el alto útil con el pie reservado (si ningún renglón solo excede la hoja)", () => {
    fc.assert(
      fc.property(entradas, (r) => {
        const e = armar(r);
        const p = paginar(e);
        p.hojas.forEach((hoja, k) => {
          const unico = hoja.hasta - hoja.desde === 1;
          if (!p.excedeLaHoja || !unico)
            expect(ocupa(e, p, k)).toBeLessThanOrEqual(e.altoUtilDeLaHoja + 0.01);
        });
      }),
    );
  });

  it("un renglón nunca se parte: ninguna hoja que no es la última podía recibir el renglón siguiente (mínimo de hojas)", () => {
    fc.assert(
      fc.property(entradas, (r) => {
        const e = armar(r);
        const p = paginar(e);
        p.hojas.slice(0, -1).forEach((hoja, k) => {
          const siguiente = e.altosDeLosRenglones[hoja.hasta] ?? 0;
          expect(ocupa(e, p, k) + siguiente).toBeGreaterThan(e.altoUtilDeLaHoja);
        });
      }),
    );
  });

  it("los parciales son exactos (centavos enteros) y la suma final es la de los renglones", () => {
    fc.assert(
      fc.property(entradas, (r) => {
        const p = paginar(armar(r));
        const acumulado = (hasta: number): string =>
          aTexto(r.centavos.slice(0, hasta).reduce((a, c) => a + c, 0n));
        p.hojas.forEach((hoja, k) => {
          expect(hoja.transporte).toBe(k === 0 ? null : acumulado(hoja.desde));
          expect(hoja.aTransportar).toBe(k === p.hojas.length - 1 ? null : acumulado(hoja.hasta));
        });
        expect(p.sumaDeLosRenglones).toBe(acumulado(r.centavos.length));
      }),
    );
  });

  it("«A transportar» de una hoja es el «Transporte» de la siguiente", () => {
    fc.assert(
      fc.property(entradas, (r) => {
        const p = paginar(armar(r));
        p.hojas.slice(0, -1).forEach((hoja, k) => {
          expect(hoja.aTransportar).toBe(p.hojas[k + 1]?.transporte);
        });
      }),
    );
  });
});

describe("paginar: casos", () => {
  it("sin renglones hay una sola hoja, sin parciales y con suma cero", () => {
    const p = paginar(entradaDe([], []));
    expect(p.hojas).toEqual([{ desde: 0, hasta: 0, transporte: null, aTransportar: null }]);
    expect(p.sumaDeLosRenglones).toBe("0.00");
    expect(p.excedeLaHoja).toBe(false);
  });

  it("un renglón: una hoja", () => {
    const p = paginar(entradaDe([30], [12_345n]));
    expect(p.hojas).toEqual([{ desde: 0, hasta: 1, transporte: null, aTransportar: null }]);
    expect(p.sumaDeLosRenglones).toBe("123.45");
  });

  it("el cupo es exacto: el alto útil menos el pie y el encabezado de la tabla", () => {
    // cupo = 1000 - 150 - 24 = 826: 826 entra justo; 826,5 obliga a una segunda hoja.
    expect(paginar(entradaDe([826], [100n])).hojas).toHaveLength(1);
    const dos = paginar(entradaDe([400, 426.5], [100n, 200n]));
    expect(dos.hojas.map((h) => [h.desde, h.hasta])).toEqual([
      [0, 1],
      [1, 2],
    ]);
    expect(dos.hojas[0]?.aTransportar).toBe("1.00");
    expect(dos.hojas[1]?.transporte).toBe("1.00");
  });

  it("el pie se reserva en la primera y en las siguientes: sin él entrarían más renglones", () => {
    const altos = Array.from({ length: 30 }, () => 40);
    const importes = altos.map(() => 100n);
    const con = paginar(entradaDe(altos, importes));
    const sin = paginar(entradaDe(altos, importes, { altoDelPie: 0 }));
    // Con pie: 826 / 40 = 20 renglones en la primera; con el «Transporte» de 22, (826 - 22) / 40 = 20 en las demás.
    expect(con.hojas.map((h) => h.hasta - h.desde)).toEqual([20, 10]);
    // Sin pie reservado entrarían 24 (976 / 40) en la primera: la reserva es lo que los saca de la hoja.
    expect(sin.hojas.map((h) => h.hasta - h.desde)).toEqual([24, 6]);
  });

  it("200 renglones de 200 caracteres y 10 referencias de alto máximo: ninguno se parte, n hojas = las dibujadas", () => {
    // Un renglón de 200 caracteres en la descripción (unas 5 líneas) y el alto de 10 referencias reservado: 160 px.
    const altos = Array.from({ length: 200 }, (_, i) => (i % 3 === 0 ? 160 : 24.4));
    const importes = altos.map((_, i) => BigInt(1000 + i));
    const e = entradaDe(altos, importes);
    const p = paginar(e);
    expect(p.excedeLaHoja).toBe(false);
    expect(p.hojas.at(-1)?.hasta).toBe(200);
    p.hojas.forEach((_, k) => expect(ocupa(e, p, k)).toBeLessThanOrEqual(e.altoUtilDeLaHoja));
    expect(p.sumaDeLosRenglones).toBe(aTexto(importes.reduce((a, c) => a + c, 0n)));
  });

  it("un renglón más alto que una hoja vacía va solo y se marca (no se corta ni se cuelga)", () => {
    const p = paginar(entradaDe([20, 900, 20], [100n, 200n, 300n]));
    expect(p.excedeLaHoja).toBe(true);
    expect(p.hojas.map((h) => [h.desde, h.hasta])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
  });

  it("los importes se suman sin pasar por number: más dígitos de los que aguanta un double", () => {
    const grande = 99_999_999_999_999_999n;
    const p = paginar(entradaDe([10, 10], [grande, 1n]));
    expect(p.sumaDeLosRenglones).toBe("1000000000000000.00");
  });

  it("exige un importe por cada renglón", () => {
    expect(() => paginar({ ...base, altosDeLosRenglones: [10], importes: [] })).toThrow(RangeError);
  });
});
