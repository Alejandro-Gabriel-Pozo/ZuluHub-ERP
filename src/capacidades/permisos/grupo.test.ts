import { describe, expect, expectTypeOf, it } from "vitest";
import { modulosActivosDe } from "../modulos/activos";
import { CATALOGO_DE_MODULOS } from "../modulos/catalogo";
import { PERMISOS_DE_EMPRESA } from "./empresa";
import {
  CATALOGO_DE_GRUPO,
  PERMISOS_DE_GRUPO,
  REGLAS_DE_GRUPO,
  ROLES_DE_GRUPO,
  type ClaveAccionDeGrupo,
  type ClaveCapacidadDeGrupo,
  type ClaveModuloDeGrupo,
  type RolDeGrupo,
} from "./grupo";
import { evaluarGuard } from "./guard";
import { PERMISOS_DE_PLATAFORMA } from "./plataforma";

/**
 * H6 T6: el catálogo y la matriz de grupo, fijados a propósito. Si alguien cambia un permiso, estas
 * pruebas fallan y el dueño lee la diferencia.
 */

describe("los roles de grupo", () => {
  it("son exactamente PROPIETARIO", () => {
    expect(ROLES_DE_GRUPO).toEqual(["PROPIETARIO"]);
    expectTypeOf<RolDeGrupo>().toEqualTypeOf<"PROPIETARIO">();
  });
});

describe("el catálogo de grupo", () => {
  it("tiene un solo módulo: grupo, obligatorio, disponible y sin capacidades de sucursal", () => {
    expect(CATALOGO_DE_GRUPO).toEqual({
      grupo: {
        estado: "disponible",
        obligatorio: true,
        requiere: [],
        usaSiExiste: [],
        datosRequeridos: [],
        implementadoPor: ["consultas-de-grupo"],
        acciones: { "grupo.ver_empresas": { capacidad: null, efecto: "LECTURA" } },
      },
    });
    expectTypeOf<ClaveModuloDeGrupo>().toEqualTypeOf<"grupo">();
    expectTypeOf<ClaveAccionDeGrupo>().toEqualTypeOf<"grupo.ver_empresas">();
    expectTypeOf<ClaveCapacidadDeGrupo>().toEqualTypeOf<never>();
  });

  it("el módulo grupo está activo sin guardar nada", () => {
    expect([...modulosActivosDe(CATALOGO_DE_GRUPO, [])]).toEqual(["grupo"]);
  });

  it("no existe grupo.invitar (función de pago futura) ni ninguna otra acción", () => {
    expect(Object.keys(CATALOGO_DE_GRUPO.grupo.acciones)).toEqual(["grupo.ver_empresas"]);
  });

  it("ninguna acción de grupo existe en el catálogo de empresa ni en el de plataforma", () => {
    const propias = Object.keys(PERMISOS_DE_GRUPO);
    const deEmpresa = Object.values(CATALOGO_DE_MODULOS).flatMap((m) => Object.keys(m.acciones));
    const ajenas = new Set([
      ...Object.keys(PERMISOS_DE_EMPRESA),
      ...Object.keys(PERMISOS_DE_PLATAFORMA),
      ...deEmpresa,
    ]);
    expect(propias.filter((a) => ajenas.has(a))).toEqual([]);
  });
});

describe("la matriz rol → acciones de grupo", () => {
  it("ver las empresas del grupo es solo del PROPIETARIO", () => {
    expect(PERMISOS_DE_GRUPO).toEqual({ "grupo.ver_empresas": ["PROPIETARIO"] });
  });

  it("cada acción del catálogo tiene su fila en la matriz, y no hay filas de más", () => {
    const delCatalogo = Object.values(CATALOGO_DE_GRUPO)
      .flatMap((m) => Object.keys(m.acciones))
      .sort();
    expect(Object.keys(PERMISOS_DE_GRUPO).sort()).toEqual(delCatalogo);
  });

  it("las reglas de grupo son el catálogo y la matriz reales", () => {
    expect(REGLAS_DE_GRUPO.catalogo).toBe(CATALOGO_DE_GRUPO);
    expect(REGLAS_DE_GRUPO.permisos).toBe(PERMISOS_DE_GRUPO);
  });
});

describe("el guard con las reglas de grupo", () => {
  const activos = modulosActivosDe(CATALOGO_DE_GRUPO, []);
  const evaluar = (rol: RolDeGrupo | null) =>
    evaluarGuard(REGLAS_DE_GRUPO, "grupo.ver_empresas", {
      rol,
      modulosActivos: activos,
      capacidadesDeSucursal: null,
    });

  it("el propietario puede ver las empresas del grupo", () => {
    expect(evaluar("PROPIETARIO")).toEqual({ ok: true, valor: null });
  });

  it("sin rol (no es propietario activo) da SIN_PERMISO", () => {
    expect(evaluar(null)).toEqual({ ok: false, error: "SIN_PERMISO" });
  });

  it("un rol de empresa o de plataforma no es un rol de grupo: no compila", () => {
    const noSeEjecuta = () => {
      evaluarGuard(REGLAS_DE_GRUPO, "grupo.ver_empresas", {
        // @ts-expect-error GERENTE es un rol de empresa, no de grupo
        rol: "GERENTE",
        modulosActivos: activos,
        capacidadesDeSucursal: null,
      });
      evaluarGuard(REGLAS_DE_GRUPO, "grupo.ver_empresas", {
        // @ts-expect-error ADMIN es un rol de plataforma, no de grupo
        rol: "ADMIN",
        modulosActivos: activos,
        capacidadesDeSucursal: null,
      });
      // @ts-expect-error una acción de empresa no se evalúa con las reglas de grupo
      evaluarGuard(REGLAS_DE_GRUPO, "usuarios.ver", {
        rol: "PROPIETARIO",
        modulosActivos: activos,
        capacidadesDeSucursal: null,
      });
      // @ts-expect-error grupo.invitar no existe (es de pago y futuro)
      evaluarGuard(REGLAS_DE_GRUPO, "grupo.invitar", {
        rol: "PROPIETARIO",
        modulosActivos: activos,
        capacidadesDeSucursal: null,
      });
    };
    expect(noSeEjecuta).toBeTypeOf("function");
  });

  it("si el módulo no figura entre los activos, MODULO_NO_ACTIVO (el guard no lo da por hecho)", () => {
    expect(
      evaluarGuard(REGLAS_DE_GRUPO, "grupo.ver_empresas", {
        rol: "PROPIETARIO",
        modulosActivos: new Set<"grupo">(),
        capacidadesDeSucursal: null,
      }),
    ).toEqual({ ok: false, error: "MODULO_NO_ACTIVO" });
  });
});
