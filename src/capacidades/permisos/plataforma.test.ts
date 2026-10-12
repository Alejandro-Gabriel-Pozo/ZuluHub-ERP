import { describe, expect, it } from "vitest";
import { estadoDeModulos } from "../modulos/activos";
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

/**
 * Lo que pueden los dos roles, escrito a mano: la tabla de §B.3 de la especificación de H5 (10) más
 * `marcas.ver` y `planes.ver` de la de marcas y planes (§C).
 */
const DE_SOPORTE = [
  "altas.reenviar_invitacion",
  "altas.revocar_invitacion",
  "auditoria.ver",
  "configuracion.ver",
  "empresas.ver",
  "invitaciones.ver",
  "marcas.ver",
  "planes.ver",
  "soporte.buscar_referencia",
  "soporte.explicar",
  "tenants.ver",
  "trabajos.ver_fallidos",
] as const;

/** Lo que solo hace ADMIN: dar de alta, cancelar, suspender y reactivar (8, H5) y marcas y planes (12). */
const SOLO_DE_ADMIN = [
  "altas.cancelar",
  "empresas.alta",
  "empresas.reactivar",
  "empresas.suspender",
  "personas.reactivar",
  "personas.suspender",
  "tenants.reactivar",
  "tenants.suspender",
  "dominios.agregar",
  "dominios.retirar",
  "marcas.confirmar_version",
  "marcas.crear",
  "marcas.editar_borrador",
  "modulos_de_empresa.activar",
  "modulos_de_empresa.desactivar",
  "perillas.ajustar",
  "planes.asignar",
  "planes.crear",
  "planes.editar_borrador",
  "planes.publicar_version",
] as const;

const TODAS = Object.keys(PERMISOS_DE_PLATAFORMA) as ClaveAccionDePlataforma[];

/** Las 18 de H5, en su orden de declaración. */
const ACCIONES_DE_H5 = [
  "tenants.ver",
  "empresas.ver",
  "invitaciones.ver",
  "trabajos.ver_fallidos",
  "auditoria.ver",
  "configuracion.ver",
  "soporte.buscar_referencia",
  "soporte.explicar",
  "altas.reenviar_invitacion",
  "altas.revocar_invitacion",
  "empresas.alta",
  "altas.cancelar",
  "tenants.suspender",
  "tenants.reactivar",
  "empresas.suspender",
  "empresas.reactivar",
  "personas.suspender",
  "personas.reactivar",
] as const;

/** Las 14 acciones nuevas de plataforma de «marcas, productos y planes» (§C), en su orden. */
const ACCIONES_DE_MARCAS_Y_PLANES = [
  "marcas.ver",
  "planes.ver",
  "marcas.crear",
  "marcas.editar_borrador",
  "marcas.confirmar_version",
  "dominios.agregar",
  "dominios.retirar",
  "planes.crear",
  "planes.editar_borrador",
  "planes.publicar_version",
  "planes.asignar",
  "perillas.ajustar",
  "modulos_de_empresa.activar",
  "modulos_de_empresa.desactivar",
] as const;

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
          "tenants.ver": { capacidad: null, efecto: "LECTURA" },
          "empresas.ver": { capacidad: null, efecto: "LECTURA" },
          "invitaciones.ver": { capacidad: null, efecto: "LECTURA" },
          "trabajos.ver_fallidos": { capacidad: null, efecto: "LECTURA" },
          "auditoria.ver": { capacidad: null, efecto: "LECTURA" },
          "configuracion.ver": { capacidad: null, efecto: "LECTURA" },
          "soporte.buscar_referencia": { capacidad: null, efecto: "LECTURA" },
          "soporte.explicar": { capacidad: null, efecto: "LECTURA" },
          "altas.reenviar_invitacion": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "altas.revocar_invitacion": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "empresas.alta": { capacidad: null, efecto: "CREA_AMPLIA" },
          "altas.cancelar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "tenants.suspender": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "tenants.reactivar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "empresas.suspender": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "empresas.reactivar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "personas.suspender": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "personas.reactivar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "marcas.ver": { capacidad: null, efecto: "LECTURA" },
          "planes.ver": { capacidad: null, efecto: "LECTURA" },
          "marcas.crear": { capacidad: null, efecto: "CREA_AMPLIA" },
          "marcas.editar_borrador": { capacidad: null, efecto: "CREA_AMPLIA" },
          "marcas.confirmar_version": { capacidad: null, efecto: "CREA_AMPLIA" },
          "dominios.agregar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "dominios.retirar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
          "planes.crear": { capacidad: null, efecto: "CREA_AMPLIA" },
          "planes.editar_borrador": { capacidad: null, efecto: "CREA_AMPLIA" },
          "planes.publicar_version": { capacidad: null, efecto: "CREA_AMPLIA" },
          "planes.asignar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "perillas.ajustar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "modulos_de_empresa.activar": { capacidad: null, efecto: "CREA_AMPLIA" },
          "modulos_de_empresa.desactivar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
        },
      },
    });
  });

  it("el módulo plataforma está activo sin guardar nada", () => {
    expect([...estadoDeModulos(CATALOGO_DE_PLATAFORMA, [], []).modulosActivos]).toEqual([
      "plataforma",
    ]);
  });

  it("las acciones son las 32: 12 que hacen los dos roles y 20 que solo hace ADMIN", () => {
    expect(TODAS).toHaveLength(32);
    expect(DE_SOPORTE).toHaveLength(12);
    expect(SOLO_DE_ADMIN).toHaveLength(20);
  });

  it("las 14 de marcas y planes se agregaron juntas, al final del bloque y sin reordenar las 18 de H5", () => {
    const orden = Object.keys(CATALOGO_DE_PLATAFORMA.plataforma.acciones);
    expect(orden.slice(0, 18)).toEqual(ACCIONES_DE_H5);
    expect(orden.slice(18)).toEqual(ACCIONES_DE_MARCAS_Y_PLANES);
    expect(Object.keys(PERMISOS_DE_PLATAFORMA)).toEqual(orden);
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

  it("SOPORTE no tiene ninguna acción que escriba estructura: nada de alta, cancelar, suspender, reactivar, crear, editar, confirmar, publicar, asignar, ajustar, activar ni retirar", () => {
    const soporte = tablaDePermisosDePlataforma(PERMISOS_DE_PLATAFORMA).SOPORTE;
    expect(
      soporte.filter((a) =>
        /(alta|cancelar|suspender|reactivar|activar|crear|editar_borrador|confirmar_version|publicar_version|agregar|retirar|asignar|ajustar)$/.test(
          a,
        ),
      ),
    ).toEqual([]);
  });

  it("marcas y planes (§C): SOPORTE solo ve; ADMIN hace las 14; SOPORTE tiene 12 en total (las 10 de H5 más marcas.ver y planes.ver)", () => {
    const tabla = tablaDePermisosDePlataforma(PERMISOS_DE_PLATAFORMA);
    for (const accion of ACCIONES_DE_MARCAS_Y_PLANES) {
      const soloVer = accion === "marcas.ver" || accion === "planes.ver";
      expect(PERMISOS_DE_PLATAFORMA[accion], accion).toEqual(
        soloVer ? ["ADMIN", "SOPORTE"] : ["ADMIN"],
      );
      expect(tabla.ADMIN, accion).toContain(accion);
    }
    expect(tabla.SOPORTE).toHaveLength(12);
    expect(
      tabla.SOPORTE.filter((a) => (ACCIONES_DE_H5 as readonly string[]).includes(a)),
    ).toHaveLength(10);
    expect(tabla.ADMIN).toHaveLength(32);
  });

  it("piso jerárquico: lo que puede SOPORTE lo puede ADMIN", () => {
    const tabla = tablaDePermisosDePlataforma(PERMISOS_DE_PLATAFORMA);
    for (const accion of tabla.SOPORTE) expect(tabla.ADMIN).toContain(accion);
    expect(tabla.ADMIN).toHaveLength(32);
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
  const activos = estadoDeModulos(CATALOGO_DE_PLATAFORMA, [], []).modulosActivos;
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

/**
 * La clasificación de cada acción de plataforma por su efecto, fijada a propósito. La plataforma es
 * un módulo obligatorio y nunca está en solo lectura; el efecto se declara por uniformidad del tipo
 * (ninguna acción sin clasificar). Criterio: mirar y diagnosticar es `LECTURA`; dar de alta y
 * reactivar lo suspendido es `CREA_AMPLIA`; suspender, cancelar un alta y reenviar o revocar su
 * invitación RESTRINGEN o cierran algo iniciado: `COMPLETA_CIERRA`. Marcas y planes, igual: lo que
 * crea o amplía (crear, editar borrador, confirmar o publicar versión, agregar dominio, asignar plan,
 * ajustar perilla, activar módulo) es `CREA_AMPLIA`; retirar un dominio y desactivar un módulo
 * `COMPLETA_CIERRA`.
 */
const EFECTOS_DE_PLATAFORMA = {
  LECTURA: [
    "auditoria.ver",
    "configuracion.ver",
    "empresas.ver",
    "invitaciones.ver",
    "marcas.ver",
    "planes.ver",
    "soporte.buscar_referencia",
    "soporte.explicar",
    "tenants.ver",
    "trabajos.ver_fallidos",
  ],
  CREA_AMPLIA: [
    "dominios.agregar",
    "empresas.alta",
    "empresas.reactivar",
    "marcas.confirmar_version",
    "marcas.crear",
    "marcas.editar_borrador",
    "modulos_de_empresa.activar",
    "perillas.ajustar",
    "personas.reactivar",
    "planes.asignar",
    "planes.crear",
    "planes.editar_borrador",
    "planes.publicar_version",
    "tenants.reactivar",
  ],
  COMPLETA_CIERRA: [
    "altas.cancelar",
    "altas.reenviar_invitacion",
    "altas.revocar_invitacion",
    "dominios.retirar",
    "empresas.suspender",
    "modulos_de_empresa.desactivar",
    "personas.suspender",
    "tenants.suspender",
  ],
} as const;

describe("el efecto de cada acción de plataforma", () => {
  const acciones = Object.entries(CATALOGO_DE_PLATAFORMA.plataforma.acciones);
  const de = (efecto: string) =>
    acciones
      .filter(([, definicion]) => definicion.efecto === efecto)
      .map(([nombre]) => nombre)
      .sort();

  it("tabla de efectos: qué acción de plataforma mira, crea o amplía, o completa y cierra", () => {
    expect({
      LECTURA: de("LECTURA"),
      CREA_AMPLIA: de("CREA_AMPLIA"),
      COMPLETA_CIERRA: de("COMPLETA_CIERRA"),
    }).toEqual(EFECTOS_DE_PLATAFORMA);
  });

  it("las 32 acciones tienen exactamente un efecto, y ninguna queda sin clasificar", () => {
    const clasificadas = Object.values(EFECTOS_DE_PLATAFORMA).flat().sort();
    expect(clasificadas).toEqual(TODAS.slice().sort());
  });

  it("todo lo que la plataforma deja en SOPORTE que cambia datos cierra o completa, no crea", () => {
    // SOPORTE reenvía y revoca la invitación de un alta: retoma o cierra, no suma nada nuevo.
    for (const accion of DE_SOPORTE) {
      const efecto = CATALOGO_DE_PLATAFORMA.plataforma.acciones[accion].efecto;
      expect(efecto === "LECTURA" || efecto === "COMPLETA_CIERRA", accion).toBe(true);
    }
  });
});

describe("el guard de plataforma ante la solo lectura", () => {
  it("la plataforma es obligatoria: marcarla en solo lectura no cambia ninguna decisión", () => {
    const activos = estadoDeModulos(CATALOGO_DE_PLATAFORMA, [], []).modulosActivos;
    for (const rol of ROLES_DE_PLATAFORMA) {
      for (const accion of TODAS) {
        const datos = { rol, modulosActivos: activos, capacidadesDeSucursal: null } as const;
        expect(
          evaluarGuard(REGLAS_DE_PLATAFORMA, accion, {
            ...datos,
            modulosEnSoloLectura: new Set(["plataforma"] as const),
          }),
          `${rol} ${accion}`,
        ).toEqual(evaluarGuard(REGLAS_DE_PLATAFORMA, accion, datos));
      }
    }
  });
});
