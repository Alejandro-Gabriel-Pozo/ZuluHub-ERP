import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import { repartirEnPartesIguales, repartirItemCompartido, repartirPorPorcentaje } from "./reparto";

const centavos = (texto: string): bigint => BigInt(texto.replace(".", ""));
const texto = (c: bigint): string => {
  const d = c.toString().padStart(3, "0");
  return `${d.slice(0, -2)}.${d.slice(-2)}`;
};
const suma = (partes: readonly { importe: string }[]): bigint =>
  partes.reduce((a, p) => a + centavos(p.importe), 0n);

describe("ítem compartido (D117)", () => {
  it("el centavo que sobra va a la Cuenta 1", () => {
    const r = repartirItemCompartido("100.00", [1, 2, 3]);
    expect(r).toEqual({
      ok: true,
      valor: [
        { parte: 1, importe: "33.34" },
        { parte: 2, importe: "33.33" },
        { parte: 3, importe: "33.33" },
      ],
    });
  });
  it("todo el resto va a la de menor número entre las elegidas (no a la 1 si no participa)", () => {
    // 3 gaseosas y un plato entre 3: el plato de 10,00 entre las cuentas 2, 3 y 4 → 3,34 / 3,33 / 3,33
    expect(repartirItemCompartido("10.00", [4, 2, 3])).toEqual({
      ok: true,
      valor: [
        { parte: 2, importe: "3.34" },
        { parte: 3, importe: "3.33" },
        { parte: 4, importe: "3.33" },
      ],
    });
    const dos = repartirItemCompartido("0.03", [1, 2]);
    expect(dos.ok && dos.valor.map((p) => p.importe)).toEqual(["0.02", "0.01"]);
  });
  it("rechaza menos de dos, repetidas, fuera de 1 a 4 e importes inválidos", () => {
    expect(repartirItemCompartido("1.00", [1])).toEqual({ ok: false, error: "PARTES_INVALIDAS" });
    expect(repartirItemCompartido("1.00", [1, 1])).toEqual({
      ok: false,
      error: "PARTES_INVALIDAS",
    });
    expect(repartirItemCompartido("1.00", [1, 5])).toEqual({
      ok: false,
      error: "PARTES_INVALIDAS",
    });
    expect(repartirItemCompartido("1.005", [1, 2])).toEqual({
      ok: false,
      error: "IMPORTE_INVALIDO",
    });
    expect(repartirItemCompartido("-1.00", [1, 2])).toEqual({
      ok: false,
      error: "IMPORTE_INVALIDO",
    });
  });
});

describe("partes iguales", () => {
  it("el resto va de a un centavo desde la parte 1", () => {
    const r = repartirEnPartesIguales("100.00", 6);
    expect(r.ok && r.valor.map((p) => p.importe)).toEqual([
      "16.67",
      "16.67",
      "16.67",
      "16.67",
      "16.66",
      "16.66",
    ]);
  });
  it("2 a 6 partes", () => {
    expect(repartirEnPartesIguales("1.00", 1)).toEqual({ ok: false, error: "PARTES_INVALIDAS" });
    expect(repartirEnPartesIguales("1.00", 7)).toEqual({ ok: false, error: "PARTES_INVALIDAS" });
  });
});

describe("por porcentaje", () => {
  it("la parte 1 es el resto hasta 100 %", () => {
    const r = repartirPorPorcentaje("200.00", ["25", "25"]);
    expect(r.ok && r.valor.map((p) => p.importe)).toEqual(["100.00", "50.00", "50.00"]);
  });
  it("restos mayores por centavo; en el empate, la de menor número", () => {
    const r = repartirPorPorcentaje("0.10", ["33.3333", "33.3333"]);
    expect(r.ok && suma(r.valor)).toBe(10n);
    expect(r.ok && r.valor.map((p) => p.importe)).toEqual(["0.04", "0.03", "0.03"]);
  });
  it("rechaza porcentajes que pasan de 100 % o no son porcentajes", () => {
    expect(repartirPorPorcentaje("1.00", ["60", "50"])).toEqual({
      ok: false,
      error: "PORCENTAJE_INVALIDO",
    });
    expect(repartirPorPorcentaje("1.00", ["x"])).toEqual({
      ok: false,
      error: "PORCENTAJE_INVALIDO",
    });
    expect(repartirPorPorcentaje("1.00", [])).toEqual({ ok: false, error: "PARTES_INVALIDAS" });
    expect(repartirPorPorcentaje("1.00", ["1", "1", "1", "1", "1", "1"])).toEqual({
      ok: false,
      error: "PARTES_INVALIDAS",
    });
  });
});

describe("reparto: propiedades (P15)", () => {
  const total = fc.bigInt({ min: 0n, max: 10n ** 12n });
  it("la suma de las partes es el total al centavo y es determinista (ítem compartido)", () => {
    fc.assert(
      fc.property(total, fc.subarray([1, 2, 3, 4], { minLength: 2 }), (t, cuentas) => {
        const r = repartirItemCompartido(texto(t), cuentas);
        expect(r.ok && suma(r.valor)).toBe(t);
        expect(repartirItemCompartido(texto(t), cuentas)).toEqual(r);
        if (r.ok) {
          const menor = Math.min(...cuentas);
          const mayor = r.valor.reduce((a, p) =>
            centavos(p.importe) > centavos(a.importe) ? p : a,
          );
          expect(centavos(mayor.importe) >= centavos(r.valor[1]?.importe ?? "0")).toBe(true);
          expect(r.valor[0]?.parte).toBe(menor);
        }
      }),
    );
  });
  it("partes iguales: suman el total y difieren a lo sumo en un centavo", () => {
    fc.assert(
      fc.property(total, fc.integer({ min: 2, max: 6 }), (t, n) => {
        const r = repartirEnPartesIguales(texto(t), n);
        if (!r.ok) throw new Error("esperaba ok");
        expect(suma(r.valor)).toBe(t);
        const cs = r.valor.map((p) => centavos(p.importe));
        expect(Math.max(...cs.map(Number)) - Math.min(...cs.map(Number))).toBeLessThanOrEqual(1);
      }),
    );
  });
  it("por porcentaje: suman el total y cada parte difiere a lo sumo en un centavo de la exacta", () => {
    fc.assert(
      fc.property(
        total,
        fc.array(fc.integer({ min: 0, max: 200_000 }), { minLength: 1, maxLength: 5 }),
        (t, ps) => {
          const r = repartirPorPorcentaje(
            texto(t),
            ps.map((p) => `${Math.floor(p / 10000)}.${String(p % 10000).padStart(4, "0")}`),
          );
          if (!r.ok) throw new Error("esperaba ok");
          expect(suma(r.valor)).toBe(t);
          for (const [i, parte] of r.valor.entries()) {
            const puntos =
              i === 0 ? 1_000_000 - ps.reduce((a, p) => a + p, 0) : (ps[i - 1] as number);
            const exacto = (t * BigInt(puntos)) / 1_000_000n;
            const diferencia = centavos(parte.importe) - exacto;
            expect(diferencia === 0n || diferencia === 1n).toBe(true);
          }
          expect(
            repartirPorPorcentaje(texto(t), [
              ...ps.map((p) => `${Math.floor(p / 10000)}.${String(p % 10000).padStart(4, "0")}`),
            ]),
          ).toEqual(r);
        },
      ),
    );
  });
});
