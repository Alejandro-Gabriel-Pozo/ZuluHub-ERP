import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import { formaDeFamilia, type MiembroParaForma } from "./forma-de-familia";

/** Propiedades de `formaDeFamilia`: no depende del orden en que se listen los miembros salvo para devolverlos en ese orden; y nunca agrupa lo que no es vigente. */
const medida = fc.record({
  nombre: fc.constantFrom("Chico", "Mediano", "Grande", "Jarra"),
  orden: fc.integer({ min: 0, max: 3 }),
  precio: fc.option(fc.constantFrom("1500", "2000", "2300"), { nil: null }),
});
const miembro = (i: number) =>
  fc.record({
    productoId: fc.constant(`p${i}`),
    seccionId: fc.constantFrom("s1", "s2"),
    activo: fc.boolean(),
    oculto: fc.boolean(),
    medidas: fc.array(medida, { maxLength: 4 }),
    precio: fc.option(fc.constantFrom("1500", "2000", "abc"), { nil: null }),
  });
const miembros = fc
  .integer({ min: 0, max: 6 })
  .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => miembro(i))));

describe("formaDeFamilia (propiedades)", () => {
  it("el conjunto de productos y la forma no dependen del orden; el orden de salida es el de entrada", () => {
    fc.assert(
      fc.property(miembros, fc.boolean(), fc.boolean(), (lista, activa, carta) => {
        const base = { familiaActiva: activa, agruparEnCarta: carta };
        const a = formaDeFamilia({ ...base, miembros: lista });
        const b = formaDeFamilia({ ...base, miembros: [...lista].reverse() });
        expect(b.forma).toBe(a.forma);
        expect([...b.productos].sort()).toEqual([...a.productos].sort());
        const entrada = lista.map((m) => m.productoId);
        expect(a.productos).toEqual(entrada.filter((id) => a.productos.includes(id)));
      }),
    );
  });

  it("solo salen miembros activos y no ocultos, y se agrupa solo con dos o más", () => {
    fc.assert(
      fc.property(miembros, (lista: readonly MiembroParaForma[]) => {
        const r = formaDeFamilia({ familiaActiva: true, agruparEnCarta: true, miembros: lista });
        const permitidos = new Set(
          lista.filter((m) => m.activo && !m.oculto).map((m) => m.productoId),
        );
        expect(r.productos.every((id) => permitidos.has(id))).toBe(true);
        if (r.forma !== "SUELTOS") expect(r.productos.length).toBeGreaterThanOrEqual(2);
      }),
    );
  });

  it("apagada la carta o la familia, nunca se agrupa", () => {
    fc.assert(
      fc.property(miembros, (lista) => {
        expect(
          formaDeFamilia({ familiaActiva: true, agruparEnCarta: false, miembros: lista }).forma,
        ).toBe("SUELTOS");
        expect(
          formaDeFamilia({ familiaActiva: false, agruparEnCarta: true, miembros: lista }).forma,
        ).toBe("SUELTOS");
      }),
    );
  });
  it("las columnas de una tabla no se repiten y son 3 o menos", () => {
    fc.assert(
      fc.property(miembros, (lista) => {
        const r = formaDeFamilia({ familiaActiva: true, agruparEnCarta: true, miembros: lista });
        if (r.forma === "TABLA") {
          expect(r.medidas.length).toBeLessThanOrEqual(3);
          expect(new Set(r.medidas.map((m) => m.toLowerCase())).size).toBe(r.medidas.length);
        }
      }),
    );
  });
});
