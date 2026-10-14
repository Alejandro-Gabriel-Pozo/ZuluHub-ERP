import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import { decidirEmpresa } from "./empresa-elegida";

const a = { empresaId: "empresa-a", nombre: "A" };
const b = { empresaId: "empresa-b", nombre: "B" };
const c = { empresaId: "empresa-c", nombre: "C" };

describe("decidirEmpresa", () => {
  it("sin empresas y sin cookie: «no tenés empresas»", () => {
    expect(decidirEmpresa([], null)).toEqual({ tipo: "SIN_EMPRESAS" });
    expect(decidirEmpresa([], undefined)).toEqual({ tipo: "SIN_EMPRESAS" });
    expect(decidirEmpresa([], "")).toEqual({ tipo: "SIN_EMPRESAS" });
  });

  it("una sola empresa y sin cookie: entra directo", () => {
    expect(decidirEmpresa([a], null)).toEqual({ tipo: "ENTRA", empresa: a });
    expect(decidirEmpresa([a], "")).toEqual({ tipo: "ENTRA", empresa: a });
  });

  it("varias empresas y sin cookie: a elegir (con la lista completa)", () => {
    expect(decidirEmpresa([a, b, c], null)).toEqual({ tipo: "ELEGIR", empresas: [a, b, c] });
    expect(decidirEmpresa([a, b], undefined)).toEqual({ tipo: "ELEGIR", empresas: [a, b] });
  });

  it("la cookie con una empresa de la persona en esta marca: entra a esa, aunque haya varias o una", () => {
    expect(decidirEmpresa([a, b, c], "empresa-b")).toEqual({ tipo: "ENTRA", empresa: b });
    expect(decidirEmpresa([a], "empresa-a")).toEqual({ tipo: "ENTRA", empresa: a });
  });

  it("la cookie con una empresa que NO está en la lista: sin permiso (P-1), con una, varias o ninguna", () => {
    expect(decidirEmpresa([a], "empresa-de-otra-marca")).toEqual({ tipo: "SIN_PERMISO" });
    expect(decidirEmpresa([a, b], "empresa-de-otra-marca")).toEqual({ tipo: "SIN_PERMISO" });
    expect(decidirEmpresa([], "empresa-de-otra-marca")).toEqual({ tipo: "SIN_PERMISO" });
  });

  it("la comparación es exacta: ni mayúsculas ni espacios ni prefijos", () => {
    for (const cookie of ["EMPRESA-A", " empresa-a", "empresa-a ", "empresa-", "empresa-a2"]) {
      expect(decidirEmpresa([a, b], cookie)).toEqual({ tipo: "SIN_PERMISO" });
    }
  });

  it("propiedad: solo entra a una empresa que está en la lista; lo demás nunca se inventa", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 6 }), { maxLength: 5 }),
        fc.option(fc.string({ maxLength: 6 }), { nil: undefined }),
        (ids, cookie) => {
          const empresas = ids.map((empresaId) => ({ empresaId }));
          const decision = decidirEmpresa(empresas, cookie);
          if (decision.tipo === "ENTRA") expect(ids).toContain(decision.empresa.empresaId);
          if (decision.tipo === "ELEGIR") expect(decision.empresas).toEqual(empresas);
          if (cookie !== undefined && cookie !== "") {
            expect(decision.tipo).toBe(ids.includes(cookie) ? "ENTRA" : "SIN_PERMISO");
          }
        },
      ),
    );
  });
});
