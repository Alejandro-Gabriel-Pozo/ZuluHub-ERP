import { describe, expect, it } from "vitest";
import type { EstadoDeEmpresa, EstadoDeTenant, EstadosDeEmpresa } from "../../../contexto/estados";
import {
  empresaId,
  invitacionId,
  personaId,
  sucursalId,
  tenantId,
  type EmpresaId,
} from "../../../primitivas/identificadores/marca";
import type { Email } from "./email";
import {
  PLAZOS_EN_MS,
  TRANSICIONES_DE_INVITACION,
  decidirAceptacion,
  decidirInvitacionDeUsuario,
  decidirReenvio,
  estadoDeInvitacion,
  nuevaInvitacion,
  type DatosDeAceptacion,
  type EmpresaInvitada,
  type EstadoGuardado,
  type Invitacion,
  type RolDeEmpresa,
  type TipoDeInvitacion,
} from "./invitacion";
import type { Persona } from "./membresia";

const HORA = 3_600_000;
const DIA = 24 * HORA;
const T0 = new Date("2026-10-01T12:00:00.000Z");
const mas = (fecha: Date, ms: number) => new Date(fecha.getTime() + ms);

const E1 = empresaId("e-1");
const E2 = empresaId("e-2");
const E3 = empresaId("e-3");
const EMAIL = "ana@x.com" as Email;
const OTRO_EMAIL = "beto@x.com" as Email;
const ANA = personaId("p-ana");
const BETO = personaId("p-beto");

const asignacion = (id: EmpresaId, rol: RolDeEmpresa = "OPERADOR"): EmpresaInvitada => ({
  empresaId: id,
  rol,
  sucursales: [sucursalId("s-1")],
});

const invitacion = (cambios: Partial<Invitacion> = {}): Invitacion => ({
  id: invitacionId("inv-1"),
  tenantId: tenantId("t-1"),
  tipo: "USUARIO",
  email: EMAIL,
  estado: "PENDIENTE",
  emitidaEn: T0,
  venceEn: mas(T0, 7 * DIA),
  empresas: [asignacion(E1)],
  aceptadaPor: null,
  reemplazadaPor: null,
  version: 1,
  ...cambios,
});

const alta = (cambios: Partial<Invitacion> = {}): Invitacion =>
  invitacion({
    tipo: "ALTA_GERENTE",
    venceEn: mas(T0, DIA),
    empresas: [asignacion(E1, "GERENTE")],
    ...cambios,
  });

const personaAna: Persona = { id: ANA, email: EMAIL, activoGlobal: true };

const estados = (...filas: [EmpresaId, EstadoDeEmpresa, EstadoDeTenant?][]): EstadosDeEmpresa =>
  new Map(filas.map(([id, empresa, tenant]) => [id, { empresa, tenant: tenant ?? "ACTIVE" }]));

const datos = (cambios: Partial<DatosDeAceptacion> = {}): DatosDeAceptacion => ({
  ahora: mas(T0, DIA),
  emailAutenticado: EMAIL,
  persona: null,
  estados: estados([E1, "ACTIVE"]),
  miembroActivoEn: new Set(),
  rolesAnteriores: new Map(),
  ...cambios,
});

const error = <E>(e: E) => ({ ok: false, error: e });

describe("U1: estado de la invitación según ahora", () => {
  const venceEn = mas(T0, 7 * DIA);
  const casos: [EstadoGuardado, number, string][] = [
    ["PENDIENTE", -DIA, "PENDIENTE"],
    ["PENDIENTE", -1, "PENDIENTE"],
    ["PENDIENTE", 0, "VENCIDA"],
    ["PENDIENTE", 1, "VENCIDA"],
    ["PENDIENTE", DIA, "VENCIDA"],
    ["ACEPTADA", -1, "ACEPTADA"],
    ["ACEPTADA", 0, "ACEPTADA"],
    ["ACEPTADA", 1, "ACEPTADA"],
    ["ACEPTADA", 365 * DIA, "ACEPTADA"],
    ["REVOCADA", -1, "REVOCADA"],
    ["REVOCADA", 0, "REVOCADA"],
    ["REVOCADA", 1, "REVOCADA"],
    ["REVOCADA", 365 * DIA, "REVOCADA"],
  ];
  it.each(casos)("%s con ahora = venceEn %+d ms es %s", (estado, desfase, esperado) => {
    expect(estadoDeInvitacion(invitacion({ estado, venceEn }), mas(venceEn, desfase))).toBe(
      esperado,
    );
  });

  it("emitida y vencimiento en la misma fecha: vence en el acto", () => {
    expect(estadoDeInvitacion(invitacion({ venceEn: T0 }), T0)).toBe("VENCIDA");
  });
});

describe("transiciones de invitación", () => {
  it("el diagrama de estados es exactamente el del diseño", () => {
    expect(TRANSICIONES_DE_INVITACION).toEqual({
      PENDIENTE: ["ACEPTADA", "REVOCADA"],
      ACEPTADA: [],
      REVOCADA: [],
    });
  });
});

describe("U2: plazos", () => {
  it("las constantes son las del caso 0c", () => {
    expect(PLAZOS_EN_MS).toEqual({ ALTA_GERENTE: 86_400_000, USUARIO: 604_800_000 });
  });

  const casos: [TipoDeInvitacion, RolDeEmpresa, number][] = [
    ["ALTA_GERENTE", "GERENTE", 24 * HORA],
    ["USUARIO", "OPERADOR", 7 * DIA],
  ];
  it.each(casos)("%s: venceEn = emitidaEn + plazo, y emitidaEn = ahora", (tipo, rol, plazo) => {
    const resultado = nuevaInvitacion(
      {
        id: invitacionId("inv-9"),
        tokenHash: "hash-9",
        tenantId: tenantId("t-1"),
        tipo,
        email: EMAIL,
        empresas: [asignacion(E1, rol)],
        emitidaPor: ANA,
      },
      T0,
    );
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.valor.emitidaEn).toEqual(T0);
    expect(resultado.valor.venceEn).toEqual(mas(T0, plazo));
    expect(resultado.valor.venceEn.getTime() - resultado.valor.emitidaEn.getTime()).toBe(plazo);
  });
});

describe("U3: nuevaInvitacion", () => {
  const base = {
    id: invitacionId("inv-9"),
    tokenHash: "hash-9",
    tenantId: tenantId("t-1"),
    email: EMAIL,
    emitidaPor: ANA,
  } as const;

  it("arma la invitación con todos sus datos, sin tocar la hora recibida", () => {
    const empresas = [asignacion(E1, "ADMINISTRADOR"), asignacion(E2, "OPERADOR")];
    const ahora = new Date(T0);
    expect(nuevaInvitacion({ ...base, tipo: "USUARIO", empresas }, ahora)).toEqual({
      ok: true,
      valor: {
        id: base.id,
        tokenHash: "hash-9",
        tenantId: base.tenantId,
        tipo: "USUARIO",
        email: EMAIL,
        emitidaPor: ANA,
        emitidaEn: T0,
        venceEn: mas(T0, 7 * DIA),
        empresas,
      },
    });
    expect(ahora).toEqual(T0);
  });

  it("el alta lleva emitidaPor null cuando la emite el sistema", () => {
    const resultado = nuevaInvitacion(
      { ...base, tipo: "ALTA_GERENTE", empresas: [asignacion(E1, "GERENTE")], emitidaPor: null },
      T0,
    );
    expect(resultado.ok && resultado.valor.emitidaPor).toBeNull();
  });

  it("sin empresas: INVITACION_SIN_EMPRESAS, sea cual sea el tipo", () => {
    expect(nuevaInvitacion({ ...base, tipo: "USUARIO", empresas: [] }, T0)).toEqual(
      error("INVITACION_SIN_EMPRESAS"),
    );
    expect(nuevaInvitacion({ ...base, tipo: "ALTA_GERENTE", empresas: [] }, T0)).toEqual(
      error("INVITACION_SIN_EMPRESAS"),
    );
  });

  it("empresas repetidas: EMPRESA_REPETIDA, aunque los roles difieran", () => {
    expect(
      nuevaInvitacion(
        { ...base, tipo: "USUARIO", empresas: [asignacion(E1), asignacion(E2), asignacion(E1)] },
        T0,
      ),
    ).toEqual(error("EMPRESA_REPETIDA"));
    expect(
      nuevaInvitacion(
        { ...base, tipo: "USUARIO", empresas: [asignacion(E1), asignacion(E1, "ADMINISTRADOR")] },
        T0,
      ),
    ).toEqual(error("EMPRESA_REPETIDA"));
  });

  it("el usuario no admite el rol GERENTE, en ninguna posición", () => {
    for (const empresas of [
      [asignacion(E1, "GERENTE")],
      [asignacion(E1, "GERENTE"), asignacion(E2)],
      [asignacion(E1), asignacion(E2, "GERENTE")],
    ]) {
      expect(nuevaInvitacion({ ...base, tipo: "USUARIO", empresas }, T0)).toEqual(
        error("ROL_NO_INVITABLE"),
      );
    }
  });

  it("el usuario admite ADMINISTRADOR y OPERADOR en varias empresas", () => {
    const resultado = nuevaInvitacion(
      {
        ...base,
        tipo: "USUARIO",
        empresas: [asignacion(E1, "ADMINISTRADOR"), asignacion(E2), asignacion(E3, "OPERADOR")],
      },
      T0,
    );
    expect(resultado.ok).toBe(true);
  });

  it("el alta exige exactamente una empresa con rol GERENTE", () => {
    expect(
      nuevaInvitacion({ ...base, tipo: "ALTA_GERENTE", empresas: [asignacion(E1, "GERENTE")] }, T0)
        .ok,
    ).toBe(true);
    for (const empresas of [
      [asignacion(E1, "ADMINISTRADOR")],
      [asignacion(E1, "OPERADOR")],
      [asignacion(E1, "GERENTE"), asignacion(E2, "GERENTE")],
      [asignacion(E1, "GERENTE"), asignacion(E2, "OPERADOR")],
      [asignacion(E1, "OPERADOR"), asignacion(E2, "GERENTE")],
    ]) {
      expect(nuevaInvitacion({ ...base, tipo: "ALTA_GERENTE", empresas }, T0)).toEqual(
        error("ALTA_INVALIDA"),
      );
    }
  });

  it("precedencia: sin empresas, después repetidas, después la regla del tipo", () => {
    // Repetida y además con rol inválido: gana EMPRESA_REPETIDA.
    expect(
      nuevaInvitacion(
        { ...base, tipo: "USUARIO", empresas: [asignacion(E1, "GERENTE"), asignacion(E1)] },
        T0,
      ),
    ).toEqual(error("EMPRESA_REPETIDA"));
    // Alta con la misma empresa dos veces (también inválida por cantidad): gana EMPRESA_REPETIDA.
    expect(
      nuevaInvitacion(
        {
          ...base,
          tipo: "ALTA_GERENTE",
          empresas: [asignacion(E1, "GERENTE"), asignacion(E1, "GERENTE")],
        },
        T0,
      ),
    ).toEqual(error("EMPRESA_REPETIDA"));
  });
});

describe("U4: decidirAceptacion", () => {
  describe("camino feliz", () => {
    it("acepta una invitación vigente de una persona nueva", () => {
      expect(decidirAceptacion(invitacion(), datos())).toEqual({
        ok: true,
        valor: { tipo: "ACEPTAR" },
      });
    });

    it("acepta con una persona existente y activa que no es miembro", () => {
      expect(
        decidirAceptacion(
          invitacion({ empresas: [asignacion(E1), asignacion(E2)] }),
          datos({
            persona: personaAna,
            estados: estados([E1, "ACTIVE"], [E2, "ACTIVE"]),
            miembroActivoEn: new Set([E3]),
          }),
        ),
      ).toEqual({ ok: true, valor: { tipo: "ACEPTAR" } });
    });

    it("el último milisegundo de vigencia todavía acepta; el vencimiento exacto ya no", () => {
      const i = invitacion();
      expect(decidirAceptacion(i, datos({ ahora: mas(i.venceEn, -1) })).ok).toBe(true);
      expect(decidirAceptacion(i, datos({ ahora: i.venceEn }))).toEqual(
        error("INVITACION_VENCIDA"),
      );
      expect(decidirAceptacion(i, datos({ ahora: mas(i.venceEn, 1) }))).toEqual(
        error("INVITACION_VENCIDA"),
      );
    });

    it("el alta del gerente se acepta con la empresa en PROVISIONING", () => {
      expect(
        decidirAceptacion(
          alta(),
          datos({ ahora: mas(T0, DIA - 1), estados: estados([E1, "PROVISIONING"]) }),
        ),
      ).toEqual({ ok: true, valor: { tipo: "ACEPTAR" } });
    });
  });

  describe("cada error por separado", () => {
    it("ALTA_NO_PENDIENTE: la empresa del alta ya no está en PROVISIONING", () => {
      for (const empresa of ["ACTIVE", "SUSPENDED", "CANCELLED", "DELETING"] as const) {
        expect(decidirAceptacion(alta(), datos({ estados: estados([E1, empresa]) }))).toEqual(
          error("ALTA_NO_PENDIENTE"),
        );
      }
    });

    it("ALTA_NO_PENDIENTE: alcanza con que una empresa del alta no esté en PROVISIONING", () => {
      const dosEmpresas = alta({
        empresas: [asignacion(E1, "GERENTE"), asignacion(E2, "GERENTE")],
      });
      expect(
        decidirAceptacion(
          dosEmpresas,
          datos({ estados: estados([E1, "PROVISIONING"], [E2, "ACTIVE"]) }),
        ),
      ).toEqual(error("ALTA_NO_PENDIENTE"));
      expect(
        decidirAceptacion(
          dosEmpresas,
          datos({ estados: estados([E1, "ACTIVE"], [E2, "PROVISIONING"]) }),
        ),
      ).toEqual(error("ALTA_NO_PENDIENTE"));
    });

    it("una invitación de usuario no mira si la empresa está en PROVISIONING por esta regla", () => {
      expect(decidirAceptacion(invitacion(), datos({ estados: estados([E1, "ACTIVE"]) })).ok).toBe(
        true,
      );
    });

    it("INVITACION_NO_PENDIENTE: la aceptó otra persona, o no se sabe quién es", () => {
      const aceptada = invitacion({ estado: "ACEPTADA", aceptadaPor: BETO });
      expect(decidirAceptacion(aceptada, datos({ persona: personaAna }))).toEqual(
        error("INVITACION_NO_PENDIENTE"),
      );
      expect(decidirAceptacion(aceptada, datos({ persona: null }))).toEqual(
        error("INVITACION_NO_PENDIENTE"),
      );
      expect(
        decidirAceptacion(
          invitacion({ estado: "ACEPTADA", aceptadaPor: null }),
          datos({ persona: personaAna }),
        ),
      ).toEqual(error("INVITACION_NO_PENDIENTE"));
    });

    it("YA_ACEPTADA (ok): la aceptó esta misma persona", () => {
      expect(
        decidirAceptacion(
          invitacion({ estado: "ACEPTADA", aceptadaPor: ANA }),
          datos({ persona: personaAna }),
        ),
      ).toEqual({ ok: true, valor: { tipo: "YA_ACEPTADA" } });
    });

    it("INVITACION_REVOCADA", () => {
      expect(decidirAceptacion(invitacion({ estado: "REVOCADA" }), datos())).toEqual(
        error("INVITACION_REVOCADA"),
      );
    });

    it("INVITACION_VENCIDA", () => {
      expect(decidirAceptacion(invitacion(), datos({ ahora: mas(T0, 8 * DIA) }))).toEqual(
        error("INVITACION_VENCIDA"),
      );
    });

    it("INVITACION_DE_OTRO_EMAIL: email distinto o sin sesión verificada", () => {
      expect(decidirAceptacion(invitacion(), datos({ emailAutenticado: OTRO_EMAIL }))).toEqual(
        error("INVITACION_DE_OTRO_EMAIL"),
      );
      expect(decidirAceptacion(invitacion(), datos({ emailAutenticado: null }))).toEqual(
        error("INVITACION_DE_OTRO_EMAIL"),
      );
    });

    it("PERSONA_SUSPENDIDA", () => {
      expect(
        decidirAceptacion(invitacion(), datos({ persona: { ...personaAna, activoGlobal: false } })),
      ).toEqual(error("PERSONA_SUSPENDIDA"));
    });

    it("EMPRESA_NO_OPERA informa la empresa y el motivo de cada estado efectivo", () => {
      const casos: [EstadoDeEmpresa, EstadoDeTenant, string][] = [
        ["PROVISIONING", "ACTIVE", "EMPRESA_EN_ALTA"],
        ["SUSPENDED", "ACTIVE", "EMPRESA_SUSPENDIDA"],
        ["CANCELLED", "ACTIVE", "EMPRESA_CANCELADA"],
        ["DELETING", "ACTIVE", "EMPRESA_EN_BAJA"],
        ["ACTIVE", "SUSPENDED", "TENANT_SUSPENDIDO"],
        ["SUSPENDED", "SUSPENDED", "TENANT_SUSPENDIDO"],
        ["CANCELLED", "SUSPENDED", "EMPRESA_CANCELADA"],
      ];
      for (const [empresa, tenant, motivo] of casos) {
        expect(
          decidirAceptacion(invitacion(), datos({ estados: estados([E1, empresa, tenant]) })),
        ).toEqual(error({ codigo: "EMPRESA_NO_OPERA", empresaId: E1, motivo }));
      }
    });

    it("YA_ES_MIEMBRO: miembro activo de alguna de las empresas", () => {
      const dos = invitacion({ empresas: [asignacion(E1), asignacion(E2)] });
      const ambas = estados([E1, "ACTIVE"], [E2, "ACTIVE"]);
      for (const miembro of [[E1], [E2], [E1, E2]]) {
        expect(
          decidirAceptacion(
            dos,
            datos({ persona: personaAna, estados: ambas, miembroActivoEn: new Set(miembro) }),
          ),
        ).toEqual(error("YA_ES_MIEMBRO"));
      }
    });
  });

  describe("ROL_DISTINTO_AL_ANTERIOR: reactivar con otro rol no se soporta", () => {
    const roles = (...filas: [EmpresaId, RolDeEmpresa][]) => new Map(filas);

    it("una membresía apagada con otro rol rechaza la aceptación e informa la empresa", () => {
      expect(
        decidirAceptacion(
          invitacion({ empresas: [asignacion(E1, "OPERADOR")] }),
          datos({ persona: personaAna, rolesAnteriores: roles([E1, "ADMINISTRADOR"]) }),
        ),
      ).toEqual(error({ codigo: "ROL_DISTINTO_AL_ANTERIOR", empresaId: E1 }));
    });

    it("cada rol anterior distinto del invitado falla (los seis cruces posibles)", () => {
      const todos: RolDeEmpresa[] = ["GERENTE", "ADMINISTRADOR", "OPERADOR"];
      for (const invitado of ["ADMINISTRADOR", "OPERADOR"] as const) {
        for (const anterior of todos) {
          const r = decidirAceptacion(
            invitacion({ empresas: [asignacion(E1, invitado)] }),
            datos({ persona: personaAna, rolesAnteriores: roles([E1, anterior]) }),
          );
          expect(r.ok, `${anterior} -> ${invitado}`).toBe(anterior === invitado);
        }
      }
    });

    it("el mismo rol que tenía se reactiva (ACEPTAR)", () => {
      expect(
        decidirAceptacion(
          invitacion({ empresas: [asignacion(E1, "ADMINISTRADOR")] }),
          datos({ persona: personaAna, rolesAnteriores: roles([E1, "ADMINISTRADOR"]) }),
        ),
      ).toEqual({ ok: true, valor: { tipo: "ACEPTAR" } });
    });

    it("sin membresía anterior en esa empresa, acepta con cualquier rol", () => {
      expect(
        decidirAceptacion(invitacion(), datos({ persona: personaAna, rolesAnteriores: roles() })),
      ).toEqual({ ok: true, valor: { tipo: "ACEPTAR" } });
    });

    it("los roles anteriores de empresas ajenas a la invitación no cuentan", () => {
      expect(
        decidirAceptacion(
          invitacion({ empresas: [asignacion(E1, "OPERADOR")] }),
          datos({ persona: personaAna, rolesAnteriores: roles([E2, "ADMINISTRADOR"]) }),
        ),
      ).toEqual({ ok: true, valor: { tipo: "ACEPTAR" } });
    });

    it("con varias empresas informa la PRIMERA (en el orden de la invitación) que no coincide", () => {
      const tres = invitacion({
        empresas: [asignacion(E1, "OPERADOR"), asignacion(E2, "OPERADOR"), asignacion(E3)],
      });
      const todas = estados([E1, "ACTIVE"], [E2, "ACTIVE"], [E3, "ACTIVE"]);
      // El mapa se arma en orden inverso a propósito.
      expect(
        decidirAceptacion(
          tres,
          datos({
            persona: personaAna,
            estados: todas,
            rolesAnteriores: roles([E3, "ADMINISTRADOR"], [E2, "ADMINISTRADOR"], [E1, "OPERADOR"]),
          }),
        ),
      ).toEqual(error({ codigo: "ROL_DISTINTO_AL_ANTERIOR", empresaId: E2 }));
      // Si la que no coincide es la última, también la encuentra.
      expect(
        decidirAceptacion(
          tres,
          datos({
            persona: personaAna,
            estados: todas,
            rolesAnteriores: roles([E1, "OPERADOR"], [E2, "OPERADOR"], [E3, "ADMINISTRADOR"]),
          }),
        ),
      ).toEqual(error({ codigo: "ROL_DISTINTO_AL_ANTERIOR", empresaId: E3 }));
    });

    it("9. es el último paso: YA_ES_MIEMBRO, EMPRESA_NO_OPERA y los anteriores le ganan", () => {
      const anterior = roles([E1, "ADMINISTRADOR"]);
      expect(
        decidirAceptacion(
          invitacion(),
          datos({ persona: personaAna, rolesAnteriores: anterior, miembroActivoEn: new Set([E1]) }),
        ),
      ).toEqual(error("YA_ES_MIEMBRO"));
      expect(
        decidirAceptacion(
          invitacion(),
          datos({
            persona: personaAna,
            rolesAnteriores: anterior,
            estados: estados([E1, "SUSPENDED"]),
          }),
        ),
      ).toEqual(error({ codigo: "EMPRESA_NO_OPERA", empresaId: E1, motivo: "EMPRESA_SUSPENDIDA" }));
      expect(
        decidirAceptacion(
          invitacion(),
          datos({ persona: { ...personaAna, activoGlobal: false }, rolesAnteriores: anterior }),
        ),
      ).toEqual(error("PERSONA_SUSPENDIDA"));
      expect(
        decidirAceptacion(
          invitacion(),
          datos({ persona: personaAna, rolesAnteriores: anterior, emailAutenticado: OTRO_EMAIL }),
        ),
      ).toEqual(error("INVITACION_DE_OTRO_EMAIL"));
    });

    it("una invitación ya aceptada por esta persona sigue siendo YA_ACEPTADA (no mira los roles)", () => {
      expect(
        decidirAceptacion(
          invitacion({ estado: "ACEPTADA", aceptadaPor: ANA }),
          datos({ persona: personaAna, rolesAnteriores: roles([E1, "ADMINISTRADOR"]) }),
        ),
      ).toEqual({ ok: true, valor: { tipo: "YA_ACEPTADA" } });
    });
  });

  describe("alta del gerente", () => {
    it("el tenant suspendido frena el alta: la empresa se evalúa como ya activa", () => {
      expect(
        decidirAceptacion(
          alta(),
          datos({ ahora: mas(T0, 1), estados: estados([E1, "PROVISIONING", "SUSPENDED"]) }),
        ),
      ).toEqual(error({ codigo: "EMPRESA_NO_OPERA", empresaId: E1, motivo: "TENANT_SUSPENDIDO" }));
    });

    it("repetir la aceptación del alta ya hecha es YA_ACEPTADA aunque la empresa ya esté ACTIVE", () => {
      const aceptada = alta({ estado: "ACEPTADA", aceptadaPor: ANA });
      expect(
        decidirAceptacion(
          aceptada,
          datos({ persona: personaAna, estados: estados([E1, "ACTIVE"]) }),
        ),
      ).toEqual({ ok: true, valor: { tipo: "YA_ACEPTADA" } });
      // También si después la empresa se suspendió o se canceló: no se escribe nada.
      expect(
        decidirAceptacion(
          aceptada,
          datos({ persona: personaAna, estados: estados([E1, "CANCELLED", "SUSPENDED"]) }),
        ),
      ).toEqual({ ok: true, valor: { tipo: "YA_ACEPTADA" } });
    });

    it("el alta aceptada por otra persona es INVITACION_NO_PENDIENTE", () => {
      expect(
        decidirAceptacion(
          alta({ estado: "ACEPTADA", aceptadaPor: BETO }),
          datos({ persona: personaAna, estados: estados([E1, "ACTIVE"]) }),
        ),
      ).toEqual(error("INVITACION_NO_PENDIENTE"));
    });
  });

  describe("todo o nada", () => {
    const tres = invitacion({
      empresas: [asignacion(E1), asignacion(E2), asignacion(E3, "ADMINISTRADOR")],
    });

    it("informa la PRIMERA empresa (en el orden de la invitación) que no opera", () => {
      expect(
        decidirAceptacion(
          tres,
          datos({ estados: estados([E1, "ACTIVE"], [E2, "SUSPENDED"], [E3, "CANCELLED"]) }),
        ),
      ).toEqual(error({ codigo: "EMPRESA_NO_OPERA", empresaId: E2, motivo: "EMPRESA_SUSPENDIDA" }));
      expect(
        decidirAceptacion(
          tres,
          datos({ estados: estados([E1, "ACTIVE"], [E2, "CANCELLED"], [E3, "SUSPENDED"]) }),
        ),
      ).toEqual(error({ codigo: "EMPRESA_NO_OPERA", empresaId: E2, motivo: "EMPRESA_CANCELADA" }));
      expect(
        decidirAceptacion(
          tres,
          datos({
            estados: estados([E1, "DELETING"], [E2, "ACTIVE"], [E3, "ACTIVE", "SUSPENDED"]),
          }),
        ),
      ).toEqual(error({ codigo: "EMPRESA_NO_OPERA", empresaId: E1, motivo: "EMPRESA_EN_BAJA" }));
    });

    it("el orden es el de la invitación, no el del mapa de estados", () => {
      expect(
        decidirAceptacion(
          tres,
          datos({ estados: estados([E3, "SUSPENDED"], [E2, "CANCELLED"], [E1, "ACTIVE"]) }),
        ),
      ).toEqual(error({ codigo: "EMPRESA_NO_OPERA", empresaId: E2, motivo: "EMPRESA_CANCELADA" }));
    });

    it("con una sola que falle, rechaza la invitación entera (la última también)", () => {
      expect(
        decidirAceptacion(
          tres,
          datos({ estados: estados([E1, "ACTIVE"], [E2, "ACTIVE"], [E3, "SUSPENDED"]) }),
        ),
      ).toEqual(error({ codigo: "EMPRESA_NO_OPERA", empresaId: E3, motivo: "EMPRESA_SUSPENDIDA" }));
    });

    it("con todas operando, acepta", () => {
      expect(
        decidirAceptacion(
          tres,
          datos({ estados: estados([E1, "ACTIVE"], [E2, "ACTIVE"], [E3, "ACTIVE"]) }),
        ),
      ).toEqual({ ok: true, valor: { tipo: "ACEPTAR" } });
    });

    it("las empresas ajenas a la invitación no cuentan", () => {
      expect(
        decidirAceptacion(
          invitacion(),
          datos({ estados: estados([E1, "ACTIVE"], [E2, "CANCELLED"]) }),
        ).ok,
      ).toBe(true);
    });
  });

  describe("precedencia: cuando se cumplen varias condiciones gana la primera", () => {
    const ahoraVencida = mas(T0, 8 * DIA);
    const empresaCaida = estados([E1, "SUSPENDED"]);
    const suspendida: Persona = { ...personaAna, activoGlobal: false };

    it("1. ALTA_NO_PENDIENTE le gana a todo lo demás (revocada, vencida, otro email...)", () => {
      const resultado = decidirAceptacion(
        alta({ estado: "REVOCADA" }),
        datos({
          ahora: mas(T0, 3 * DIA),
          emailAutenticado: OTRO_EMAIL,
          persona: suspendida,
          estados: estados([E1, "CANCELLED"]),
          miembroActivoEn: new Set([E1]),
        }),
      );
      expect(resultado).toEqual(error("ALTA_NO_PENDIENTE"));
      expect(
        decidirAceptacion(
          alta(),
          datos({
            ahora: mas(T0, 3 * DIA),
            emailAutenticado: OTRO_EMAIL,
            persona: suspendida,
            estados: estados([E1, "ACTIVE"]),
          }),
        ),
      ).toEqual(error("ALTA_NO_PENDIENTE"));
    });

    it("2. aceptada: gana sobre vencida, otro email, suspendida, empresa caída y miembro", () => {
      const aceptadaPorBeto = invitacion({ estado: "ACEPTADA", aceptadaPor: BETO });
      const todoMal = datos({
        ahora: ahoraVencida,
        emailAutenticado: OTRO_EMAIL,
        persona: suspendida,
        estados: empresaCaida,
        miembroActivoEn: new Set([E1]),
      });
      expect(decidirAceptacion(aceptadaPorBeto, todoMal)).toEqual(error("INVITACION_NO_PENDIENTE"));
      expect(
        decidirAceptacion(invitacion({ estado: "ACEPTADA", aceptadaPor: ANA }), todoMal),
      ).toEqual({ ok: true, valor: { tipo: "YA_ACEPTADA" } });
    });

    it("3. revocada gana sobre vencida, otro email, suspendida, empresa caída y miembro", () => {
      expect(
        decidirAceptacion(
          invitacion({ estado: "REVOCADA" }),
          datos({
            ahora: ahoraVencida,
            emailAutenticado: OTRO_EMAIL,
            persona: suspendida,
            estados: empresaCaida,
            miembroActivoEn: new Set([E1]),
          }),
        ),
      ).toEqual(error("INVITACION_REVOCADA"));
    });

    it("4. vencida gana sobre otro email, suspendida, empresa caída y miembro", () => {
      expect(
        decidirAceptacion(
          invitacion(),
          datos({
            ahora: ahoraVencida,
            emailAutenticado: OTRO_EMAIL,
            persona: suspendida,
            estados: empresaCaida,
            miembroActivoEn: new Set([E1]),
          }),
        ),
      ).toEqual(error("INVITACION_VENCIDA"));
    });

    it("5. otro email gana sobre suspendida, empresa caída y miembro", () => {
      expect(
        decidirAceptacion(
          invitacion(),
          datos({
            emailAutenticado: OTRO_EMAIL,
            persona: suspendida,
            estados: empresaCaida,
            miembroActivoEn: new Set([E1]),
          }),
        ),
      ).toEqual(error("INVITACION_DE_OTRO_EMAIL"));
    });

    it("6. persona suspendida gana sobre empresa caída y miembro", () => {
      expect(
        decidirAceptacion(
          invitacion(),
          datos({ persona: suspendida, estados: empresaCaida, miembroActivoEn: new Set([E1]) }),
        ),
      ).toEqual(error("PERSONA_SUSPENDIDA"));
    });

    it("7. empresa que no opera gana sobre ya es miembro", () => {
      expect(
        decidirAceptacion(
          invitacion(),
          datos({ persona: personaAna, estados: empresaCaida, miembroActivoEn: new Set([E1]) }),
        ),
      ).toEqual(error({ codigo: "EMPRESA_NO_OPERA", empresaId: E1, motivo: "EMPRESA_SUSPENDIDA" }));
    });

    it("sin sesión (email null) y vencida: gana vencida", () => {
      expect(
        decidirAceptacion(invitacion(), datos({ ahora: ahoraVencida, emailAutenticado: null })),
      ).toEqual(error("INVITACION_VENCIDA"));
    });
  });

  describe("faltan datos del llamador", () => {
    it("sin el estado de una empresa de la invitación, lanza en vez de aceptar a ciegas", () => {
      expect(() => decidirAceptacion(invitacion(), datos({ estados: estados() }))).toThrow(
        RangeError,
      );
      expect(() =>
        decidirAceptacion(
          invitacion({ empresas: [asignacion(E1), asignacion(E2)] }),
          datos({ estados: estados([E1, "ACTIVE"]) }),
        ),
      ).toThrow(RangeError);
      expect(() => decidirAceptacion(alta(), datos({ estados: estados() }))).toThrow(RangeError);
    });

    it("el error dice de cuál empresa faltan los datos", () => {
      expect(() =>
        decidirAceptacion(
          invitacion({ empresas: [asignacion(E1), asignacion(E2)] }),
          datos({ estados: estados([E1, "ACTIVE"]) }),
        ),
      ).toThrow("falta el estado de la empresa e-2");
    });

    it("pero no lo necesita para una invitación ya resuelta (revocada, aceptada, vencida...)", () => {
      const sinEstados = datos({ estados: estados() });
      expect(decidirAceptacion(invitacion({ estado: "REVOCADA" }), sinEstados)).toEqual(
        error("INVITACION_REVOCADA"),
      );
      expect(
        decidirAceptacion(invitacion({ estado: "ACEPTADA", aceptadaPor: ANA }), {
          ...sinEstados,
          persona: personaAna,
        }),
      ).toEqual({ ok: true, valor: { tipo: "YA_ACEPTADA" } });
      expect(
        decidirAceptacion(alta({ estado: "ACEPTADA", aceptadaPor: ANA }), {
          ...sinEstados,
          persona: personaAna,
        }),
      ).toEqual({
        ok: true,
        valor: { tipo: "YA_ACEPTADA" },
      });
    });
  });
});

describe("decidirReenvio", () => {
  const nueva = { id: invitacionId("inv-2"), tokenHash: "hash-2", emitidaPor: BETO };
  const ahora = mas(T0, 2 * DIA);

  it("una pendiente vigente se reenvía: nace otra con otro id y el plazo completo", () => {
    const origen = invitacion({
      empresas: [asignacion(E1, "ADMINISTRADOR"), asignacion(E2)],
    });
    expect(decidirReenvio(origen, ahora, nueva)).toEqual({
      ok: true,
      valor: {
        tipo: "REENVIAR",
        nueva: {
          id: nueva.id,
          tokenHash: "hash-2",
          tenantId: origen.tenantId,
          tipo: "USUARIO",
          email: EMAIL,
          emitidaPor: BETO,
          emitidaEn: ahora,
          venceEn: mas(ahora, 7 * DIA),
          empresas: origen.empresas,
        },
      },
    });
  });

  it("una pendiente vencida también se reenvía, aun en el instante exacto del vencimiento", () => {
    const origen = invitacion();
    for (const cuando of [origen.venceEn, mas(origen.venceEn, 1), mas(origen.venceEn, 30 * DIA)]) {
      const resultado = decidirReenvio(origen, cuando, nueva);
      expect(resultado.ok && resultado.valor.tipo).toBe("REENVIAR");
    }
  });

  it("ya reemplazada: devuelve la misma reemplazante, sin crear otra", () => {
    const reemplazante = invitacionId("inv-7");
    expect(
      decidirReenvio(
        invitacion({ estado: "REVOCADA", reemplazadaPor: reemplazante }),
        ahora,
        nueva,
      ),
    ).toEqual({ ok: true, valor: { tipo: "YA_REENVIADA", nueva: reemplazante } });
  });

  it("el alta del gerente no se reenvía (es de plataforma, H5), tenga o no reemplazo", () => {
    expect(decidirReenvio(alta(), ahora, nueva)).toEqual(error("REENVIO_NO_PERMITIDO"));
    expect(
      decidirReenvio(
        alta({ estado: "REVOCADA", reemplazadaPor: invitacionId("inv-7") }),
        ahora,
        nueva,
      ),
    ).toEqual(error("REENVIO_NO_PERMITIDO"));
  });

  it("una aceptada no se reenvía: INVITACION_NO_PENDIENTE", () => {
    expect(
      decidirReenvio(invitacion({ estado: "ACEPTADA", aceptadaPor: ANA }), ahora, nueva),
    ).toEqual(error("INVITACION_NO_PENDIENTE"));
  });

  it("una revocada sin reemplazo no se reenvía: INVITACION_REVOCADA", () => {
    expect(decidirReenvio(invitacion({ estado: "REVOCADA" }), ahora, nueva)).toEqual(
      error("INVITACION_REVOCADA"),
    );
  });

  it("si la de origen está mal formada, propaga el error de nuevaInvitacion", () => {
    expect(decidirReenvio(invitacion({ empresas: [] }), ahora, nueva)).toEqual(
      error("INVITACION_SIN_EMPRESAS"),
    );
    expect(
      decidirReenvio(invitacion({ empresas: [asignacion(E1, "GERENTE")] }), ahora, nueva),
    ).toEqual(error("ROL_NO_INVITABLE"));
  });
});

describe("decidirInvitacionDeUsuario", () => {
  const ahora = mas(T0, DIA);
  const vigente = invitacion({ venceEn: mas(T0, 7 * DIA) });
  const vencida = invitacion({ venceEn: ahora });

  it("sin pendiente se crea", () => {
    expect(decidirInvitacionDeUsuario({ ahora, esMiembroActivo: false, pendiente: null })).toEqual({
      ok: true,
      valor: { tipo: "CREAR" },
    });
  });

  it("con una pendiente vigente devuelve esa, sin crear otra", () => {
    expect(
      decidirInvitacionDeUsuario({ ahora, esMiembroActivo: false, pendiente: vigente }),
    ).toEqual({ ok: true, valor: { tipo: "YA_EXISTE", invitacion: vigente.id } });
  });

  it("el último milisegundo de vigencia todavía es vigente; el vencimiento exacto ya no", () => {
    const hasta = (ms: number) => invitacion({ venceEn: new Date(ahora.getTime() + ms) });
    expect(
      decidirInvitacionDeUsuario({ ahora, esMiembroActivo: false, pendiente: hasta(1) }),
    ).toEqual({ ok: true, valor: { tipo: "YA_EXISTE", invitacion: vigente.id } });
    expect(
      decidirInvitacionDeUsuario({ ahora, esMiembroActivo: false, pendiente: hasta(0) }),
    ).toEqual({ ok: true, valor: { tipo: "REEMPLAZAR_VENCIDA", vencida: vencida.id } });
  });

  it("con una pendiente vencida la reemplaza", () => {
    expect(
      decidirInvitacionDeUsuario({ ahora, esMiembroActivo: false, pendiente: vencida }),
    ).toEqual({ ok: true, valor: { tipo: "REEMPLAZAR_VENCIDA", vencida: vencida.id } });
  });

  it("YA_ES_MIEMBRO le gana a todo: sin pendiente, con vigente o con vencida", () => {
    for (const pendiente of [null, vigente, vencida]) {
      expect(decidirInvitacionDeUsuario({ ahora, esMiembroActivo: true, pendiente })).toEqual(
        error("YA_ES_MIEMBRO"),
      );
    }
  });

  it("una invitación que no está guardada como pendiente es un error del llamador", () => {
    for (const estado of ["ACEPTADA", "REVOCADA"] as const) {
      expect(() =>
        decidirInvitacionDeUsuario({
          ahora,
          esMiembroActivo: false,
          pendiente: invitacion({ estado }),
        }),
      ).toThrow(new RangeError(`la invitación ${invitacion().id} no está pendiente`));
    }
  });
});
