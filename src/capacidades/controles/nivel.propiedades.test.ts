import fc from "fast-check";
import { describe, it } from "vitest";
import "../../../test/propiedades/configuracion";
import { NIVELES_DE_CONTROL, resolverNivel, type NivelDeControl } from "./nivel";

const rigor = (n: NivelDeControl) => NIVELES_DE_CONTROL.indexOf(n);
const nivel = fc.constantFrom(...NIVELES_DE_CONTROL);
const guardado = fc.option(nivel, { nil: null });

describe("resolverNivel: propiedades", () => {
  it("sin el control en el plan siempre rige PERMITIR", () => {
    fc.assert(
      fc.property(guardado, guardado, (nivelDeLaEmpresa, nivelDeLaSucursal) => {
        return (
          resolverNivel({ disponibleEnElPlan: false, nivelDeLaEmpresa, nivelDeLaSucursal }) ===
          "PERMITIR"
        );
      }),
    );
  });

  it("la sucursal nunca afloja: el resultado es al menos tan exigente como el de la empresa", () => {
    fc.assert(
      fc.property(guardado, guardado, (nivelDeLaEmpresa, nivelDeLaSucursal) => {
        const regido = resolverNivel({
          disponibleEnElPlan: true,
          nivelDeLaEmpresa,
          nivelDeLaSucursal,
        });
        return rigor(regido) >= rigor(nivelDeLaEmpresa ?? "PERMITIR");
      }),
    );
  });

  it("nunca es más exigente que lo más exigente que alguien pidió, y es uno de los dos", () => {
    fc.assert(
      fc.property(guardado, guardado, (nivelDeLaEmpresa, nivelDeLaSucursal) => {
        const regido = resolverNivel({
          disponibleEnElPlan: true,
          nivelDeLaEmpresa,
          nivelDeLaSucursal,
        });
        const pedidos = [nivelDeLaEmpresa ?? "PERMITIR", nivelDeLaSucursal ?? "PERMITIR"];
        return pedidos.includes(regido) && rigor(regido) <= Math.max(...pedidos.map(rigor));
      }),
    );
  });

  it("es simétrica cuando los dos dicen algo: el orden empresa/sucursal no cambia el resultado", () => {
    fc.assert(
      fc.property(nivel, nivel, (a, b) => {
        return (
          resolverNivel({ disponibleEnElPlan: true, nivelDeLaEmpresa: a, nivelDeLaSucursal: b }) ===
          resolverNivel({ disponibleEnElPlan: true, nivelDeLaEmpresa: b, nivelDeLaSucursal: a })
        );
      }),
    );
  });
});
