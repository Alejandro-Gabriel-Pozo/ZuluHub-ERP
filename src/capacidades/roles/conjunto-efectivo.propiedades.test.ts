import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import { conjuntoEfectivo } from "./conjunto-efectivo";

const accion = fc.constantFrom("a.ver", "a.crear", "b.ver", "b.anular", "c.ver", "viejo.x");
const lista = fc.array(accion, { maxLength: 8 });
const catalogo = fc.subarray(["a.ver", "a.crear", "b.ver", "b.anular", "c.ver"]);

describe("conjunto efectivo: propiedades", () => {
  it("nunca otorga algo fuera del catálogo y el gerente es el techo de cualquier otro rol", () => {
    fc.assert(
      fc.property(
        catalogo,
        lista,
        lista,
        fc.boolean(),
        fc.constantFrom("ADMINISTRADOR", "OPERADOR", "PROPIO"),
        (cat, deLaPlantilla, delRol, activo, rol) => {
          const f = {
            catalogo: new Set(cat),
            plantilla: () => deLaPlantilla,
            rolPropio: { activo, acciones: delRol },
          };
          const conjunto = conjuntoEfectivo(rol, f);
          const gerente = conjuntoEfectivo("GERENTE", f);
          for (const a of conjunto) {
            expect(f.catalogo.has(a)).toBe(true);
            expect(gerente.has(a)).toBe(true);
          }
        },
      ),
    );
  });
});
