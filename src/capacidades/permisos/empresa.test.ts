import { describe, expect, it } from "vitest";
import { modulosActivosDe } from "../modulos/activos";
import { CATALOGO_DE_MODULOS, type ClaveAccion, type ClaveModulo } from "../modulos/catalogo";
import { PERMISOS_DE_EMPRESA, REGLAS_DE_EMPRESA, tablaDePermisos } from "./empresa";
import { evaluarGuard } from "./guard";
import { ROLES_DE_EMPRESA, type RolDeEmpresa } from "./roles";

/**
 * P2 y P4: la matriz REAL como tabla legible. Si alguien cambia un permiso, esta prueba falla y el
 * dueño lee la diferencia: es la única copia "a la vista" de quién puede qué.
 */

const ACCIONES_DE_USUARIOS = [
  "usuarios.apagar",
  "usuarios.invitar",
  "usuarios.reenviar_invitacion",
] as const;

describe("la matriz rol → acciones (roles fijos, decisión 18)", () => {
  it("tabla de permisos: qué puede cada rol", () => {
    expect(tablaDePermisos(PERMISOS_DE_EMPRESA)).toEqual({
      GERENTE: ACCIONES_DE_USUARIOS,
      ADMINISTRADOR: ACCIONES_DE_USUARIOS,
      OPERADOR: [],
    });
  });

  it("el operador no puede ninguna acción de usuarios (decisión 2)", () => {
    for (const accion of ACCIONES_DE_USUARIOS) {
      expect(PERMISOS_DE_EMPRESA[accion]).not.toContain("OPERADOR");
    }
  });

  it("los roles son exactamente estos tres, en este orden", () => {
    expect(ROLES_DE_EMPRESA).toEqual(["GERENTE", "ADMINISTRADOR", "OPERADOR"]);
  });

  it("cada acción del catálogo tiene su fila en la matriz, y no hay filas de más", () => {
    const delCatalogo = Object.values(CATALOGO_DE_MODULOS)
      .flatMap((m) => Object.keys(m.acciones))
      .sort();
    expect(Object.keys(PERMISOS_DE_EMPRESA).sort()).toEqual(delCatalogo);
  });

  it("P4: piso jerárquico: lo que puede el operador lo puede el administrador, y lo del administrador, el gerente", () => {
    const tabla = tablaDePermisos(PERMISOS_DE_EMPRESA);
    for (const accion of tabla.OPERADOR) expect(tabla.ADMINISTRADOR).toContain(accion);
    for (const accion of tabla.ADMINISTRADOR) expect(tabla.GERENTE).toContain(accion);
  });

  it("las reglas de empresa son el catálogo y la matriz reales", () => {
    expect(REGLAS_DE_EMPRESA.catalogo).toBe(CATALOGO_DE_MODULOS);
    expect(REGLAS_DE_EMPRESA.permisos).toBe(PERMISOS_DE_EMPRESA);
  });
});

describe("tablaDePermisos con otras matrices", () => {
  it("ordena las acciones de cada rol y deja vacío al rol sin acciones", () => {
    const tabla = tablaDePermisos({
      "z.ultima": ["GERENTE", "OPERADOR"],
      "a.primera": ["GERENTE"],
      "m.media": ["OPERADOR"],
    });
    expect(tabla).toEqual({
      GERENTE: ["a.primera", "z.ultima"],
      ADMINISTRADOR: [],
      OPERADOR: ["m.media", "z.ultima"],
    });
  });

  it("una matriz vacía da una tabla vacía por rol", () => {
    expect(tablaDePermisos({})).toEqual({ GERENTE: [], ADMINISTRADOR: [], OPERADOR: [] });
  });

  it("no cambia la matriz que recibe", () => {
    const matriz: Record<string, readonly RolDeEmpresa[]> = { b: ["GERENTE"], a: ["GERENTE"] };
    tablaDePermisos(matriz);
    expect(Object.keys(matriz)).toEqual(["b", "a"]);
  });
});

describe("el guard con las reglas reales", () => {
  const activos = modulosActivosDe(CATALOGO_DE_MODULOS, []);
  const acciones = Object.keys(PERMISOS_DE_EMPRESA) as ClaveAccion[];

  it("administracion es obligatorio: está activo aunque no se haya activado nada", () => {
    expect([...activos]).toEqual(["administracion"]);
  });

  it("cada rol puede exactamente lo que dice la tabla, y no puede, SIN_PERMISO", () => {
    const tabla = tablaDePermisos(PERMISOS_DE_EMPRESA);
    for (const rol of ROLES_DE_EMPRESA) {
      for (const accion of acciones) {
        const resultado = evaluarGuard(REGLAS_DE_EMPRESA, accion, {
          rol,
          modulosActivos: activos,
          capacidadesDeSucursal: null,
        });
        const puede = (tabla[rol] as readonly string[]).includes(accion);
        expect(resultado, `${rol} ${accion}`).toEqual(
          puede ? { ok: true, valor: null } : { ok: false, error: "SIN_PERMISO" },
        );
      }
    }
  });

  it("sin rol (sin persona, sin membresía activa o suspendida) no puede ninguna acción", () => {
    for (const accion of acciones) {
      expect(
        evaluarGuard(REGLAS_DE_EMPRESA, accion, {
          rol: null,
          modulosActivos: activos,
          capacidadesDeSucursal: null,
        }),
      ).toEqual({ ok: false, error: "SIN_PERMISO" });
    }
  });

  it("si el módulo no figura entre los activos, MODULO_NO_ACTIVO (el guard no lo da por hecho)", () => {
    expect(
      evaluarGuard(REGLAS_DE_EMPRESA, "usuarios.invitar", {
        rol: "GERENTE",
        modulosActivos: new Set<ClaveModulo>(),
        capacidadesDeSucursal: null,
      }),
    ).toEqual({ ok: false, error: "MODULO_NO_ACTIVO" });
  });
});
