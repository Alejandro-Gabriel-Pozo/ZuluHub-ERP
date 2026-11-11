import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import { cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import { multiplicarCantidades } from "../../../primitivas/cantidad/con-signo";
import { POLITICA_VIGENTE } from "../../../primitivas/dinero/redondeo";
import { explotarConsumo, type LineaVendida, type ProductoParaExplotar } from "./explosion";

/** Texto decimal de `unidades` con 4 decimales, escrito aparte de la implementación (oráculo). */
const aTexto = (unidades: bigint): string => {
  const s = unidades.toString().padStart(5, "0");
  return `${s.slice(0, s.length - 4)}.${s.slice(s.length - 4)}`;
};
const q = (u: bigint) => cantidadDesdeTexto(aTexto(u));

/** Oráculo: mitad hacia arriba (para valores positivos, la política vigente es esa). */
const mitadSube = (num: bigint, den: bigint): bigint => (2n * num + den) / (2n * den);

const unidades = fc.bigInt({ min: 1n, max: 9_999_999n });
const lineas = fc.array(unidades, { minLength: 1, maxLength: 6 });

const venta = (
  posicion: number,
  productoId: string,
  cantidad: bigint,
  over: Partial<LineaVendida> = {},
): LineaVendida => ({
  posicion,
  productoId,
  cantidad: q(cantidad),
  unidadDeVentaId: "UNIDAD",
  variante: null,
  opciones: [],
  ...over,
});
const sinProducto: ProductoParaExplotar = {
  claseDeUso: "REVENTA",
  unidadBaseId: "UNIDAD",
  articulo: null,
  composicion: null,
};

const unico = (r: ReturnType<typeof explotarConsumo>): bigint[] => {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.valor.renglones.map((x) => -x.cantidad.unidades);
};

describe("explotarConsumo: propiedades (P18)", () => {
  it("con una sola multiplicación coincide con multiplicarCantidades (el mismo redondeo, hecho una vez)", () => {
    fc.assert(
      fc.property(unidades, unidades, (c, cantidad) => {
        const r = explotarConsumo({
          lineas: [
            venta(1, "p", cantidad, {
              opciones: [
                {
                  versionDeOpcionId: "v",
                  consumos: [{ insumoId: "i", cantidad: q(c), escalaConTamano: false }],
                },
              ],
            }),
          ],
          productos: new Map([["p", sinProducto]]),
          articulosDeInsumos: new Map([
            ["i", { articuloId: "A", unidadDeStockId: "UNIDAD", activo: true }],
          ]),
        });
        const esperado = multiplicarCantidades(q(c), q(cantidad), POLITICA_VIGENTE);
        expect(esperado.ok).toBe(true);
        expect(unico(r)).toEqual(
          esperado.ok && esperado.valor.unidades === 0n
            ? []
            : [esperado.ok ? esperado.valor.unidades : -1n],
        );
      }),
    );
  });

  it("composición: el renglón es la suma exacta de todas las líneas, redondeada UNA vez, y no depende del orden", () => {
    fc.assert(
      fc.property(unidades, unidades, lineas, (cantidadDelComponente, rinde, ventas) => {
        const pizza: ProductoParaExplotar = {
          claseDeUso: "VENDIBLE",
          unidadBaseId: "UNIDAD",
          articulo: null,
          composicion: {
            composicionId: "c1",
            rinde: q(rinde),
            componentes: [
              {
                articuloId: "x",
                cantidad: q(cantidadDelComponente),
                unidadId: "UNIDAD",
                unidadDeStockId: "UNIDAD",
              },
            ],
          },
        };
        const explotar = (cantidades: bigint[]) =>
          unico(
            explotarConsumo({
              lineas: cantidades.map((c, i) => venta(i + 1, "pizza", c)),
              productos: new Map([["pizza", pizza]]),
              articulosDeInsumos: new Map(),
            }),
          );
        const suma = ventas.reduce((a, v) => a + v, 0n);
        // unidades mínimas: (c × Σq) ÷ rinde, redondeado una vez
        const esperado = mitadSube(cantidadDelComponente * suma, rinde);
        expect(explotar(ventas)).toEqual(esperado === 0n ? [] : [esperado]);
        expect(explotar([...ventas].reverse())).toEqual(explotar(ventas));
      }),
    );
  });

  it("opción escalada por tamaño: cantidad × q × factor ÷ 10⁸, redondeado una vez sobre la suma de las líneas", () => {
    fc.assert(
      fc.property(unidades, fc.bigInt({ min: 1n, max: 99_999n }), lineas, (c, factor, ventas) => {
        const opciones = [
          {
            versionDeOpcionId: "v",
            consumos: [{ insumoId: "i", cantidad: q(c), escalaConTamano: true }],
          },
        ];
        const r = explotarConsumo({
          lineas: ventas.map((v, i) =>
            venta(i + 1, "p", v, {
              opciones,
              variante: { versionDeOpcionId: "g", factorDeTamano: q(factor) },
            }),
          ),
          productos: new Map([["p", sinProducto]]),
          articulosDeInsumos: new Map([
            ["i", { articuloId: "A", unidadDeStockId: "UNIDAD", activo: true }],
          ]),
        });
        const suma = ventas.reduce((a, v) => a + v, 0n);
        const esperado = mitadSube(c * suma * factor, 10_000n * 10_000n);
        expect(unico(r)).toEqual(esperado === 0n ? [] : [esperado]);
      }),
    );
  });

  it("todo renglón sale con cantidad negativa y distinta de cero", () => {
    fc.assert(
      fc.property(lineas, (ventas) => {
        const r = explotarConsumo({
          lineas: ventas.map((v, i) => venta(i + 1, "p", v)),
          productos: new Map([
            [
              "p",
              {
                ...sinProducto,
                articulo: { articuloId: "A", unidadDeStockId: "UNIDAD", activo: true },
              },
            ],
          ]),
          articulosDeInsumos: new Map(),
        });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.valor.renglones).toHaveLength(1);
        for (const x of r.valor.renglones) expect(x.cantidad.unidades < 0n).toBe(true);
        expect(unico(r)).toEqual([ventas.reduce((a, v) => a + v, 0n)]);
      }),
    );
  });
});
