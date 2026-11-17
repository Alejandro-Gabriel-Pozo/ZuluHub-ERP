import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { precioUnitarioATexto, precioUnitarioDesdeTexto } from "./precio-unitario";
import { precioDeVentaDesdeTexto, precioPorFactor, sumarPrecios } from "./precio-de-venta";

const precio = (t: string) => precioUnitarioDesdeTexto(t);

describe("precio de venta", () => {
  it("lee texto decimal exacto y rechaza lo demás sin lanzar", () => {
    expect(precioDeVentaDesdeTexto("1234.50")).toMatchObject({ ok: true });
    for (const malo of ["", "abc", "1,5", "-1", "1e3", "1.1234567", " 1", "1.", "01"]) {
      expect(precioDeVentaDesdeTexto(malo), malo).toEqual({ ok: false, error: "PRECIO_INVALIDO" });
    }
  });
  it("F3 (propiedad): la suma es exacta, base + Σ recargos, con decimales aleatorios hasta 6 cifras", () => {
    const centavos = fc.bigInt({ min: 0n, max: 10n ** 12n });
    fc.assert(
      fc.property(centavos, fc.array(centavos, { maxLength: 6 }), (base, recargos) => {
        const texto = (n: bigint) =>
          `${n / 1_000_000n}.${(n % 1_000_000n).toString().padStart(6, "0")}`;
        const total = sumarPrecios(
          precio(texto(base)),
          recargos.map((r) => precio(texto(r))),
        );
        expect(total.unidades).toBe(recargos.reduce((a, r) => a + r, base));
        expect(precioUnitarioATexto(total)).toBe(
          texto(base + recargos.reduce((a, r) => a + r, 0n)),
        );
      }),
    );
  });
  it("el ejemplo del enunciado: chico 3000 + adicional 600 = 3600; grande 4000 + 600 = 4600", () => {
    expect(precioUnitarioATexto(sumarPrecios(precio("3000"), [precio("600")]))).toBe("3600.000000");
    expect(precioUnitarioATexto(sumarPrecios(precio("4000"), [precio("600")]))).toBe("4600.000000");
  });
  it("una suma que no entra en `numeric(18,6)` falla en vez de truncar", () => {
    const grande = precio("999999999999.999999");
    expect(() => sumarPrecios(grande, [grande, grande, grande, grande])).toThrow();
  });
  it("llevar un precio de una unidad a otra: exacto o nulo, nunca redondea", () => {
    // kilo → gramo: ÷ 1000
    expect(precioPorFactor(precio("3000"), 1n, 1000n)).toEqual(precio("3"));
    expect(precioPorFactor(precio("3.333333"), 1n, 1000n)).toBeNull(); // 0,003333333: no entra en 6 decimales
    // gramo → kilo: × 1000
    expect(precioPorFactor(precio("3"), 1000n, 1n)).toEqual(precio("3000"));
    expect(precioPorFactor(precio("999999999999.999999"), 1000n, 1n)).toBeNull(); // fuera de rango
    expect(() => precioPorFactor(precio("1"), 1n, 0n)).toThrow("factor inválido");
    expect(() => precioPorFactor(precio("1"), 1n, -1n)).toThrow("factor inválido");
    expect(() => precioPorFactor(precio("1"), -1n, 1n)).toThrow("factor inválido");
    expect(() => precioPorFactor(precio("1"), -1n, 0n)).toThrow("factor inválido");
    expect(precioPorFactor(precio("5"), 0n, 1n)).toEqual(precio("0")); // factor cero: válido, da cero
  });
});
