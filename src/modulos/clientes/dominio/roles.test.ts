import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { ROLES_DE_PARTE, decidirRoles, esRolDeParte, rolesPedidos, type RolDeParte } from "./roles";

describe("roles de una parte", () => {
  it("los códigos son los de la tabla sembrada", () => {
    expect([...ROLES_DE_PARTE]).toEqual(["CUSTOMER", "PROVEEDOR"]);
    expect(esRolDeParte("CUSTOMER")).toBe(true);
    expect(esRolDeParte("PROVEEDOR")).toBe(true);
    for (const texto of ["EMPLEADO", "customer", "", "CUSTOMER "])
      expect(esRolDeParte(texto)).toBe(false);
  });

  it("rolesPedidos: sin repetidos y en el orden de la lista; un código ajeno invalida el pedido", () => {
    expect(rolesPedidos([])).toEqual([]);
    expect(rolesPedidos(["PROVEEDOR", "CUSTOMER", "PROVEEDOR"])).toEqual(["CUSTOMER", "PROVEEDOR"]);
    expect(rolesPedidos(["PROVEEDOR"])).toEqual(["PROVEEDOR"]);
    expect(rolesPedidos(["CUSTOMER", "EMPLEADO"])).toBeNull();
  });

  it("agrega lo que no existe, reactiva lo apagado y quita lo activo que ya no se pide", () => {
    expect(decidirRoles([], ["CUSTOMER", "PROVEEDOR"])).toEqual({
      agregados: ["CUSTOMER", "PROVEEDOR"],
      reactivados: [],
      quitados: [],
    });
    expect(decidirRoles([{ rol: "CUSTOMER", activo: false }], ["CUSTOMER"])).toEqual({
      agregados: [],
      reactivados: ["CUSTOMER"],
      quitados: [],
    });
    expect(
      decidirRoles(
        [
          { rol: "CUSTOMER", activo: true },
          { rol: "PROVEEDOR", activo: true },
        ],
        ["PROVEEDOR"],
      ),
    ).toEqual({ agregados: [], reactivados: [], quitados: ["CUSTOMER"] });
  });

  it("pedir lo que ya está activo, o apagar lo que ya está apagado, no hace nada", () => {
    expect(decidirRoles([{ rol: "CUSTOMER", activo: true }], ["CUSTOMER"])).toEqual({
      agregados: [],
      reactivados: [],
      quitados: [],
    });
    expect(decidirRoles([{ rol: "CUSTOMER", activo: false }], [])).toEqual({
      agregados: [],
      reactivados: [],
      quitados: [],
    });
  });

  it("propiedad: aplicar el cambio deja activos exactamente los pedidos, y repetirlo no cambia nada", () => {
    const rol = fc.constantFrom<RolDeParte>(...ROLES_DE_PARTE);
    const guardado = fc.uniqueArray(fc.record({ rol, activo: fc.boolean() }), {
      selector: (g) => g.rol,
    });
    fc.assert(
      fc.property(guardado, fc.uniqueArray(rol), (guardados, pedidos) => {
        const cambio = decidirRoles(guardados, pedidos);
        const despues = new Map(guardados.map((g) => [g.rol, g.activo]));
        for (const r of [...cambio.agregados, ...cambio.reactivados]) despues.set(r, true);
        for (const r of cambio.quitados) despues.set(r, false);
        const activos = [...despues]
          .filter(([, a]) => a)
          .map(([r]) => r)
          .sort();
        expect(activos).toEqual([...pedidos].sort());
        const otra = decidirRoles(
          [...despues].map(([r, activo]) => ({ rol: r, activo })),
          pedidos,
        );
        expect(otra).toEqual({ agregados: [], reactivados: [], quitados: [] });
      }),
    );
  });
});
