import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import { MAXIMO_DE_DESTINOS_DE_MODULOS, destinosDeOperacion } from "./destinos";

const base = { inicio: "inicio", empresa: "empresa", cuenta: "cuenta" };

describe("destinosDeOperacion: siempre de 3 a 5", () => {
  it("sin módulos: inicio, empresa y cuenta", () => {
    expect(destinosDeOperacion({ ...base, modulos: [] })).toEqual(["inicio", "empresa", "cuenta"]);
  });

  it("con módulos: inicio, los módulos y cuenta (la empresa vive en la barra de arriba)", () => {
    expect(destinosDeOperacion({ ...base, modulos: ["ventas"] })).toEqual([
      "inicio",
      "ventas",
      "cuenta",
    ]);
    expect(destinosDeOperacion({ ...base, modulos: ["ventas", "caja"] })).toEqual([
      "inicio",
      "ventas",
      "caja",
      "cuenta",
    ]);
  });

  it("con más de tres módulos entran los tres primeros", () => {
    expect(MAXIMO_DE_DESTINOS_DE_MODULOS).toBe(3);
    expect(destinosDeOperacion({ ...base, modulos: ["a", "b", "c", "d", "e"] })).toEqual([
      "inicio",
      "a",
      "b",
      "c",
      "cuenta",
    ]);
  });

  it("propiedad: nunca menos de 3 ni más de 5, inicio primero y cuenta última", () => {
    fc.assert(
      fc.property(fc.array(fc.string(), { maxLength: 12 }), (modulos) => {
        const destinos = destinosDeOperacion({ ...base, modulos });
        expect(destinos.length).toBeGreaterThanOrEqual(3);
        expect(destinos.length).toBeLessThanOrEqual(5);
        expect(destinos[0]).toBe("inicio");
        expect(destinos.at(-1)).toBe("cuenta");
      }),
    );
  });
});
