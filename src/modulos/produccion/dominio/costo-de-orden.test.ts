import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { costearOrden } from "./costo-de-orden";

const peso = (n: number) => BigInt(n) * 1_000_000n;
describe("costo de la orden (D3 de la especificación)", () => {
  it("6 kg a $1.000 y 2 kg a $9.000 → 9,5 kg: $24.000 y $2.526,315789 por kg", () => {
    const r = costearOrden(
      [
        { unidades: 60_000n, costoUnitario: peso(1000) },
        { unidades: 20_000n, costoUnitario: peso(9000) },
      ],
      95_000n,
    );
    expect(r).toEqual({
      estado: "DEFINITIVO",
      costoTotalExacto: 240_000_000_000_000n,
      costoUnitario: 2_526_315_789n,
      residuo: expect.any(BigInt) as bigint,
    });
    if (r.estado === "DEFINITIVO")
      expect(r.residuo).toBe(2_526_315_789n * 95_000n - r.costoTotalExacto);
  });
  it("un ingrediente consumido sin costo deja el producto sin costo; uno sin consumo no cuenta", () => {
    expect(
      costearOrden(
        [
          { unidades: 10n, costoUnitario: null },
          { unidades: 5n, costoUnitario: 1n },
        ],
        10n,
      ),
    ).toEqual({ estado: "SIN_COSTO" });
    expect(
      costearOrden(
        [
          { unidades: 0n, costoUnitario: null },
          { unidades: 10_000n, costoUnitario: peso(2) },
        ],
        10_000n,
      ),
    ).toMatchObject({ estado: "DEFINITIVO", costoUnitario: 2_000_000n });
  });
  it("lo obtenido tiene que ser mayor que cero", () => {
    expect(() => costearOrden([], 0n)).toThrow("lo obtenido es mayor que cero");
  });
  it("sin consumos el costo es cero", () => {
    expect(costearOrden([], 1n)).toEqual({
      estado: "DEFINITIVO",
      costoTotalExacto: 0n,
      costoUnitario: 0n,
      residuo: 0n,
    });
  });
  it("propiedad: el residuo de redondeo no pasa de la mitad de lo obtenido (5×10⁻⁷ por unidad)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            unidades: fc.bigInt({ min: 1n, max: 10n ** 9n }),
            costoUnitario: fc.bigInt({ min: 0n, max: 10n ** 11n }),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        fc.bigInt({ min: 1n, max: 10n ** 9n }),
        (consumos, obtenido) => {
          const r = costearOrden(consumos, obtenido);
          if (r.estado !== "DEFINITIVO") throw new Error("falla");
          const abs = r.residuo < 0n ? -r.residuo : r.residuo;
          expect(abs * 2n <= obtenido).toBe(true);
        },
      ),
    );
  });
});
