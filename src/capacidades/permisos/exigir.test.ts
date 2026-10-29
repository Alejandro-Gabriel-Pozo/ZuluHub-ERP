import { describe, expect, it } from "vitest";
import { CATALOGO_DE_MODULOS, type ClaveAccion, type ClaveModulo } from "../modulos/catalogo";
import { PERMISOS_DE_EMPRESA, REGLAS_DE_EMPRESA, type ReglasDeEmpresa } from "./empresa";
import { accionesPermitidas, exigirAccion, exigirAcciones, type ActorCargado } from "./exigir";
import {
  CATALOGO_DE_PLATAFORMA,
  PERMISOS_DE_PLATAFORMA,
  REGLAS_DE_PLATAFORMA,
  ROLES_DE_PLATAFORMA,
  type ClaveAccionDePlataforma,
} from "./plataforma";
import { ROLES_DE_EMPRESA, type RolDeEmpresa } from "./roles";

/**
 * `exigirAccion` es el primer paso de cada caso de uso: carga al actor UNA vez, arma los módulos
 * activos con lo que la empresa activó y deja decidir al guard. Sin base de datos ni puertos.
 */

const cargaDe = <R extends string = RolDeEmpresa>(actor: ActorCargado<NoInfer<R>>) => {
  let llamadas = 0;
  const cargar = () => {
    llamadas += 1;
    return Promise.resolve(actor);
  };
  return { cargar, llamadas: () => llamadas };
};

const administracionComo = (
  estado: "disponible" | "en_desarrollo",
  obligatorio: boolean,
): ReglasDeEmpresa => ({
  catalogo: {
    ...CATALOGO_DE_MODULOS,
    administracion: {
      estado,
      obligatorio,
      acciones: CATALOGO_DE_MODULOS.administracion.acciones,
    },
  },
  permisos: PERMISOS_DE_EMPRESA,
});

describe("exigirAccion", () => {
  it("deja pasar al rol que la matriz incluye, y rechaza con SIN_PERMISO al que no", async () => {
    for (const rol of ROLES_DE_EMPRESA) {
      for (const accion of Object.keys(
        CATALOGO_DE_MODULOS.administracion.acciones,
      ) as ClaveAccion[]) {
        const puede = (PERMISOS_DE_EMPRESA[accion] as readonly string[]).includes(rol);
        const { cargar } = cargaDe({ rol, modulosActivados: [], modulosHabilitados: [] });
        expect(await exigirAccion(REGLAS_DE_EMPRESA, accion, cargar), `${rol} ${accion}`).toEqual(
          puede ? { ok: true, valor: null } : { ok: false, error: "SIN_PERMISO" },
        );
      }
    }
  });

  it("sin rol (sin persona, sin membresía activa o persona suspendida) da SIN_PERMISO", async () => {
    const { cargar } = cargaDe({ rol: null, modulosActivados: [], modulosHabilitados: [] });
    expect(await exigirAccion(REGLAS_DE_EMPRESA, "gerencia.ver_traspaso", cargar)).toEqual({
      ok: false,
      error: "SIN_PERMISO",
    });
  });

  it("carga al actor exactamente una vez por llamada, y cada llamada vuelve a cargarlo", async () => {
    const carga = cargaDe({ rol: "GERENTE", modulosActivados: [], modulosHabilitados: [] });
    await exigirAccion(REGLAS_DE_EMPRESA, "usuarios.invitar", carga.cargar);
    expect(carga.llamadas()).toBe(1);
    await exigirAccion(REGLAS_DE_EMPRESA, "usuarios.invitar", carga.cargar);
    expect(carga.llamadas()).toBe(2);
  });

  it("no guarda nada entre llamadas: si el actor cambia, cambia el resultado", async () => {
    let actor: ActorCargado = { rol: "GERENTE", modulosActivados: [], modulosHabilitados: [] };
    const cargar = () => Promise.resolve(actor);
    expect(await exigirAccion(REGLAS_DE_EMPRESA, "usuarios.apagar", cargar)).toEqual({
      ok: true,
      valor: null,
    });
    actor = { rol: null, modulosActivados: [], modulosHabilitados: [] };
    expect(await exigirAccion(REGLAS_DE_EMPRESA, "usuarios.apagar", cargar)).toEqual({
      ok: false,
      error: "SIN_PERMISO",
    });
  });

  it("un módulo no obligatorio y no activado da MODULO_NO_ACTIVO, aunque el rol alcance", async () => {
    const { cargar } = cargaDe({ rol: "GERENTE", modulosActivados: [], modulosHabilitados: [] });
    expect(
      await exigirAccion(administracionComo("disponible", false), "usuarios.invitar", cargar),
    ).toEqual({ ok: false, error: "MODULO_NO_ACTIVO" });
  });

  it("un módulo que la empresa activó y su plan incluye pasa; uno que activó otro módulo, no", async () => {
    const reglas = administracionComo("disponible", false);
    const activado = cargaDe({
      rol: "GERENTE",
      modulosActivados: ["administracion"],
      modulosHabilitados: ["administracion"],
    });
    expect(await exigirAccion(reglas, "usuarios.invitar", activado.cargar)).toEqual({
      ok: true,
      valor: null,
    });
    const otro = cargaDe({ rol: "GERENTE", modulosActivados: ["otro"], modulosHabilitados: [] });
    expect(await exigirAccion(reglas, "usuarios.invitar", otro.cargar)).toEqual({
      ok: false,
      error: "MODULO_NO_ACTIVO",
    });
  });

  it("un módulo activado que el plan no incluye queda en solo lectura: pasa lo que mira o cierra, no lo que crea", async () => {
    const reglas = administracionComo("disponible", false);
    const { cargar } = cargaDe({
      rol: "GERENTE",
      modulosActivados: ["administracion"],
      modulosHabilitados: [],
    });
    // CREA_AMPLIA: invitar. LECTURA: ver usuarios. COMPLETA_CIERRA: apagar a alguien.
    expect(await exigirAccion(reglas, "usuarios.invitar", cargar)).toEqual({
      ok: false,
      error: "MODULO_EN_SOLO_LECTURA",
    });
    expect(await exigirAccion(reglas, "usuarios.ver", cargar)).toEqual({ ok: true, valor: null });
    expect(await exigirAccion(reglas, "usuarios.apagar", cargar)).toEqual({
      ok: true,
      valor: null,
    });
  });

  it("el rol sigue mandando en solo lectura: una acción que cierra, sin permiso, da SIN_PERMISO", async () => {
    const reglas = administracionComo("disponible", false);
    const { cargar } = cargaDe({
      rol: "OPERADOR",
      modulosActivados: ["administracion"],
      modulosHabilitados: [],
    });
    expect(await exigirAccion(reglas, "usuarios.apagar", cargar)).toEqual({
      ok: false,
      error: "SIN_PERMISO",
    });
  });

  it("un módulo obligatorio nunca queda en solo lectura, aunque el plan no lo nombre", async () => {
    const { cargar } = cargaDe({
      rol: "GERENTE",
      modulosActivados: ["administracion"],
      modulosHabilitados: [],
    });
    expect(await exigirAccion(REGLAS_DE_EMPRESA, "usuarios.invitar", cargar)).toEqual({
      ok: true,
      valor: null,
    });
  });

  it("un módulo en desarrollo da MODULO_EN_DESARROLLO", async () => {
    const { cargar } = cargaDe({
      rol: "GERENTE",
      modulosActivados: ["administracion"],
      modulosHabilitados: [],
    });
    expect(
      await exigirAccion(administracionComo("en_desarrollo", true), "usuarios.invitar", cargar),
    ).toEqual({ ok: false, error: "MODULO_EN_DESARROLLO" });
  });

  it("si la carga falla, el error se propaga (no se autoriza por omisión)", async () => {
    await expect(
      exigirAccion(REGLAS_DE_EMPRESA, "usuarios.invitar", () => Promise.reject(new Error("caída"))),
    ).rejects.toThrow("caída");
  });

  it("una acción que el catálogo no declara no compila", () => {
    const { cargar } = cargaDe({ rol: "GERENTE", modulosActivados: [], modulosHabilitados: [] });
    const noSeEjecuta = () =>
      // @ts-expect-error la acción no existe en el catálogo
      exigirAccion(REGLAS_DE_EMPRESA, "usuarios.borrar_todo", cargar);
    expect(noSeEjecuta).toBeTypeOf("function");
    const claves: ClaveModulo[] = [
      "administracion",
      "facturacion",
      "catalogo",
      "vidriera",
      "stock",
    ];
    expect(claves).toEqual(Object.keys(CATALOGO_DE_MODULOS));
  });
});

describe("exigirAcciones", () => {
  it("pasa solo si el actor puede TODAS las acciones", async () => {
    // El gerente puede ambas; el operador puede emitir comprobantes pero no invitar usuarios.
    const gerente = cargaDe({ rol: "GERENTE", modulosActivados: [], modulosHabilitados: [] });
    expect(
      await exigirAcciones(
        REGLAS_DE_EMPRESA,
        ["usuarios.invitar", "sucursales.reactivar"],
        gerente.cargar,
      ),
    ).toEqual({ ok: true, valor: null });
    const operador = cargaDe({ rol: "OPERADOR", modulosActivados: [], modulosHabilitados: [] });
    expect(
      await exigirAcciones(
        REGLAS_DE_EMPRESA,
        ["gerencia.ver_traspaso", "usuarios.invitar"],
        operador.cargar,
      ),
    ).toEqual({ ok: false, error: "SIN_PERMISO" });
  });

  it("devuelve el rechazo de la PRIMERA acción que falla, en el orden dado", async () => {
    // Una acción que rechaza el rol (SIN_PERMISO) y otra que rechaza el módulo (facturación en desarrollo).
    const { cargar } = cargaDe({ rol: "OPERADOR", modulosActivados: [], modulosHabilitados: [] });
    expect(
      await exigirAcciones(REGLAS_DE_EMPRESA, ["usuarios.invitar", "comprobantes.emitir"], cargar),
    ).toEqual({ ok: false, error: "SIN_PERMISO" });
    expect(
      await exigirAcciones(REGLAS_DE_EMPRESA, ["comprobantes.emitir", "usuarios.invitar"], cargar),
    ).toEqual({ ok: false, error: "MODULO_EN_DESARROLLO" });
  });

  it("evalúa cada acción: pasar la primera no alcanza si falla la última", async () => {
    const { cargar } = cargaDe({ rol: "OPERADOR", modulosActivados: [], modulosHabilitados: [] });
    expect(
      await exigirAcciones(
        REGLAS_DE_EMPRESA,
        ["gerencia.ver_traspaso", "gerencia.aceptar_traspaso", "sucursales.crear"],
        cargar,
      ),
    ).toEqual({ ok: false, error: "SIN_PERMISO" });
  });

  it("carga al actor exactamente una vez por llamada, sin importar cuántas acciones pida", async () => {
    const carga = cargaDe({ rol: "GERENTE", modulosActivados: [], modulosHabilitados: [] });
    await exigirAcciones(
      REGLAS_DE_EMPRESA,
      ["usuarios.invitar", "usuarios.apagar", "sucursales.crear"],
      carga.cargar,
    );
    expect(carga.llamadas()).toBe(1);
  });

  it("con una sola acción se comporta como exigirAccion", async () => {
    for (const rol of ROLES_DE_EMPRESA) {
      const a = cargaDe({ rol, modulosActivados: [], modulosHabilitados: [] });
      const b = cargaDe({ rol, modulosActivados: [], modulosHabilitados: [] });
      expect(await exigirAcciones(REGLAS_DE_EMPRESA, ["sucursales.desactivar"], a.cargar)).toEqual(
        await exigirAccion(REGLAS_DE_EMPRESA, "sucursales.desactivar", b.cargar),
      );
    }
  });

  it("respeta el orden de precedencia del guard (solo lectura) también entre varias acciones", async () => {
    const reglas = administracionComo("disponible", false);
    const { cargar } = cargaDe({
      rol: "GERENTE",
      modulosActivados: ["administracion"],
      modulosHabilitados: [],
    });
    // LECTURA y COMPLETA_CIERRA pasan en solo lectura; CREA_AMPLIA no.
    expect(await exigirAcciones(reglas, ["usuarios.ver", "usuarios.apagar"], cargar)).toEqual({
      ok: true,
      valor: null,
    });
    expect(await exigirAcciones(reglas, ["usuarios.ver", "usuarios.invitar"], cargar)).toEqual({
      ok: false,
      error: "MODULO_EN_SOLO_LECTURA",
    });
  });

  it("una lista vacía lanza RangeError y no carga al actor (nunca se autoriza por omisión)", async () => {
    const carga = cargaDe({ rol: "GERENTE", modulosActivados: [], modulosHabilitados: [] });
    await expect(
      // @ts-expect-error la lista tiene que traer al menos una acción
      exigirAcciones(REGLAS_DE_EMPRESA, [], carga.cargar),
    ).rejects.toThrow(new RangeError("exigirAcciones sin ninguna acción"));
    expect(carga.llamadas()).toBe(0);
  });

  it("si la carga falla, el error se propaga", async () => {
    await expect(
      exigirAcciones(REGLAS_DE_EMPRESA, ["usuarios.invitar", "usuarios.ver"], () =>
        Promise.reject(new Error("caída")),
      ),
    ).rejects.toThrow("caída");
  });

  it("una acción que el catálogo no declara no compila", () => {
    const { cargar } = cargaDe({ rol: "GERENTE", modulosActivados: [], modulosHabilitados: [] });
    const noSeEjecuta = () =>
      // @ts-expect-error la acción no existe en el catálogo
      exigirAcciones(REGLAS_DE_EMPRESA, ["usuarios.invitar", "usuarios.borrar_todo"], cargar);
    expect(noSeEjecuta).toBeTypeOf("function");
  });
});

describe("exigirAccion con las reglas de plataforma (H5 P1)", () => {
  const todas = Object.keys(PERMISOS_DE_PLATAFORMA) as ClaveAccionDePlataforma[];

  it("deja pasar al rol que la matriz incluye, y rechaza con SIN_PERMISO al que no", async () => {
    for (const rol of ROLES_DE_PLATAFORMA) {
      for (const accion of todas) {
        const puede = (PERMISOS_DE_PLATAFORMA[accion] as readonly string[]).includes(rol);
        const { cargar } = cargaDe<typeof rol>({
          rol,
          modulosActivados: [],
          modulosHabilitados: [],
        });
        expect(
          await exigirAccion(REGLAS_DE_PLATAFORMA, accion, cargar),
          `${rol} ${accion}`,
        ).toEqual(puede ? { ok: true, valor: null } : { ok: false, error: "SIN_PERMISO" });
      }
    }
  });

  it("sin rol (administrador inexistente o inactivo) da SIN_PERMISO en toda acción", async () => {
    for (const accion of todas) {
      const { cargar } = cargaDe<"ADMIN">({
        rol: null,
        modulosActivados: [],
        modulosHabilitados: [],
      });
      expect(await exigirAccion(REGLAS_DE_PLATAFORMA, accion, cargar), accion).toEqual({
        ok: false,
        error: "SIN_PERMISO",
      });
    }
  });

  it("el módulo plataforma es obligatorio: está activo sin que nadie lo active", async () => {
    const { cargar } = cargaDe<"ADMIN">({
      rol: "ADMIN",
      modulosActivados: [],
      modulosHabilitados: [],
    });
    expect(await exigirAccion(REGLAS_DE_PLATAFORMA, "empresas.alta", cargar)).toEqual({
      ok: true,
      valor: null,
    });
    expect(Object.keys(CATALOGO_DE_PLATAFORMA)).toEqual(["plataforma"]);
  });

  it("una carga con un rol de empresa no compila, ni una acción de empresa", () => {
    const delGerente = cargaDe({ rol: "GERENTE", modulosActivados: [], modulosHabilitados: [] });
    const noSeEjecuta = () => {
      // @ts-expect-error "GERENTE" no es un rol de plataforma
      void exigirAccion(REGLAS_DE_PLATAFORMA, "empresas.alta", delGerente.cargar);
      // @ts-expect-error "usuarios.invitar" no es una acción de plataforma
      void exigirAccion(REGLAS_DE_PLATAFORMA, "usuarios.invitar", delGerente.cargar);
    };
    expect(noSeEjecuta).toBeTypeOf("function");
  });

  it("una carga con un rol de plataforma no compila en el guard de empresa", () => {
    const deAdmin = cargaDe<"ADMIN">({
      rol: "ADMIN",
      modulosActivados: [],
      modulosHabilitados: [],
    });
    const noSeEjecuta = () => {
      // @ts-expect-error "ADMIN" no es un rol de empresa
      void exigirAccion(REGLAS_DE_EMPRESA, "usuarios.invitar", deAdmin.cargar);
    };
    expect(noSeEjecuta).toBeTypeOf("function");
  });
});

describe("accionesPermitidas", () => {
  const CON_FACTURACION: ReglasDeEmpresa = {
    catalogo: {
      ...CATALOGO_DE_MODULOS,
      facturacion: { ...CATALOGO_DE_MODULOS.facturacion, estado: "disponible" },
    },
    permisos: PERMISOS_DE_EMPRESA,
  };
  const TODAS = Object.keys(PERMISOS_DE_EMPRESA) as ClaveAccion[];
  const actores: readonly [string, ActorCargado][] = [
    ...ROLES_DE_EMPRESA.flatMap((rol): [string, ActorCargado][] => [
      [`${rol} sin módulos`, { rol, modulosActivados: [], modulosHabilitados: [] }],
      [
        `${rol} con facturación en el plan`,
        { rol, modulosActivados: ["facturacion"], modulosHabilitados: ["facturacion"] },
      ],
      [
        `${rol} con facturación fuera del plan`,
        { rol, modulosActivados: ["facturacion"], modulosHabilitados: [] },
      ],
    ]),
    [
      "sin rol",
      { rol: null, modulosActivados: ["facturacion"], modulosHabilitados: ["facturacion"] },
    ],
  ];

  it.each(actores)(
    "%s: da exactamente lo que exigirAccion deja pasar, acción por acción (con y sin el módulo en desarrollo)",
    async (_nombre, actor) => {
      for (const reglas of [REGLAS_DE_EMPRESA, CON_FACTURACION]) {
        const esperadas: ClaveAccion[] = [];
        for (const accion of TODAS) {
          const veredicto = await exigirAccion(reglas, accion, () => Promise.resolve(actor));
          if (veredicto.ok) esperadas.push(accion);
        }
        expect(accionesPermitidas(reglas, actor)).toEqual(esperadas.sort());
      }
    },
  );

  it("el rol no alcanza: con el módulo en desarrollo, el gerente no ve ninguna acción de facturación", () => {
    const gerente: ActorCargado = {
      rol: "GERENTE",
      modulosActivados: ["facturacion"],
      modulosHabilitados: ["facturacion"],
    };
    const real = accionesPermitidas(REGLAS_DE_EMPRESA, gerente);
    expect(real).not.toContain("comprobantes.ver");
    expect(real).toContain("usuarios.invitar");
    expect(accionesPermitidas(CON_FACTURACION, gerente)).toContain("comprobantes.ver");
  });

  it("el módulo no alcanza: sin activar, o sin rol, no figura; fuera del plan solo lo que mira o cierra", () => {
    const sinActivar: ActorCargado = {
      rol: "OPERADOR",
      modulosActivados: [],
      modulosHabilitados: [],
    };
    expect(accionesPermitidas(CON_FACTURACION, sinActivar)).not.toContain("comprobantes.ver");
    const fueraDelPlan: ActorCargado = {
      rol: "OPERADOR",
      modulosActivados: ["facturacion"],
      modulosHabilitados: [],
    };
    const lista = accionesPermitidas(CON_FACTURACION, fueraDelPlan);
    expect(lista).toContain("comprobantes.ver");
    expect(lista).toContain("notas_de_credito.emitir");
    expect(lista).not.toContain("comprobantes.emitir_manual");
    expect(accionesPermitidas(CON_FACTURACION, { ...fueraDelPlan, rol: null })).toEqual([]);
  });

  it("sale ordenada y sin repetir, y el operador no recibe lo que es del gerente", () => {
    const operador: ActorCargado = {
      rol: "OPERADOR",
      modulosActivados: ["facturacion"],
      modulosHabilitados: ["facturacion"],
    };
    const lista = accionesPermitidas(CON_FACTURACION, operador);
    expect(lista).toEqual([...new Set(lista)].sort());
    expect(lista).not.toContain("series.resincronizar");
    expect(lista).not.toContain("certificados.gestionar");
  });
});
