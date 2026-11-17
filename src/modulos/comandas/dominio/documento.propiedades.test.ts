import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import { cantidadParaPapel } from "./documento";

/** El oráculo: interpreta el texto del papel y devuelve la cantidad en diezmilésimas. */
function interpretar(texto: string): bigint {
  const m = /^(?:(\d+) )?(?:(\d+)\/(\d+))?$|^(\d+)$/.exec(texto);
  if (m === null) throw new Error(`no se entiende: ${texto}`);
  if (m[4] !== undefined) return BigInt(m[4]) * 10_000n;
  const entera = BigInt(m[1] ?? "0");
  const frac = m[2] === undefined ? 0n : (BigInt(m[2]) * 10_000n) / BigInt(m[3] as string);
  return entera * 10_000n + frac;
}
const aTexto = (u: bigint): string => `${u / 10_000n}.${(u % 10_000n).toString().padStart(4, "0")}`;

describe("cantidadParaPapel: propiedades (P15)", () => {
  it("para todo múltiplo de 1/8 el texto vuelve a la misma cantidad y nunca usa «½»", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 9999 * 8 }), (octavos) => {
        const u = BigInt(octavos) * 1_250n;
        const r = cantidadParaPapel(aTexto(u), { unidadDeVenta: "UNIDAD", paso: "0.125" });
        if (!r.ok) throw new Error("esperaba ok");
        expect(r.valor).not.toMatch(/[½¼¾⅛]/);
        expect(interpretar(r.valor)).toBe(u);
        // la fracción es siempre propia y reducida
        const f = /(\d+)\/(\d+)/.exec(r.valor);
        if (f !== null) {
          expect(Number(f[1])).toBeLessThan(Number(f[2]));
          expect([2, 4, 8]).toContain(Number(f[2]));
          expect(Number(f[1]) % 2).toBe(1);
        } else {
          expect(r.valor).toMatch(/^\d+$/);
        }
      }),
    );
  });
  it("por peso nunca imprime fracciones", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 999_999 }), (g) => {
        const r = cantidadParaPapel(aTexto(BigInt(g) * 10_000n), {
          unidadDeVenta: "GRAMO",
          paso: "1",
        });
        expect(r).toEqual({ ok: true, valor: `${g} g` });
      }),
    );
  });
});
