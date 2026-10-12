import { describe, expect, it } from "vitest";
import { estadoDeModulos } from "../modulos/activos";
import { CATALOGO_DE_MODULOS, type ClaveAccion, type ClaveModulo } from "../modulos/catalogo";
import {
  PERMISOS_DE_EMPRESA,
  REGLAS_DE_EMPRESA,
  tablaDePermisos,
  type ReglasDeEmpresa,
} from "./empresa";
import { evaluarGuard } from "./guard";
import { ROLES_DE_EMPRESA, type RolDeEmpresa } from "./roles";

/**
 * P2 y P4: la matriz REAL como tabla legible. Si alguien cambia un permiso, esta prueba falla y el
 * dueño lee la diferencia: es la única copia "a la vista" de quién puede qué.
 */

/** Las acciones que puede cada rol, escritas a mano desde la tabla de §B.4 de la especificación de H6. */
const DEL_OPERADOR = [
  "gerencia.aceptar_traspaso",
  "gerencia.rechazar_traspaso",
  "gerencia.ver_traspaso",
  "permisos.ver_propios",
] as const;

const SOLO_DEL_GERENTE = [
  "gerencia.cancelar_traspaso",
  "gerencia.proponer_traspaso",
  "sucursales.desactivar",
  "sucursales.reactivar",
] as const;

const DEL_ADMINISTRADOR = [
  ...DEL_OPERADOR,
  "modulos.ver",
  "sucursales.crear",
  "sucursales.editar",
  "sucursales.ver",
  "usuarios.apagar",
  "usuarios.asignar_sucursales",
  "usuarios.invitar",
  "usuarios.reenviar_invitacion",
  "usuarios.revocar_invitacion",
  "usuarios.ver",
].sort();

const ACCIONES_DE_USUARIOS = [
  "usuarios.apagar",
  "usuarios.asignar_sucursales",
  "usuarios.invitar",
  "usuarios.reenviar_invitacion",
  "usuarios.revocar_invitacion",
  "usuarios.ver",
] as const;

describe("la matriz rol → acciones (roles fijos, decisión 18)", () => {
  it("tabla de permisos: qué puede cada rol (§B.4 de la especificación de H6)", () => {
    expect(tablaDePermisos(PERMISOS_DE_EMPRESA)).toEqual({
      GERENTE: [...DEL_ADMINISTRADOR, ...SOLO_DEL_GERENTE].sort(),
      ADMINISTRADOR: DEL_ADMINISTRADOR,
      OPERADOR: [...DEL_OPERADOR],
    });
  });

  it("hay 18 acciones: 6 de usuarios, 5 de sucursales, 5 de gerencia, modulos.ver y permisos.ver_propios", () => {
    const todas = Object.keys(PERMISOS_DE_EMPRESA);
    expect(todas).toHaveLength(18);
    const porPrefijo = (prefijo: string) => todas.filter((a) => a.startsWith(`${prefijo}.`)).length;
    expect([
      porPrefijo("usuarios"),
      porPrefijo("sucursales"),
      porPrefijo("gerencia"),
      porPrefijo("modulos"),
      porPrefijo("permisos"),
    ]).toEqual([6, 5, 5, 1, 1]);
  });

  it("las acciones de usuarios son seis y las tienen exactamente el gerente y el administrador", () => {
    const deUsuarios = Object.keys(PERMISOS_DE_EMPRESA)
      .filter((a) => a.startsWith("usuarios."))
      .sort();
    expect(deUsuarios).toEqual([...ACCIONES_DE_USUARIOS]);
    for (const accion of ACCIONES_DE_USUARIOS) {
      expect(PERMISOS_DE_EMPRESA[accion], accion).toEqual(["GERENTE", "ADMINISTRADOR"]);
    }
  });

  it("desactivar y reactivar una sucursal, y proponer o cancelar el traspaso, son solo del gerente (F4)", () => {
    for (const accion of SOLO_DEL_GERENTE) {
      expect(PERMISOS_DE_EMPRESA[accion], accion).toEqual(["GERENTE"]);
    }
  });

  it("ver, aceptar y rechazar un traspaso, y ver los permisos propios, son de los tres roles", () => {
    for (const accion of DEL_OPERADOR) {
      expect(PERMISOS_DE_EMPRESA[accion], accion).toEqual(["GERENTE", "ADMINISTRADOR", "OPERADOR"]);
    }
  });

  it("el operador no puede ninguna acción de usuarios (decisión 2) ni de sucursales ni de módulos", () => {
    const tabla = tablaDePermisos(PERMISOS_DE_EMPRESA);
    expect(tabla.OPERADOR.filter((a) => /^(usuarios|sucursales|modulos)\./.test(a))).toEqual([]);
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
  const activos = estadoDeModulos(CATALOGO_DE_MODULOS, [], []).modulosActivos;
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

describe("el guard con las reglas reales y la solo lectura (corrección 16)", () => {
  const acciones = Object.keys(PERMISOS_DE_EMPRESA) as ClaveAccion[];
  const enSoloLectura = new Set<ClaveModulo>(["administracion"]);
  const activos = estadoDeModulos(CATALOGO_DE_MODULOS, [], []).modulosActivos;

  it("el núcleo no depende de un plan: marcarlo en solo lectura no cambia ninguna decisión", () => {
    for (const rol of ROLES_DE_EMPRESA) {
      for (const accion of acciones) {
        const datos = { rol, modulosActivos: activos, capacidadesDeSucursal: null } as const;
        expect(
          evaluarGuard(REGLAS_DE_EMPRESA, accion, {
            ...datos,
            modulosEnSoloLectura: enSoloLectura,
          }),
          `${rol} ${accion}`,
        ).toEqual(evaluarGuard(REGLAS_DE_EMPRESA, accion, datos));
      }
    }
  });

  it("si un día el módulo fuera activable y quedara en solo lectura, el gerente solo perdería lo que crea o amplía", () => {
    const activable: ReglasDeEmpresa = {
      catalogo: {
        administracion: { ...CATALOGO_DE_MODULOS.administracion, obligatorio: false },
      },
      permisos: PERMISOS_DE_EMPRESA,
    };
    for (const accion of acciones) {
      const efecto = CATALOGO_DE_MODULOS.administracion.acciones[accion].efecto;
      expect(
        evaluarGuard(activable, accion, {
          rol: "GERENTE",
          modulosActivos: new Set<ClaveModulo>(),
          modulosEnSoloLectura: enSoloLectura,
          capacidadesDeSucursal: null,
        }),
        `${accion} (${efecto})`,
      ).toEqual(
        efecto === "CREA_AMPLIA"
          ? { ok: false, error: "MODULO_EN_SOLO_LECTURA" }
          : { ok: true, valor: null },
      );
    }
  });
});
