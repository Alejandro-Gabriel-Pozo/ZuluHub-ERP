import { describe, expect, it } from "vitest";
import { modulosActivosDe } from "../modulos/activos";
import { CATALOGO_DE_MODULOS } from "../modulos/catalogo";
import { PERMISOS_DE_EMPRESA } from "./empresa";
import { evaluarGuard } from "./guard";
import {
  CATALOGO_DE_PLATAFORMA,
  PERMISOS_DE_PLATAFORMA,
  REGLAS_DE_PLATAFORMA,
  ROLES_DE_PLATAFORMA,
  tablaDePermisosDePlataforma,
  type ClaveAccionDePlataforma,
  type RolDePlataforma,
} from "./plataforma";

/**
 * H5 P1: el catálogo y la matriz de plataforma, fijados a propósito. Si alguien cambia un permiso,
 * estas pruebas fallan y el dueño lee la diferencia (F3: qué puede `SOPORTE`).
 */

/** Lo que pueden los dos roles, escrito a mano desde la tabla de §B.3 de la especificación de H5. */
const DE_SOPORTE = [
  "altas.reenviar_invitacion",
  "altas.revocar_invitacion",
  "auditoria.ver",
  "configuracion.ver",
  "empresas.ver",
  "invitaciones.ver",
  "soporte.buscar_referencia",
  "soporte.explicar",
  "tenants.ver",
  "trabajos.ver_fallidos",
] as const;

/** Lo que solo hace ADMIN: dar de alta, cancelar, suspender y reactivar. */
const SOLO_DE_ADMIN = [
  "altas.cancelar",
  "empresas.alta",
  "empresas.reactivar",
  "empresas.suspender",
  "personas.reactivar",
  "personas.suspender",
  "tenants.reactivar",
  "tenants.suspender",
] as const;

const TODAS = Object.keys(PERMISOS_DE_PLATAFORMA) as ClaveAccionDePlataforma[];

describe("los roles de plataforma", () => {
  it("son exactamente ADMIN y SOPORTE, en este orden", () => {
    expect(ROLES_DE_PLATAFORMA).toEqual(["ADMIN", "SOPORTE"]);
  });
});

describe("el catálogo de plataforma", () => {
  it("tiene un solo módulo: plataforma, obligatorio, disponible y sin capacidades de sucursal", () => {
    expect(CATALOGO_DE_PLATAFORMA).toEqual({
      plataforma: {
        estado: "disponible",
        obligatorio: true,
        requiere: [],
        usaSiExiste: [],
        datosRequeridos: [],
        implementadoPor: ["plataforma"],
        acciones: {
          "tenants.ver": { capacidad: null },
          "empresas.ver": { capacidad: null },
          "invitaciones.ver": { capacidad: null },
          "trabajos.ver_fallidos": { capacidad: null },
          "auditoria.ver": { capacidad: null },
          "configuracion.ver": { capacidad: null },
          "soporte.buscar_referencia": { capacidad: null },
          "soporte.explicar": { capacidad: null },
          "altas.reenviar_invitacion": { capacidad: null },
          "altas.revocar_invitacion": { capacidad: null },
          "empresas.alta": { capacidad: null },
          "altas.cancelar": { capacidad: null },
          "tenants.suspender": { capacidad: null },
          "tenants.reactivar": { capacidad: null },
          "empresas.suspender": { capacidad: null },
          "empresas.reactivar": { capacidad: null },
          "personas.suspender": { capacidad: null },
          "personas.reactivar": { capacidad: null },
        },
      },
    });
  });

  it("el módulo plataforma está activo sin guardar nada", () => {
    expect([...modulosActivosDe(CATALOGO_DE_PLATAFORMA, [])]).toEqual(["plataforma"]);
  });

  it("las acciones son las 18: 10 que hacen los dos roles y 8 que solo hace ADMIN", () => {
    expect(TODAS).toHaveLength(18);
    expect(DE_SOPORTE).toHaveLength(10);
    expect(SOLO_DE_ADMIN).toHaveLength(8);
  });

  it("ninguna acción de plataforma existe en el catálogo de empresa, ni al revés", () => {
    // Si compartieran un nombre, el tipo no podría impedir que una acción de un catálogo se evalúe
    // con las reglas del otro (las pruebas de tipos de test/arquitectura se apoyan en esto).
    const deEmpresa = new Set(Object.keys(PERMISOS_DE_EMPRESA));
    expect(TODAS.filter((a) => deEmpresa.has(a))).toEqual([]);
    const deCatalogoDeEmpresa = new Set(
      Object.values(CATALOGO_DE_MODULOS).flatMap((m) => Object.keys(m.acciones)),
    );
    expect(TODAS.filter((a) => deCatalogoDeEmpresa.has(a))).toEqual([]);
  });
});

describe("la matriz rol → acciones de plataforma (F3)", () => {
  it("tabla de permisos: qué puede cada rol (§B.3 de la especificación de H5)", () => {
    expect(tablaDePermisosDePlataforma(PERMISOS_DE_PLATAFORMA)).toEqual({
      ADMIN: [...DE_SOPORTE, ...SOLO_DE_ADMIN].sort(),
      SOPORTE: [...DE_SOPORTE],
    });
  });

  it("las acciones de consulta, de soporte y de reenviar o revocar el alta las tienen los dos roles", () => {
    for (const accion of DE_SOPORTE) {
      expect(PERMISOS_DE_PLATAFORMA[accion], accion).toEqual(["ADMIN", "SOPORTE"]);
    }
  });

  it("dar de alta, cancelar, suspender y reactivar son solo de ADMIN: SOPORTE no suspende ni fija CUIT", () => {
    for (const accion of SOLO_DE_ADMIN) {
      expect(PERMISOS_DE_PLATAFORMA[accion], accion).toEqual(["ADMIN"]);
    }
    expect(tablaDePermisosDePlataforma(PERMISOS_DE_PLATAFORMA).SOPORTE).not.toEqual(
      expect.arrayContaining(["empresas.alta"]),
    );
  });

  it("SOPORTE no tiene ninguna acción que escriba estructura: nada de alta, cancelar, suspender ni reactivar", () => {
    const soporte = tablaDePermisosDePlataforma(PERMISOS_DE_PLATAFORMA).SOPORTE;
    expect(soporte.filter((a) => /(alta|cancelar|suspender|reactivar)$/.test(a))).toEqual([]);
  });

  it("piso jerárquico: lo que puede SOPORTE lo puede ADMIN", () => {
    const tabla = tablaDePermisosDePlataforma(PERMISOS_DE_PLATAFORMA);
    for (const accion of tabla.SOPORTE) expect(tabla.ADMIN).toContain(accion);
    expect(tabla.ADMIN).toHaveLength(18);
  });

  it("cada acción del catálogo tiene su fila en la matriz, y no hay filas de más", () => {
    const delCatalogo = Object.values(CATALOGO_DE_PLATAFORMA)
      .flatMap((m) => Object.keys(m.acciones))
      .sort();
    expect(Object.keys(PERMISOS_DE_PLATAFORMA).sort()).toEqual(delCatalogo);
  });

  it("toda fila nombra al menos un rol y solo roles que existen, sin repetir", () => {
    for (const accion of TODAS) {
      const roles = PERMISOS_DE_PLATAFORMA[accion] as readonly RolDePlataforma[];
      expect(roles.length, accion).toBeGreaterThan(0);
      expect(new Set(roles).size, accion).toBe(roles.length);
      for (const rol of roles) expect(ROLES_DE_PLATAFORMA, accion).toContain(rol);
    }
  });

  it("las reglas de plataforma son el catálogo y la matriz reales", () => {
    expect(REGLAS_DE_PLATAFORMA.catalogo).toBe(CATALOGO_DE_PLATAFORMA);
    expect(REGLAS_DE_PLATAFORMA.permisos).toBe(PERMISOS_DE_PLATAFORMA);
  });
});

describe("tablaDePermisosDePlataforma con otras matrices", () => {
  it("ordena las acciones de cada rol y deja vacío al rol sin acciones", () => {
    expect(
      tablaDePermisosDePlataforma({
        "z.ultima": ["ADMIN", "SOPORTE"],
        "a.primera": ["ADMIN"],
        "m.media": ["SOPORTE"],
      }),
    ).toEqual({ ADMIN: ["a.primera", "z.ultima"], SOPORTE: ["m.media", "z.ultima"] });
    expect(tablaDePermisosDePlataforma({ "a.sola": ["ADMIN"] })).toEqual({
      ADMIN: ["a.sola"],
      SOPORTE: [],
    });
  });

  it("una matriz vacía da una tabla vacía por rol", () => {
    expect(tablaDePermisosDePlataforma({})).toEqual({ ADMIN: [], SOPORTE: [] });
  });

  it("no cambia la matriz que recibe", () => {
    const matriz: Record<string, readonly RolDePlataforma[]> = { b: ["ADMIN"], a: ["ADMIN"] };
    tablaDePermisosDePlataforma(matriz);
    expect(Object.keys(matriz)).toEqual(["b", "a"]);
  });
});

describe("el guard con las reglas de plataforma", () => {
  const activos = modulosActivosDe(CATALOGO_DE_PLATAFORMA, []);
  const evaluar = (accion: ClaveAccionDePlataforma, rol: RolDePlataforma | null) =>
    evaluarGuard(REGLAS_DE_PLATAFORMA, accion, {
      rol,
      modulosActivos: activos,
      capacidadesDeSucursal: null,
    });

  it("cada rol puede exactamente lo que dice la tabla y, si no puede, el motivo es SIN_PERMISO (nunca otro)", () => {
    const tabla = tablaDePermisosDePlataforma(PERMISOS_DE_PLATAFORMA);
    for (const rol of ROLES_DE_PLATAFORMA) {
      for (const accion of TODAS) {
        const puede = (tabla[rol] as readonly string[]).includes(accion);
        expect(evaluar(accion, rol), `${rol} ${accion}`).toEqual(
          puede ? { ok: true, valor: null } : { ok: false, error: "SIN_PERMISO" },
        );
      }
    }
  });

  it("sin rol (administrador inexistente o inactivo) no puede ninguna acción: SIN_PERMISO", () => {
    for (const accion of TODAS) {
      expect(evaluar(accion, null), accion).toEqual({ ok: false, error: "SIN_PERMISO" });
    }
  });

  it("SOPORTE puede reenviar y revocar el alta, ver y explicar; no puede dar de alta ni suspender una persona", () => {
    expect(evaluar("altas.reenviar_invitacion", "SOPORTE")).toEqual({ ok: true, valor: null });
    expect(evaluar("altas.revocar_invitacion", "SOPORTE")).toEqual({ ok: true, valor: null });
    expect(evaluar("soporte.explicar", "SOPORTE")).toEqual({ ok: true, valor: null });
    expect(evaluar("empresas.alta", "SOPORTE")).toEqual({ ok: false, error: "SIN_PERMISO" });
    expect(evaluar("personas.suspender", "SOPORTE")).toEqual({ ok: false, error: "SIN_PERMISO" });
    expect(evaluar("altas.cancelar", "SOPORTE")).toEqual({ ok: false, error: "SIN_PERMISO" });
    expect(evaluar("tenants.suspender", "SOPORTE")).toEqual({ ok: false, error: "SIN_PERMISO" });
  });

  it("el único motivo que puede dar el guard de plataforma con sus datos reales es SIN_PERMISO", () => {
    const motivos = new Set<string>();
    for (const rol of [...ROLES_DE_PLATAFORMA, null] as const) {
      for (const accion of TODAS) {
        const r = evaluar(accion, rol);
        if (!r.ok) motivos.add(r.error);
      }
    }
    expect([...motivos]).toEqual(["SIN_PERMISO"]);
  });

  it("si el módulo no figura entre los activos, MODULO_NO_ACTIVO (el guard no lo da por hecho)", () => {
    expect(
      evaluarGuard(REGLAS_DE_PLATAFORMA, "tenants.ver", {
        rol: "ADMIN",
        modulosActivos: new Set<"plataforma">(),
        capacidadesDeSucursal: null,
      }),
    ).toEqual({ ok: false, error: "MODULO_NO_ACTIVO" });
  });
});
