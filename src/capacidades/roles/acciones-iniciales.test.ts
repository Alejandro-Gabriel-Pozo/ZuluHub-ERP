import { describe, expect, it } from "vitest";
import { accionesIniciales, type ContextoDeAccionesIniciales } from "./acciones-iniciales";

const MODULOS: Record<string, string> = {
  "ventas.ver": "ventas",
  "ventas.crear": "ventas",
  "compras.ver": "compras",
  "cajas.crear": "caja",
  "permisos.ver_propios": "administracion",
};
const contexto: ContextoDeAccionesIniciales = {
  moduloDeLaAccion: (a) => MODULOS[a] ?? null,
  modulosDelPlan: new Set(["ventas", "administracion", "caja"]),
  pisos: { "cajas.crear": "SOLO_GERENTE", "permisos.ver_propios": "TODOS_LOS_ROLES" },
};

describe("acciones con las que nace un rol propio (I6)", () => {
  it("de cero, solo los pisos de todos los roles", () => {
    expect(accionesIniciales([], contexto)).toEqual(["permisos.ver_propios"]);
  });

  it("copiando, queda lo que el plan permite más los obligatorios, ordenado y sin repetir", () => {
    expect(
      accionesIniciales(["ventas.ver", "permisos.ver_propios", "ventas.crear"], contexto),
    ).toEqual(["permisos.ver_propios", "ventas.crear", "ventas.ver"]);
  });

  it("de la copia se descarta lo de un módulo fuera del plan, lo reservado al gerente y lo desconocido", () => {
    expect(
      accionesIniciales(["compras.ver", "cajas.crear", "inventada.x", "ventas.ver"], contexto),
    ).toEqual(["permisos.ver_propios", "ventas.ver"]);
  });

  it("una acción nueva del catálogo no llega sola: sin estar en el origen, no está", () => {
    expect(accionesIniciales(["ventas.ver"], contexto)).not.toContain("ventas.crear");
  });

  it("una acción sin módulo no se copia, ni siquiera si el plan tuviera un módulo nulo", () => {
    const conPlanRaro = {
      ...contexto,
      modulosDelPlan: new Set([null, "ventas"]) as unknown as ReadonlySet<string>,
    };
    expect(accionesIniciales(["inventada.x", "ventas.ver"], conPlanRaro)).toEqual([
      "permisos.ver_propios",
      "ventas.ver",
    ]);
  });
});
