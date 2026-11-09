import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import { cantidadDesdeTexto, type Cantidad } from "../cantidad/cantidad";
import { convertirCantidad } from "./convertir-cantidad";
import { UNIDADES, type CodigoDeUnidad } from "./unidades";

/**
 * Propiedades de `convertirCantidad`. El oráculo es aritmética `bigint` escrita aparte (producto cruzado), sin pasar por la función.
 */
const MAXIMO = 10n ** 18n - 1n;
const CODIGOS = Object.keys(UNIDADES) as CodigoDeUnidad[];

const unidades = fc.oneof(
  fc.bigInt({ min: 0n, max: MAXIMO }),
  fc.bigInt({ min: 0n, max: 10_000_000n }),
  fc.constantFrom(0n, 1n, MAXIMO, MAXIMO - 1n),
);
const codigo = fc.constantFrom(...CODIGOS);
const mismaDimension = codigo.chain((de) =>
  fc.tuple(
    fc.constant(de),
    fc.constantFrom(...CODIGOS.filter((c) => UNIDADES[c].dimension === UNIDADES[de].dimension)),
  ),
);

function textoDe(u: bigint): string {
  const s = u.toString().padStart(5, "0");
  return `${s.slice(0, -4)}.${s.slice(-4)}`;
}
function cantidadDe(u: bigint): Cantidad {
  return cantidadDesdeTexto(textoDe(u));
}

describe("convertirCantidad (propiedades)", () => {
  it("si devuelve un valor, es exacto: valor × factor(a) = unidades × factor(de), sin redondeo", () => {
    fc.assert(
      fc.property(unidades, mismaDimension, (u, [de, a]) => {
        const r = convertirCantidad(cantidadDe(u), de, a);
        if (r.ok) expect(r.valor.unidades * UNIDADES[a].factor).toBe(u * UNIDADES[de].factor);
      }),
    );
  });

  it("nunca un resultado redondeado: sin resto es exacto (o fuera de rango); con resto es CONVERSION_NO_EXACTA", () => {
    fc.assert(
      fc.property(unidades, mismaDimension, (u, [de, a]) => {
        const producto = u * UNIDADES[de].factor;
        const r = convertirCantidad(cantidadDe(u), de, a);
        if (producto % UNIDADES[a].factor !== 0n) {
          expect(r).toEqual({ ok: false, error: "CONVERSION_NO_EXACTA" });
        } else if (producto / UNIDADES[a].factor > MAXIMO) {
          expect(r).toEqual({ ok: false, error: "FUERA_DE_RANGO" });
        } else {
          expect(r.ok).toBe(true);
        }
      }),
    );
  });

  it("ida y vuelta exacta cuando la ida es exacta", () => {
    fc.assert(
      fc.property(unidades, mismaDimension, (u, [de, a]) => {
        const c = cantidadDe(u);
        const ida = convertirCantidad(c, de, a);
        fc.pre(ida.ok);
        if (!ida.ok) return;
        const vuelta = convertirCantidad(ida.valor, a, de);
        expect(vuelta).toEqual({ ok: true, valor: c });
      }),
    );
  });

  it("entre dimensiones distintas siempre DIMENSION_DISTINTA", () => {
    fc.assert(
      fc.property(unidades, codigo, codigo, (u, de, a) => {
        fc.pre(UNIDADES[de].dimension !== UNIDADES[a].dimension);
        expect(convertirCantidad(cantidadDe(u), de, a)).toEqual({
          ok: false,
          error: "DIMENSION_DISTINTA",
        });
      }),
    );
  });

  it("la misma unidad es identidad", () => {
    fc.assert(
      fc.property(unidades, codigo, (u, c) => {
        expect(convertirCantidad(cantidadDe(u), c, c)).toEqual({ ok: true, valor: cantidadDe(u) });
      }),
    );
  });

  it("subir a una unidad mayor y bajar a la base: pasar por la base da lo mismo que ir directo", () => {
    fc.assert(
      fc.property(unidades, mismaDimension, (u, [de, a]) => {
        const base = CODIGOS.find(
          (c) => UNIDADES[c].dimension === UNIDADES[de].dimension && UNIDADES[c].factor === 1n,
        );
        if (base === undefined) throw new Error("dimensión sin base");
        const directo = convertirCantidad(cantidadDe(u), de, a);
        const aBase = convertirCantidad(cantidadDe(u), de, base);
        fc.pre(directo.ok && aBase.ok);
        if (!directo.ok || !aBase.ok) return;
        expect(convertirCantidad(aBase.valor, base, a)).toEqual(directo);
      }),
    );
  });

  it("1 g a toneladas nunca cabe en 4 decimales, y cualquier cantidad menor que 100 g tampoco", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 999_999n }), (u) => {
        // u/10^4 g (menos de 100 g) en toneladas: no es múltiplo de 10^-4 t salvo que sea 0.
        expect(convertirCantidad(cantidadDe(u), "GRAMO", "TONELADA")).toEqual({
          ok: false,
          error: "CONVERSION_NO_EXACTA",
        });
      }),
    );
  });
});
