import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import { coincideConLaBusqueda, filtrarSecciones, normalizarParaBuscar } from "./busqueda";

/** Propiedades de la búsqueda (D8): nunca pierde un resultado exacto y no inventa ninguno. */

const texto = fc.oneof(
  fc.string({ maxLength: 30 }),
  fc.string({ unit: "grapheme", maxLength: 30 }),
);
const producto = fc.record({
  nombre: texto,
  descripcion: fc.oneof(fc.constant(null), texto),
});
const seccion = fc.record({
  id: fc.string({ maxLength: 5 }),
  nombre: texto,
  productos: fc.array(producto, { maxLength: 6 }),
});

describe("búsqueda: propiedades", () => {
  it("el nombre exacto de un producto lo encuentra siempre", () => {
    fc.assert(
      fc.property(producto, (p) => {
        expect(coincideConLaBusqueda(p, p.nombre)).toBe(true);
      }),
    );
  });

  it("en una carta, buscar el nombre exacto devuelve al menos ese producto", () => {
    fc.assert(
      fc.property(
        fc.array(seccion, { minLength: 1, maxLength: 4 }),
        fc.nat(),
        (secciones, azar) => {
          const todos = secciones.flatMap((s) => s.productos);
          fc.pre(todos.length > 0);
          const elegido = todos[azar % todos.length];
          if (elegido === undefined) return;
          const r = filtrarSecciones(secciones, elegido.nombre);
          expect(r.secciones.flatMap((s) => s.productos)).toContain(elegido);
        },
      ),
    );
  });

  it("buscar lo escrito o su forma normalizada (sin tildes ni mayúsculas) da lo mismo", () => {
    fc.assert(
      fc.property(producto, texto, (p, consulta) => {
        const base = coincideConLaBusqueda(p, consulta);
        expect(coincideConLaBusqueda(p, normalizarParaBuscar(consulta))).toBe(base);
      }),
    );
  });

  it("nunca inventa ni duplica: lo devuelto está en lo recibido, en el mismo orden relativo", () => {
    fc.assert(
      fc.property(fc.array(seccion, { maxLength: 4 }), texto, (secciones, consulta) => {
        const r = filtrarSecciones(secciones, consulta);
        expect(r.total).toBe(r.secciones.reduce((n, s) => n + s.productos.length, 0));
        let desde = 0;
        for (const s of r.secciones) {
          const origen = secciones.findIndex(
            (x, i) => i >= desde && x.id === s.id && x.nombre === s.nombre,
          );
          expect(origen).toBeGreaterThanOrEqual(0);
          desde = origen + 1;
          for (const p of s.productos) expect(coincideConLaBusqueda(p, consulta)).toBe(true);
        }
      }),
    );
  });

  it("una búsqueda vacía no pierde nada de lo que tiene productos", () => {
    fc.assert(
      fc.property(fc.array(seccion, { maxLength: 4 }), (secciones) => {
        const r = filtrarSecciones(secciones, "");
        expect(r.total).toBe(secciones.reduce((n, s) => n + s.productos.length, 0));
      }),
    );
  });
});
