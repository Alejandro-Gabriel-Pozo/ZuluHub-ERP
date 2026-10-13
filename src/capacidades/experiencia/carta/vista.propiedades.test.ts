import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import type { CartaPublicada, ProductoPublicado } from "../../../puertos/carta-publica";
import { armarVistaDeCarta, formatearImporte } from "./vista";

/** Propiedades de la vista de la carta: el dinero se lee bien y nada interno sale hacia el navegador. */

describe("formatearImporte: propiedades", () => {
  // Oráculo escrito aparte: los dígitos del entero, agrupados de a tres desde la derecha con punto.
  it("quita puntos y coma y queda el monto de origen, con grupos de tres desde la derecha", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 15n }), fc.nat(99), (enteros, centavos) => {
        const fraccion = String(centavos).padStart(2, "0");
        const texto = formatearImporte({ moneda: "ARS", monto: `${enteros}.${fraccion}` });
        expect(texto.startsWith("$ ")).toBe(true);
        const [parteEntera = "", parteDecimal] = texto.slice(2).split(",");
        expect(parteEntera.replaceAll(".", "")).toBe(String(enteros));
        const grupos = parteEntera.split(".");
        expect(grupos[0]?.length).toBeGreaterThanOrEqual(1);
        expect(grupos[0]?.length).toBeLessThanOrEqual(3);
        for (const g of grupos.slice(1)) expect(g).toHaveLength(3);
        // Centavos solo si no son cero, y tal cual.
        expect(parteDecimal).toBe(centavos === 0 ? undefined : fraccion);
      }),
    );
  });
});

const decimal = fc.nat(2_000_000).map(String);
const uuid = fc.uuid({ version: 4 });
const nombre = fc.string({ minLength: 1, maxLength: 24 });

const producto: fc.Arbitrary<ProductoPublicado> = fc.record({
  id: uuid,
  nombre,
  descripcion: fc.constant(null),
  agotado: fc.boolean(),
  foto: fc.constant(null),
  precioBase: decimal,
  tamanos: fc.array(fc.record({ nombre, recargo: decimal }), { maxLength: 3 }),
  obligatorios: fc.constant([]),
  adicionales: fc.constant([]),
});

const carta: fc.Arbitrary<CartaPublicada> = fc.record({
  id: uuid,
  codigo: fc.constant("c"),
  nombre,
  rubro: nombre,
  lugar: fc.constant(null),
  letraBase: fc.constantFrom("NORMAL" as const, "GRANDE" as const),
  secciones: fc.array(
    fc.record({ id: uuid, nombre, productos: fc.array(producto, { minLength: 1, maxLength: 5 }) }),
    { minLength: 1, maxLength: 4 },
  ),
});

describe("armarVistaDeCarta: propiedades", () => {
  it("ningún id interno sale en la vista y las direcciones de los productos no se repiten", () => {
    fc.assert(
      fc.property(carta, (c) => {
        const ids = [c.id, ...c.secciones.flatMap((s) => [s.id, ...s.productos.map((p) => p.id)])];
        fc.pre(new Set(ids).size === ids.length);
        const v = armarVistaDeCarta(c, "/c");
        const json = JSON.stringify(v);
        for (const id of ids) expect(json).not.toContain(id);
        const hrefs = v.secciones.flatMap((s) => s.productos.map((p) => p.href));
        expect(new Set(hrefs).size).toBe(hrefs.length);
        expect(v.totalDeProductos).toBe(hrefs.length);
      }),
    );
  });

  it("las anclas de las secciones no se repiten y solo tienen letras, números y guiones", () => {
    fc.assert(
      fc.property(carta, (c) => {
        const anclas = armarVistaDeCarta(c, "/c").secciones.map((s) => s.id);
        expect(new Set(anclas).size).toBe(anclas.length);
        for (const a of anclas) expect(a).toMatch(/^[a-z0-9-]+$/);
      }),
    );
  });

  it("el precio de la lista es el menor de los precios de la tarjeta y dice «desde» solo si hay más de uno", () => {
    fc.assert(
      fc.property(carta, (c) => {
        for (const s of armarVistaDeCarta(c, "/c").secciones) {
          for (const p of s.productos) {
            expect(p.precioEnLista.startsWith("desde ")).toBe(
              new Set(p.tamanos.map((t) => t.precio)).size > 1,
            );
          }
        }
      }),
    );
  });
});
