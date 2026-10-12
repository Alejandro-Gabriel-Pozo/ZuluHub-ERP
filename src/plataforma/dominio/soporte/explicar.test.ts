import { describe, expect, it } from "vitest";
import type { ModuloDelGuard, ReglasDelGuard } from "../../../capacidades/permisos/guard";
import type { EstadoDeEmpresa, EstadoDeTenant } from "../../../contexto/estados";
import {
  decidirAceptacion,
  type DatosDeAceptacion,
  type Email,
  type Invitacion,
} from "../../../modulos/identidad/publico";
import {
  empresaId,
  invitacionId,
  personaId,
  tenantId,
} from "../../../primitivas/identificadores/marca";
import {
  explicarAccionDeEmpresa,
  explicarAceptacion,
  type HechosDeAccion,
  type RazonDelRol,
} from "./explicar";

/**
 * Las reglas de PRUEBA (un catálogo con un módulo siempre activo, uno activable y uno en desarrollo):
 * la matriz real de empresa no se importa desde plataforma. La fidelidad contra el guard y la matriz
 * reales se prueba en `test/plataforma/fidelidad-de-explicar.test.ts`.
 */
type Rol = "JEFE" | "AYUDANTE";
type Modulo = "base" | "ventas" | "futuro";
type Accion = "base.ver" | "base.cerrar" | "ventas.vender" | "futuro.pronosticar";

const CATALOGO = {
  base: {
    estado: "disponible",
    obligatorio: true,
    acciones: { "base.ver": { capacidad: null }, "base.cerrar": { capacidad: null } },
  },
  ventas: {
    estado: "disponible",
    obligatorio: false,
    acciones: { "ventas.vender": { capacidad: null } },
  },
  futuro: {
    estado: "en_desarrollo",
    obligatorio: false,
    acciones: { "futuro.pronosticar": { capacidad: null } },
  },
} as const satisfies Record<Modulo, ModuloDelGuard<never>>;

const REGLAS: ReglasDelGuard<Modulo, Accion, never, Rol> = {
  catalogo: CATALOGO,
  permisos: {
    "base.ver": ["JEFE", "AYUDANTE"],
    "base.cerrar": ["JEFE"],
    "ventas.vender": ["JEFE"],
    "futuro.pronosticar": ["JEFE"],
  },
};

const E1 = empresaId("e-1");

const hechos = (cambios: Partial<HechosDeAccion<Rol>> = {}): HechosDeAccion<Rol> => ({
  empresaId: E1,
  persona: { activoGlobal: true },
  membresia: { rol: "JEFE", activo: true },
  modulosActivados: ["ventas"],
  estadoDeEmpresa: "ACTIVE",
  estadoDeTenant: "ACTIVE",
  ...cambios,
});

const OK = { ok: true, valor: null };
const rechazo = (motivo: unknown) => ({ ok: false, error: motivo });

describe("explicarAccionDeEmpresa: lo que ve cada persona", () => {
  it("con rol, módulo activo y la empresa operando: permitido, con el rol y la razón", () => {
    expect(explicarAccionDeEmpresa(REGLAS, "base.cerrar", hechos())).toEqual({
      accion: "base.cerrar",
      rol: "JEFE",
      razonDelRol: "CON_ROL",
      estadoEfectivo: "OPERA",
      guard: OK,
      opera: OK,
      decision: OK,
    });
  });

  it("un rol que la matriz no incluye: SIN_PERMISO, con su rol a la vista", () => {
    const e = explicarAccionDeEmpresa(
      REGLAS,
      "base.cerrar",
      hechos({ membresia: { rol: "AYUDANTE", activo: true } }),
    );
    expect(e.rol).toBe("AYUDANTE");
    expect(e.razonDelRol).toBe("CON_ROL");
    expect(e.guard).toEqual(rechazo("SIN_PERMISO"));
    expect(e.opera).toEqual(OK);
    expect(e.decision).toEqual(rechazo("SIN_PERMISO"));
  });

  it("explica por qué no hay rol: persona inexistente, suspendida, sin membresía o con la membresía apagada", () => {
    const casos: [Partial<HechosDeAccion<Rol>>, RazonDelRol][] = [
      [{ persona: null }, "PERSONA_INEXISTENTE"],
      [{ persona: { activoGlobal: false } }, "PERSONA_SUSPENDIDA"],
      [{ membresia: null }, "SIN_MEMBRESIA"],
      [{ membresia: { rol: "JEFE", activo: false } }, "MEMBRESIA_APAGADA"],
    ];
    for (const [cambios, razon] of casos) {
      const e = explicarAccionDeEmpresa(REGLAS, "base.ver", hechos(cambios));
      expect(e.razonDelRol, razon).toBe(razon);
      expect(e.rol, razon).toBeNull();
      expect(e.decision, razon).toEqual(rechazo("SIN_PERMISO"));
    }
  });

  it("precedencia de las razones: persona inexistente, suspendida, sin membresía, apagada", () => {
    const todoMal = hechos({ persona: null, membresia: { rol: "JEFE", activo: false } });
    expect(explicarAccionDeEmpresa(REGLAS, "base.ver", todoMal).razonDelRol).toBe(
      "PERSONA_INEXISTENTE",
    );
    expect(
      explicarAccionDeEmpresa(REGLAS, "base.ver", {
        ...todoMal,
        persona: { activoGlobal: false },
      }).razonDelRol,
    ).toBe("PERSONA_SUSPENDIDA");
    expect(
      explicarAccionDeEmpresa(REGLAS, "base.ver", {
        ...todoMal,
        persona: { activoGlobal: false },
        membresia: null,
      }).razonDelRol,
    ).toBe("PERSONA_SUSPENDIDA");
    expect(
      explicarAccionDeEmpresa(REGLAS, "base.ver", { ...todoMal, persona: { activoGlobal: true } })
        .razonDelRol,
    ).toBe("MEMBRESIA_APAGADA");
  });

  it("una persona suspendida con la membresía activa tampoco tiene rol (la suspensión corta todo)", () => {
    const e = explicarAccionDeEmpresa(
      REGLAS,
      "base.cerrar",
      hechos({ persona: { activoGlobal: false } }),
    );
    expect(e.rol).toBeNull();
    expect(e.guard).toEqual(rechazo("SIN_PERMISO"));
  });
});

describe("explicarAccionDeEmpresa: módulos y empresa, en el orden de los casos reales", () => {
  it("un módulo activable que la empresa no activó: MODULO_NO_ACTIVO; activado, pasa", () => {
    expect(
      explicarAccionDeEmpresa(REGLAS, "ventas.vender", hechos({ modulosActivados: [] })).guard,
    ).toEqual(rechazo("MODULO_NO_ACTIVO"));
    expect(explicarAccionDeEmpresa(REGLAS, "ventas.vender", hechos()).guard).toEqual(OK);
  });

  it("un módulo en desarrollo: MODULO_EN_DESARROLLO, aunque esté 'activado'", () => {
    expect(
      explicarAccionDeEmpresa(
        REGLAS,
        "futuro.pronosticar",
        hechos({ modulosActivados: ["futuro"] }),
      ).guard,
    ).toEqual(rechazo("MODULO_EN_DESARROLLO"));
  });

  it("el guard decide primero: sin permiso y empresa suspendida da SIN_PERMISO, no EMPRESA_NO_OPERA", () => {
    const e = explicarAccionDeEmpresa(
      REGLAS,
      "base.cerrar",
      hechos({ membresia: { rol: "AYUDANTE", activo: true }, estadoDeEmpresa: "SUSPENDED" }),
    );
    expect(e.decision).toEqual(rechazo("SIN_PERMISO"));
    // Pero se ve que además la empresa no opera.
    expect(e.opera).toEqual({
      ok: false,
      error: { codigo: "EMPRESA_NO_OPERA", empresaId: E1, motivo: "EMPRESA_SUSPENDIDA" },
    });
    expect(e.estadoEfectivo).toBe("EMPRESA_SUSPENDIDA");
  });

  it("con permiso pero una empresa que no opera: la decisión es EMPRESA_NO_OPERA con el motivo", () => {
    const casos: [EstadoDeEmpresa, EstadoDeTenant, string][] = [
      ["PROVISIONING", "ACTIVE", "EMPRESA_EN_ALTA"],
      ["SUSPENDED", "ACTIVE", "EMPRESA_SUSPENDIDA"],
      ["CANCELLED", "ACTIVE", "EMPRESA_CANCELADA"],
      ["DELETING", "ACTIVE", "EMPRESA_EN_BAJA"],
      ["ACTIVE", "SUSPENDED", "TENANT_SUSPENDIDO"],
      ["CANCELLED", "SUSPENDED", "EMPRESA_CANCELADA"],
    ];
    for (const [estadoDeEmpresa, estadoDeTenant, motivo] of casos) {
      const e = explicarAccionDeEmpresa(
        REGLAS,
        "base.cerrar",
        hechos({ estadoDeEmpresa, estadoDeTenant }),
      );
      const esperado = {
        ok: false,
        error: { codigo: "EMPRESA_NO_OPERA", empresaId: E1, motivo },
      };
      expect(e.guard, motivo).toEqual(OK);
      expect(e.opera, motivo).toEqual(esperado);
      expect(e.decision, motivo).toEqual(esperado);
      expect(e.estadoEfectivo, motivo).toBe(motivo);
    }
  });

  it("sin permiso por el módulo y con la empresa operando: la decisión es el motivo del guard", () => {
    const e = explicarAccionDeEmpresa(REGLAS, "ventas.vender", hechos({ modulosActivados: [] }));
    expect(e.opera).toEqual(OK);
    expect(e.decision).toEqual(rechazo("MODULO_NO_ACTIVO"));
  });

  it("una acción que el catálogo no declara lanza RangeError (nunca se explica por omisión)", () => {
    const abiertas = REGLAS as unknown as ReglasDelGuard<Modulo, string, never, Rol>;
    expect(() => explicarAccionDeEmpresa(abiertas, "nadie.hace", hechos())).toThrow(RangeError);
  });

  it("no modifica los hechos ni toca las reglas", () => {
    const h = hechos();
    const antes = JSON.stringify([h, REGLAS]);
    explicarAccionDeEmpresa(REGLAS, "base.ver", h);
    expect(JSON.stringify([h, REGLAS])).toBe(antes);
  });

  it("un rol de otro catálogo en los hechos no compila", () => {
    const deOtroCatalogo: HechosDeAccion<"GERENTE"> = {
      ...hechos(),
      membresia: { rol: "GERENTE", activo: true },
    };
    const noSeEjecuta = () =>
      // @ts-expect-error "GERENTE" no es un rol de estas reglas
      explicarAccionDeEmpresa(REGLAS, "base.ver", deOtroCatalogo);
    expect(noSeEjecuta).toBeTypeOf("function");
  });
});

describe("explicarAceptacion", () => {
  const T0 = new Date("2026-10-12T12:00:00.000Z");
  const EMAIL = "ana@x.com" as Email;
  const invitacion = (cambios: Partial<Invitacion> = {}): Invitacion => ({
    id: invitacionId("inv-1"),
    tenantId: tenantId("t-1"),
    tipo: "USUARIO",
    email: EMAIL,
    estado: "PENDIENTE",
    emitidaEn: T0,
    venceEn: new Date(T0.getTime() + 7 * 24 * 3_600_000),
    empresas: [{ empresaId: E1, rol: "OPERADOR", sucursales: [] }],
    aceptadaPor: null,
    reemplazadaPor: null,
    version: 1,
    ...cambios,
  });
  const datos = (cambios: Partial<Omit<DatosDeAceptacion, "emailAutenticado">> = {}) => ({
    ahora: T0,
    persona: null,
    estados: new Map([[E1, { empresa: "ACTIVE" as const, tenant: "ACTIVE" as const }]]),
    miembroActivoEn: new Set<typeof E1>(),
    rolesAnteriores: new Map(),
    ...cambios,
  });

  it("una invitación vigente con la empresa operando se puede aceptar; el supuesto va en la salida", () => {
    expect(explicarAceptacion(invitacion(), datos())).toEqual({
      estadoDeLaInvitacion: "PENDIENTE",
      decision: { ok: true, valor: { tipo: "ACEPTAR" } },
      supuestos: ["EMAIL_AUTENTICADO_ES_EL_DE_LA_INVITACION"],
    });
  });

  it("supone que quien acepta es el dueño del email: nunca da INVITACION_DE_OTRO_EMAIL", () => {
    const e = explicarAceptacion(invitacion(), datos());
    expect(e.decision).not.toEqual(rechazo("INVITACION_DE_OTRO_EMAIL"));
    // Y es exactamente lo que respondería decidirAceptacion con ese email.
    expect(e.decision).toEqual(
      decidirAceptacion(invitacion(), { ...datos(), emailAutenticado: EMAIL }),
    );
  });

  it("explica cada rechazo con el código real y el estado de la invitación", () => {
    const vencida = explicarAceptacion(invitacion({ venceEn: T0 }), datos());
    expect(vencida.estadoDeLaInvitacion).toBe("VENCIDA");
    expect(vencida.decision).toEqual(rechazo("INVITACION_VENCIDA"));

    const revocada = explicarAceptacion(invitacion({ estado: "REVOCADA" }), datos());
    expect(revocada.estadoDeLaInvitacion).toBe("REVOCADA");
    expect(revocada.decision).toEqual(rechazo("INVITACION_REVOCADA"));

    const suspendida = explicarAceptacion(
      invitacion(),
      datos({ persona: { id: personaId("p-1"), email: EMAIL, activoGlobal: false } }),
    );
    expect(suspendida.decision).toEqual(rechazo("PERSONA_SUSPENDIDA"));

    const empresaSuspendida = explicarAceptacion(
      invitacion(),
      datos({
        estados: new Map([[E1, { empresa: "SUSPENDED" as const, tenant: "ACTIVE" as const }]]),
      }),
    );
    expect(empresaSuspendida.decision).toEqual(
      rechazo({ codigo: "EMPRESA_NO_OPERA", empresaId: E1, motivo: "EMPRESA_SUSPENDIDA" }),
    );
  });

  it("la hora entra como dato: la misma invitación se explica distinto antes y después de vencer", () => {
    const i = invitacion();
    expect(
      explicarAceptacion(i, datos({ ahora: new Date(i.venceEn.getTime() - 1) }))
        .estadoDeLaInvitacion,
    ).toBe("PENDIENTE");
    expect(explicarAceptacion(i, datos({ ahora: i.venceEn })).estadoDeLaInvitacion).toBe("VENCIDA");
  });

  it("si falta el estado de una empresa de la invitación, lanza (error del llamador)", () => {
    expect(() => explicarAceptacion(invitacion(), datos({ estados: new Map() }))).toThrow(
      RangeError,
    );
  });
});
