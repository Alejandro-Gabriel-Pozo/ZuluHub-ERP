import { describe, expect, it } from "vitest";
import {
  accionesTrasElPiso,
  conPisoNuevo,
  impactoDeCambiarPiso,
  type DestinoDelPiso,
} from "./impacto-de-piso";

const destinos: DestinoDelPiso[] = [
  { empresaId: "e1", id: "r1", acciones: ["a.x", "b.y"] },
  { empresaId: "e1", id: "r2", acciones: ["b.y"] },
  { empresaId: "e2", id: "r3", acciones: ["a.x"] },
  { empresaId: null, id: "OPERADOR", acciones: ["a.x", "c.z"] },
];

describe("impacto de cambiar un piso (Q3)", () => {
  it("solo-gerente: se quita la acción a todo destino que la tiene y se cuentan las empresas", () => {
    const i = impactoDeCambiarPiso("a.x", "SOLO_GERENTE", destinos);
    expect(i.cambios).toEqual([
      { empresaId: "e1", id: "r1", cambio: "QUITA", accionesNuevas: ["b.y"] },
      { empresaId: "e2", id: "r3", cambio: "QUITA", accionesNuevas: [] },
      { empresaId: null, id: "OPERADOR", cambio: "QUITA", accionesNuevas: ["c.z"] },
    ]);
    expect(i.empresasAfectadas).toBe(2);
  });

  it("todos los roles: se suma la acción a todo destino que no la tiene (SUPUESTO, DEC-0950)", () => {
    const i = impactoDeCambiarPiso("a.x", "TODOS_LOS_ROLES", destinos);
    expect(i.cambios).toEqual([
      { empresaId: "e1", id: "r2", cambio: "SUMA", accionesNuevas: ["a.x", "b.y"] },
    ]);
    expect(i.empresasAfectadas).toBe(1);
  });

  it("sin piso no se toca nada, aunque haya quien tenga la acción", () => {
    expect(impactoDeCambiarPiso("a.x", null, destinos)).toEqual({
      cambios: [],
      empresasAfectadas: 0,
    });
  });

  it("sin destinos o sin coincidencias, no hay impacto", () => {
    expect(impactoDeCambiarPiso("a.x", "SOLO_GERENTE", [])).toEqual({
      cambios: [],
      empresasAfectadas: 0,
    });
    expect(impactoDeCambiarPiso("q.q", "SOLO_GERENTE", destinos).cambios).toEqual([]);
  });

  it("una plantilla afectada no cuenta como empresa", () => {
    const i = impactoDeCambiarPiso("c.z", "SOLO_GERENTE", destinos);
    expect(i.cambios).toHaveLength(1);
    expect(i.empresasAfectadas).toBe(0);
  });

  it("el conjunto resultante sale ordenado en los dos sentidos", () => {
    expect(accionesTrasElPiso(["z.z", "a.a", "m.m"], "m.m", "SOLO_GERENTE")).toEqual([
      "a.a",
      "z.z",
    ]);
    expect(accionesTrasElPiso(["z.z", "a.a"], "m.m", "TODOS_LOS_ROLES")).toEqual([
      "a.a",
      "m.m",
      "z.z",
    ]);
  });

  it("aplicar el mismo piso dos veces no cambia nada la segunda (idempotente)", () => {
    for (const tipo of ["SOLO_GERENTE", "TODOS_LOS_ROLES"] as const) {
      const una = accionesTrasElPiso(["a.x", "b.y"], "a.x", tipo);
      expect(accionesTrasElPiso(una, "a.x", tipo)).toEqual(una);
    }
  });

  it("un piso nuevo reemplaza al anterior de esa acción y se puede quitar, sin tocar el resto ni el original", () => {
    const pisos = { "a.x": "SOLO_GERENTE", "b.y": "TODOS_LOS_ROLES" } as const;
    expect(conPisoNuevo(pisos, "a.x", "TODOS_LOS_ROLES")).toEqual({
      "a.x": "TODOS_LOS_ROLES",
      "b.y": "TODOS_LOS_ROLES",
    });
    expect(conPisoNuevo(pisos, "a.x", null)).toEqual({ "b.y": "TODOS_LOS_ROLES" });
    expect(conPisoNuevo(pisos, "c.z", "SOLO_GERENTE")).toEqual({ ...pisos, "c.z": "SOLO_GERENTE" });
    expect(pisos["a.x"]).toBe("SOLO_GERENTE");
  });
});
