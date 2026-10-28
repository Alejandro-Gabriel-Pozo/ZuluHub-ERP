import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import {
  listaDePreciosDelProducto,
  type OpcionConRecargo,
  type ProductoParaPrecios,
} from "./precios";

/**
 * Propiedades de la lista de precios (D3, C-12 hermano): el oráculo es aritmética `bigint` escrita aparte,
 * sobre texto decimal, sin pasar por la primitiva de dinero ni por `number`.
 */

const ESCALA = 6;
const U = 10n ** BigInt(ESCALA);

/** Texto decimal de un precio: parte entera y 0 a 6 decimales (como los escribe el catálogo). */
const decimal = fc
  .tuple(fc.nat(2_000_000), fc.stringMatching(/^[0-9]{0,6}$/))
  .map(([entera, fraccion]) => (fraccion === "" ? `${entera}` : `${entera}.${fraccion}`));

/** Unidades de 1e-6 de un texto decimal ya generado. */
function unidades(texto: string): bigint {
  const [entera = "0", fraccion = ""] = texto.split(".");
  return BigInt(entera) * U + BigInt(fraccion.padEnd(ESCALA, "0"));
}

/** Suma exacta en 1e-6 → centavos, la mitad hacia arriba (todo es no negativo). */
function centavos(totalEnMillonesimos: bigint): string {
  const c = (totalEnMillonesimos + 5_000n) / 10_000n;
  const texto = c.toString().padStart(3, "0");
  return `${texto.slice(0, -2)}.${texto.slice(-2)}`;
}

const opcion = (i: number, recargo: string): OpcionConRecargo => ({ nombre: `o${i}`, recargo });
const opciones = fc
  .array(decimal, { minLength: 1, maxLength: 6 })
  .map((rs) => rs.map((r, i) => opcion(i, r)));
const grupo = (titulo: string) => opciones.map((o) => ({ titulo, opciones: o }));

const producto: fc.Arbitrary<ProductoParaPrecios> = fc.record({
  precioBase: decimal,
  tamanos: fc.oneof(fc.constant([]), opciones),
  obligatorios: fc.array(grupo("obligatorio"), { maxLength: 2 }),
  adicionales: fc.array(grupo("adicional"), { maxLength: 2 }),
});

function lista(p: ProductoParaPrecios) {
  const r = listaDePreciosDelProducto(p);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.valor;
}

const menor = (xs: bigint[]) => xs.reduce((a, b) => (b < a ? b : a));
const mayor = (xs: bigint[]) => xs.reduce((a, b) => (b > a ? b : a));

describe("listaDePreciosDelProducto: propiedades", () => {
  it("cada precio final es la suma EXACTA de base + recargo, redondeada una sola vez", () => {
    fc.assert(
      fc.property(producto, (p) => {
        const l = lista(p);
        expect(l.tamanos).toHaveLength(p.tamanos.length);
        for (const [i, t] of p.tamanos.entries()) {
          expect(l.tamanos[i]).toEqual({
            nombre: t.nombre,
            precio: {
              moneda: "ARS",
              monto: centavos(unidades(p.precioBase) + unidades(t.recargo)),
            },
          });
        }
      }),
    );
  });

  it("el precio de la lista es el mínimo exacto (base + el menor recargo de cada obligatorio) y «desde» refleja si hay más de un precio", () => {
    fc.assert(
      fc.property(producto, (p) => {
        const l = lista(p);
        const grupos = [
          ...(p.tamanos.length > 0 ? [p.tamanos] : []),
          ...p.obligatorios.map((g) => g.opciones),
        ];
        const piso =
          unidades(p.precioBase) +
          grupos.reduce((s, g) => s + menor(g.map((o) => unidades(o.recargo))), 0n);
        const techo =
          unidades(p.precioBase) +
          grupos.reduce((s, g) => s + mayor(g.map((o) => unidades(o.recargo))), 0n);
        expect(l.precioDeLista).toEqual({ moneda: "ARS", monto: centavos(piso) });
        expect(l.desde).toBe(centavos(piso) !== centavos(techo));
      }),
    );
  });

  it("sin grupos obligatorios no hay «desde» y el precio es el base (los adicionales no lo mueven)", () => {
    fc.assert(
      fc.property(producto, (p) => {
        const sin = { ...p, tamanos: [], obligatorios: [] };
        const l = lista(sin);
        expect(l.desde).toBe(false);
        expect(l.precioDeLista).toEqual({ moneda: "ARS", monto: centavos(unidades(p.precioBase)) });
      }),
    );
  });

  it("el orden es estable: sale en el orden de entrada y reordenar la entrada reordena igual la salida", () => {
    fc.assert(
      fc.property(
        decimal,
        fc.array(decimal, { minLength: 1, maxLength: 7 }).chain((rs) =>
          fc.tuple(
            fc.constant(rs),
            fc.shuffledSubarray(
              rs.map((_, i) => i),
              { minLength: rs.length, maxLength: rs.length },
            ),
          ),
        ),
        (base, [recargos, permutacion]) => {
          const original = recargos.map((r, i) => opcion(i, r));
          const permutadas = permutacion.map((i) => original[i] as OpcionConRecargo);
          const a = lista({
            precioBase: base,
            tamanos: original,
            obligatorios: [],
            adicionales: [],
          });
          const b = lista({
            precioBase: base,
            tamanos: permutadas,
            obligatorios: [],
            adicionales: [],
          });
          expect(a.tamanos.map((t) => t.nombre)).toEqual(original.map((o) => o.nombre));
          expect(b.tamanos.map((t) => t.nombre)).toEqual(permutadas.map((o) => o.nombre));
          // El precio de la lista y el «desde» no dependen del orden.
          expect(b.precioDeLista).toEqual(a.precioDeLista);
          expect(b.desde).toBe(a.desde);
        },
      ),
    );
  });

  it("los recargos de grupos se muestran redondeados y vacíos cuando se ven como cero", () => {
    fc.assert(
      fc.property(producto, (p) => {
        const l = lista(p);
        for (const [g, grupoLeido] of [...l.obligatorios, ...l.adicionales].entries()) {
          const origen = [...p.obligatorios, ...p.adicionales][g];
          for (const [i, o] of grupoLeido.opciones.entries()) {
            const monto = centavos(unidades((origen?.opciones[i] as OpcionConRecargo).recargo));
            expect(o.recargo).toEqual(monto === "0.00" ? null : { moneda: "ARS", monto });
          }
        }
      }),
    );
  });

  it("todo importe sale como texto con dos decimales y moneda ARS, nunca como number", () => {
    fc.assert(
      fc.property(producto, (p) => {
        const l = lista(p);
        const importes = [
          l.precioDeLista,
          ...l.tamanos.map((t) => t.precio),
          ...[...l.obligatorios, ...l.adicionales].flatMap((g) =>
            g.opciones.flatMap((o) => (o.recargo ? [o.recargo] : [])),
          ),
        ];
        for (const i of importes) {
          expect(i.moneda).toBe("ARS");
          expect(typeof i.monto).toBe("string");
          expect(i.monto).toMatch(/^(0|[1-9][0-9]*)\.[0-9]{2}$/);
        }
      }),
    );
  });

  it("no cambia la entrada", () => {
    fc.assert(
      fc.property(producto, (p) => {
        const copia = structuredClone(p);
        lista(p);
        expect(p).toEqual(copia);
      }),
    );
  });
});
