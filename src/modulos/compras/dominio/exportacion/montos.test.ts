import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { costoPorKiloDerivado, repartirConMayorResto } from "./montos";

describe("repartirConMayorResto", () => {
  it("100,00 en tres partes iguales: 33,34 / 33,33 / 33,33 y la suma da exacto", () => {
    expect(repartirConMayorResto(10000n, [1n, 1n, 1n])).toEqual([3334n, 3333n, 3333n]);
  });
  it("reparte por el peso y el centavo sobrante va a quien tiene el mayor resto", () => {
    // 10 centavos entre pesos 1, 2 y 3: cuotas 1,667 / 3,333 / 5 -> pisos 1/3/5 y sobra 1 para el mayor resto (el primero: 0,667).
    expect(repartirConMayorResto(10n, [1n, 2n, 3n])).toEqual([2n, 3n, 5n]);
  });
  it("sin nadie a quien repartir: nada si hay algo que repartir, ceros si no", () => {
    expect(repartirConMayorResto(500n, [])).toBeNull();
    expect(repartirConMayorResto(500n, [0n, 0n])).toBeNull();
    expect(repartirConMayorResto(0n, [0n, 0n])).toEqual([0n, 0n]);
  });
  it("lo negativo se rechaza", () => {
    expect(repartirConMayorResto(-1n, [1n])).toBeNull();
    // Con un peso negativo la suma no es cero: lo único que lo frena es el rechazo del peso negativo.
    expect(repartirConMayorResto(10n, [3n, -1n])).toBeNull();
    expect(repartirConMayorResto(10n, [-1n, 3n])).toBeNull();
  });

  it("el centavo que sobra va al MAYOR resto, no al primero", () => {
    // 10 entre 3, 2 y 1: pisos 5, 3, 1 (suman 9) y restos 0, 2, 4: el centavo es del tercero.
    expect(repartirConMayorResto(10n, [3n, 2n, 1n])).toEqual([5n, 3n, 2n]);
    // Y con dos centavos que sobran, a los dos mayores restos en su orden.
    expect(repartirConMayorResto(11n, [3n, 2n, 1n])).toEqual([5n, 4n, 2n]);
  });

  it("con restos iguales el centavo va al primero en el orden dado (el mismo pedido da siempre el mismo archivo)", () => {
    expect(repartirConMayorResto(2n, [1n, 1n, 1n])).toEqual([1n, 1n, 0n]);
    expect(repartirConMayorResto(1n, [1n, 1n, 1n])).toEqual([1n, 0n, 0n]);
    // Empate entre el segundo y el tercero, con el primero de menor resto: el centavo sobrante es del segundo.
    expect(repartirConMayorResto(5n, [1n, 3n, 3n])).toEqual([1n, 2n, 2n]);
    // Con muchos empatados, los centavos van a los primeros en orden.
    expect(repartirConMayorResto(3n, [1n, 1n, 1n, 1n, 1n, 1n])).toEqual([1n, 1n, 1n, 0n, 0n, 0n]);
    expect(repartirConMayorResto(4n, [2n, 2n, 2n, 2n, 2n, 2n, 2n, 2n])).toEqual([
      1n,
      1n,
      1n,
      1n,
      0n,
      0n,
      0n,
      0n,
    ]);
  });
  it("propiedad: la suma de las partes es siempre exactamente el total, ninguna parte es negativa y es determinista", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 12n }),
        fc.array(fc.bigInt({ min: 0n, max: 10n ** 9n }), { minLength: 1, maxLength: 12 }),
        (total, pesos) => {
          const a = repartirConMayorResto(total, pesos);
          if (pesos.every((p) => p === 0n)) {
            expect(a).toEqual(total === 0n ? pesos.map(() => 0n) : null);
            return;
          }
          expect(a).not.toBeNull();
          expect((a as bigint[]).reduce((x, y) => x + y, 0n)).toBe(total);
          expect((a as bigint[]).every((p) => p >= 0n)).toBe(true);
          expect(repartirConMayorResto(total, pesos)).toEqual(a);
        },
      ),
    );
  });
});

describe("costoPorKiloDerivado", () => {
  it("266.252,40 por 20 kg es 13.312,620000 por kilo (línea 1 de la factura real)", () => {
    expect(costoPorKiloDerivado(26625240n, 200000n, "KILOGRAMO")).toBe("13312.620000");
  });
  it("en gramos: 20.000 g son los mismos 20 kg", () => {
    expect(costoPorKiloDerivado(26625240n, 200000000n, "GRAMO")).toBe("13312.620000");
  });
  it("redondea a 6 decimales con mitad hacia arriba", () => {
    // 1,00 pesos / 3 kg = 0,333333 (cae en 0,3333333...: se queda en 0,333333)
    expect(costoPorKiloDerivado(100n, 30000n, "KILOGRAMO")).toBe("0.333333");
    // 2,00 / 3 kg = 0,666666...: sube a 0,666667
    expect(costoPorKiloDerivado(200n, 30000n, "KILOGRAMO")).toBe("0.666667");
  });
  it("sin importe, sin cantidad o con una unidad que no es de masa: vacío, nunca cero", () => {
    expect(costoPorKiloDerivado(null, 10000n, "KILOGRAMO")).toBeNull();
    expect(costoPorKiloDerivado(100n, 0n, "KILOGRAMO")).toBeNull();
    expect(costoPorKiloDerivado(100n, 10000n, "UNIDAD")).toBeNull();
    expect(costoPorKiloDerivado(100n, 10000n, "LITRO")).toBeNull();
  });
});
