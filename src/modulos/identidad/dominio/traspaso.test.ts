import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { empresaId, personaId, type PersonaId } from "../../../primitivas/identificadores/marca";
import "../../../../test/propiedades/configuracion";
import type { Email } from "./email";
import type { Membresia, Persona, RolDeEmpresa } from "./membresia";
import {
  PLAZO_DEL_TRASPASO_EN_MS,
  TRANSICIONES_DE_TRASPASO,
  decidirAceptacionDeTraspaso,
  decidirCancelacion,
  decidirPropuesta,
  decidirRechazo,
  estadoDeTraspaso,
  vencimientoDeTraspaso,
  type EstadoGuardadoDeTraspaso,
  type OrigenDeTraspaso,
  type Traspaso,
} from "./traspaso";

const EMPRESA = empresaId("e-1");
const GERENTE = personaId("p-gerente");
const ENTRANTE = personaId("p-entrante");
const OTRA = personaId("p-otra");

const T0 = Date.UTC(2026, 9, 12, 12, 0, 0);
const DOS_DIAS = 2 * 24 * 3_600_000;
const ahora = new Date(T0);
const venceEn = new Date(T0 + DOS_DIAS);

const membresia = (
  persona: PersonaId,
  rol: RolDeEmpresa,
  activo = true,
  empresa = EMPRESA,
): Membresia => ({ empresaId: empresa, personaId: persona, rol, activo, version: 1 });

const persona = (id: PersonaId, activoGlobal = true): Persona => ({
  id,
  email: `${id}@x.com` as Email,
  activoGlobal,
});

const traspaso = (cambios: Partial<Traspaso> = {}): Traspaso => ({
  id: "t-1",
  empresaId: EMPRESA,
  origen: "GERENTE",
  salientePersonaId: GERENTE,
  entrantePersonaId: ENTRANTE,
  estado: "PROPUESTO",
  venceEn,
  version: 1,
  ...cambios,
});

const gerente = membresia(GERENTE, "GERENTE");
const entrante = membresia(ENTRANTE, "ADMINISTRADOR");
const personaDelEntrante = persona(ENTRANTE);
const ESTADOS: readonly EstadoGuardadoDeTraspaso[] = [
  "PROPUESTO",
  "ACEPTADO",
  "RECHAZADO",
  "CANCELADO",
];

const enCursoVigente = traspaso();
const enCursoVencido = traspaso({ venceEn: new Date(T0 - 1) });

describe("plazo, vencimiento y estado calculado", () => {
  it("la propuesta vence a los 7 días", () => {
    expect(PLAZO_DEL_TRASPASO_EN_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(vencimientoDeTraspaso(ahora)).toEqual(new Date(T0 + 604_800_000));
  });

  it("las transiciones permitidas salen solo de PROPUESTO", () => {
    expect(TRANSICIONES_DE_TRASPASO).toEqual({
      PROPUESTO: ["ACEPTADO", "RECHAZADO", "CANCELADO"],
      ACEPTADO: [],
      RECHAZADO: [],
      CANCELADO: [],
    });
  });

  it("un propuesto vence justo en venceEn (ahora >= venceEn)", () => {
    expect(estadoDeTraspaso(traspaso(), new Date(venceEn.getTime() - 1))).toBe("PROPUESTO");
    expect(estadoDeTraspaso(traspaso(), venceEn)).toBe("VENCIDO");
    expect(estadoDeTraspaso(traspaso(), new Date(venceEn.getTime() + 1))).toBe("VENCIDO");
  });

  it("lo ya resuelto conserva su estado, aunque haya pasado el vencimiento", () => {
    const tarde = new Date(venceEn.getTime() + DOS_DIAS);
    for (const estado of ["ACEPTADO", "RECHAZADO", "CANCELADO"] as const) {
      expect(estadoDeTraspaso(traspaso({ estado }), tarde)).toBe(estado);
      expect(estadoDeTraspaso(traspaso({ estado }), ahora)).toBe(estado);
    }
  });
});

describe("decidirPropuesta", () => {
  const proponer = (
    enCurso: Traspaso | null,
    miembro: Membresia | null = entrante,
    sujeto: Persona | null = personaDelEntrante,
    actor: PersonaId | null = GERENTE,
    cuando = ahora,
  ) => decidirPropuesta(enCurso, miembro, sujeto, actor, cuando);

  it("sin propuesta en curso y con un miembro activo, propone", () => {
    expect(proponer(null)).toEqual({ ok: true, valor: "PROPONER" });
    expect(proponer(null, membresia(ENTRANTE, "OPERADOR"))).toEqual({
      ok: true,
      valor: "PROPONER",
    });
  });

  it("a alguien que no es miembro no se le propone: primero se lo invita", () => {
    expect(proponer(null, null)).toEqual({ ok: false, error: "ENTRANTE_NO_ES_MIEMBRO" });
    expect(proponer(null, null, null)).toEqual({ ok: false, error: "ENTRANTE_NO_ES_MIEMBRO" });
    expect(proponer(enCursoVigente, null)).toEqual({
      ok: false,
      error: "ENTRANTE_NO_ES_MIEMBRO",
    });
  });

  it("con la membresía apagada, la persona suspendida o sin persona, es ENTRANTE_INACTIVO", () => {
    const inactivo = { ok: false, error: "ENTRANTE_INACTIVO" };
    expect(proponer(null, membresia(ENTRANTE, "ADMINISTRADOR", false))).toEqual(inactivo);
    expect(proponer(null, entrante, persona(ENTRANTE, false))).toEqual(inactivo);
    expect(proponer(null, entrante, null)).toEqual(inactivo);
    expect(
      proponer(null, membresia(ENTRANTE, "ADMINISTRADOR", false), persona(ENTRANTE, false)),
    ).toEqual(inactivo);
  });

  it("no se propone al gerente ni a uno mismo", () => {
    const esGerente = { ok: false, error: "ENTRANTE_ES_EL_GERENTE" };
    expect(proponer(null, gerente, persona(GERENTE))).toEqual(esGerente);
    // La plataforma (actor null) tampoco puede proponerle la gerencia al gerente.
    expect(proponer(null, gerente, persona(GERENTE), null)).toEqual(esGerente);
    // Uno mismo, aunque la membresía no diga GERENTE (dato incoherente: igual se rechaza).
    expect(proponer(null, entrante, personaDelEntrante, ENTRANTE)).toEqual(esGerente);
  });

  it("el orden de los errores: miembro, inactivo, gerente, propuesta en curso", () => {
    const gerenteApagado = membresia(GERENTE, "GERENTE", false);
    expect(proponer(enCursoVigente, gerenteApagado, persona(GERENTE))).toEqual({
      ok: false,
      error: "ENTRANTE_INACTIVO",
    });
    expect(proponer(enCursoVigente, gerente, persona(GERENTE))).toEqual({
      ok: false,
      error: "ENTRANTE_ES_EL_GERENTE",
    });
  });

  it("con una propuesta vigente al mismo entrante devuelve esa (idempotente)", () => {
    expect(proponer(enCursoVigente)).toEqual({ ok: true, valor: "YA_EXISTIA" });
    // Hasta un instante antes del vencimiento sigue vigente.
    expect(
      proponer(
        enCursoVigente,
        entrante,
        personaDelEntrante,
        GERENTE,
        new Date(venceEn.getTime() - 1),
      ),
    ).toEqual({
      ok: true,
      valor: "YA_EXISTIA",
    });
  });

  it("con una propuesta vigente a otro entrante es TRASPASO_EN_CURSO", () => {
    const otro = membresia(OTRA, "OPERADOR");
    expect(proponer(enCursoVigente, otro, persona(OTRA))).toEqual({
      ok: false,
      error: "TRASPASO_EN_CURSO",
    });
  });

  it("una propuesta vencida se cancela y se propone de nuevo (al mismo entrante o a otro)", () => {
    const vencida = { ok: true, valor: "CANCELAR_VENCIDO_Y_PROPONER" };
    expect(proponer(enCursoVencido)).toEqual(vencida);
    expect(proponer(enCursoVencido, membresia(OTRA, "OPERADOR"), persona(OTRA))).toEqual(vencida);
    // Justo en el vencimiento ya está vencida.
    expect(proponer(enCursoVigente, entrante, personaDelEntrante, GERENTE, venceEn)).toEqual(
      vencida,
    );
  });

  it("la propuesta de la plataforma (actor null) sigue las mismas reglas", () => {
    expect(proponer(null, entrante, personaDelEntrante, null)).toEqual({
      ok: true,
      valor: "PROPONER",
    });
  });

  it("un en curso que no está propuesto es un error del llamador y lanza", () => {
    for (const estado of ["ACEPTADO", "RECHAZADO", "CANCELADO"] as const) {
      expect(() => proponer(traspaso({ estado }))).toThrow(RangeError);
      expect(() => proponer(traspaso({ estado }))).toThrow("el traspaso t-1 no está propuesto");
    }
  });
});

describe("decidirAceptacionDeTraspaso", () => {
  const aceptar = (
    t: Traspaso | null,
    actor: PersonaId = ENTRANTE,
    vigente: Membresia | null = gerente,
    miembro: Membresia | null = entrante,
    cuando = ahora,
  ) => decidirAceptacionDeTraspaso(t, actor, vigente, miembro, cuando);

  it("el entrante acepta una propuesta vigente con el saliente todavía gerente", () => {
    expect(aceptar(enCursoVigente)).toEqual({ ok: true, valor: "ACEPTAR" });
    expect(aceptar(enCursoVigente, ENTRANTE, gerente, membresia(ENTRANTE, "OPERADOR"))).toEqual({
      ok: true,
      valor: "ACEPTAR",
    });
    // Hasta un instante antes del vencimiento.
    expect(
      aceptar(enCursoVigente, ENTRANTE, gerente, entrante, new Date(venceEn.getTime() - 1)),
    ).toEqual({
      ok: true,
      valor: "ACEPTAR",
    });
  });

  it("un traspaso que no existe es TRASPASO_NO_ENCONTRADO", () => {
    expect(aceptar(null)).toEqual({ ok: false, error: "TRASPASO_NO_ENCONTRADO" });
  });

  it("solo lo acepta el entrante, en cualquier estado (antes de revelar el estado)", () => {
    const noEsParaVos = { ok: false, error: "TRASPASO_NO_ES_PARA_VOS" };
    for (const estado of ESTADOS) {
      expect(aceptar(traspaso({ estado }), OTRA)).toEqual(noEsParaVos);
      expect(aceptar(traspaso({ estado }), GERENTE)).toEqual(noEsParaVos);
    }
    expect(aceptar(enCursoVencido, OTRA)).toEqual(noEsParaVos);
  });

  it("repetir la aceptación es ok y no escribe (YA_ACEPTADO), aun vencido el plazo y cambiado el gerente", () => {
    const aceptado = traspaso({ estado: "ACEPTADO" });
    const yaAceptado = { ok: true, valor: "YA_ACEPTADO" };
    expect(aceptar(aceptado)).toEqual(yaAceptado);
    expect(
      aceptar(
        aceptado,
        ENTRANTE,
        membresia(ENTRANTE, "GERENTE"),
        membresia(ENTRANTE, "GERENTE"),
        new Date(venceEn.getTime() + DOS_DIAS),
      ),
    ).toEqual(yaAceptado);
    expect(aceptar(aceptado, ENTRANTE, null, null)).toEqual(yaAceptado);
  });

  it("aceptar lo rechazado o cancelado es TRASPASO_RESUELTO", () => {
    expect(aceptar(traspaso({ estado: "RECHAZADO" }))).toEqual({
      ok: false,
      error: "TRASPASO_RESUELTO",
    });
    expect(aceptar(traspaso({ estado: "CANCELADO" }))).toEqual({
      ok: false,
      error: "TRASPASO_RESUELTO",
    });
  });

  it("vencido (ahora >= venceEn) es TRASPASO_VENCIDO, también justo en el vencimiento", () => {
    expect(aceptar(enCursoVencido)).toEqual({ ok: false, error: "TRASPASO_VENCIDO" });
    expect(aceptar(enCursoVigente, ENTRANTE, gerente, entrante, venceEn)).toEqual({
      ok: false,
      error: "TRASPASO_VENCIDO",
    });
  });

  it("con origen GERENTE, si el gerente cambió o no hay gerente, es SALIENTE_YA_NO_ES_GERENTE", () => {
    const cambio = { ok: false, error: "SALIENTE_YA_NO_ES_GERENTE" };
    expect(aceptar(enCursoVigente, ENTRANTE, membresia(OTRA, "GERENTE"))).toEqual(cambio);
    expect(aceptar(enCursoVigente, ENTRANTE, null)).toEqual(cambio);
  });

  it("con origen PLATAFORMA el saliente es el gerente vigente, sea quien sea", () => {
    const deLaPlataforma = traspaso({ origen: "PLATAFORMA", salientePersonaId: null });
    expect(aceptar(deLaPlataforma)).toEqual({ ok: true, valor: "ACEPTAR" });
    expect(aceptar(deLaPlataforma, ENTRANTE, membresia(OTRA, "GERENTE"))).toEqual({
      ok: true,
      valor: "ACEPTAR",
    });
    // Sin gerente no hay quién traspase.
    expect(aceptar(deLaPlataforma, ENTRANTE, null)).toEqual({
      ok: false,
      error: "SALIENTE_YA_NO_ES_GERENTE",
    });
  });

  it("un entrante inexistente o apagado es ENTRANTE_INACTIVO", () => {
    const inactivo = { ok: false, error: "ENTRANTE_INACTIVO" };
    expect(aceptar(enCursoVigente, ENTRANTE, gerente, null)).toEqual(inactivo);
    expect(
      aceptar(enCursoVigente, ENTRANTE, gerente, membresia(ENTRANTE, "ADMINISTRADOR", false)),
    ).toEqual(inactivo);
  });

  it("un entrante que ya es gerente es ENTRANTE_ES_EL_GERENTE", () => {
    const deLaPlataforma = traspaso({ origen: "PLATAFORMA", salientePersonaId: null });
    expect(
      aceptar(
        deLaPlataforma,
        ENTRANTE,
        membresia(ENTRANTE, "GERENTE"),
        membresia(ENTRANTE, "GERENTE"),
      ),
    ).toEqual({ ok: false, error: "ENTRANTE_ES_EL_GERENTE" });
  });

  it("el orden de los errores: vencido, saliente, entrante inactivo, entrante gerente", () => {
    // Vencido gana sobre el saliente cambiado y el entrante apagado.
    expect(aceptar(enCursoVencido, ENTRANTE, null, null)).toEqual({
      ok: false,
      error: "TRASPASO_VENCIDO",
    });
    // El saliente cambiado gana sobre el entrante apagado.
    expect(aceptar(enCursoVigente, ENTRANTE, null, null)).toEqual({
      ok: false,
      error: "SALIENTE_YA_NO_ES_GERENTE",
    });
    // El entrante apagado gana sobre el entrante gerente.
    expect(
      aceptar(enCursoVigente, ENTRANTE, gerente, membresia(ENTRANTE, "GERENTE", false)),
    ).toEqual({
      ok: false,
      error: "ENTRANTE_INACTIVO",
    });
  });
});

describe("decidirRechazo", () => {
  it("el entrante rechaza una propuesta vigente", () => {
    expect(decidirRechazo(enCursoVigente, ENTRANTE, ahora)).toEqual({
      ok: true,
      valor: "RECHAZAR",
    });
    expect(decidirRechazo(enCursoVigente, ENTRANTE, new Date(venceEn.getTime() - 1))).toEqual({
      ok: true,
      valor: "RECHAZAR",
    });
  });

  it("un traspaso que no existe es TRASPASO_NO_ENCONTRADO", () => {
    expect(decidirRechazo(null, ENTRANTE, ahora)).toEqual({
      ok: false,
      error: "TRASPASO_NO_ENCONTRADO",
    });
  });

  it("solo lo rechaza el entrante, en cualquier estado", () => {
    for (const estado of ESTADOS) {
      expect(decidirRechazo(traspaso({ estado }), OTRA, ahora)).toEqual({
        ok: false,
        error: "TRASPASO_NO_ES_PARA_VOS",
      });
      expect(decidirRechazo(traspaso({ estado }), GERENTE, ahora)).toEqual({
        ok: false,
        error: "TRASPASO_NO_ES_PARA_VOS",
      });
    }
  });

  it("repetir el rechazo es ok y no escribe (YA_RECHAZADO), aun vencido el plazo", () => {
    const rechazado = traspaso({ estado: "RECHAZADO" });
    expect(decidirRechazo(rechazado, ENTRANTE, ahora)).toEqual({ ok: true, valor: "YA_RECHAZADO" });
    expect(decidirRechazo(rechazado, ENTRANTE, new Date(venceEn.getTime() + DOS_DIAS))).toEqual({
      ok: true,
      valor: "YA_RECHAZADO",
    });
  });

  it("rechazar lo aceptado o cancelado es TRASPASO_RESUELTO", () => {
    for (const estado of ["ACEPTADO", "CANCELADO"] as const) {
      expect(decidirRechazo(traspaso({ estado }), ENTRANTE, ahora)).toEqual({
        ok: false,
        error: "TRASPASO_RESUELTO",
      });
    }
  });

  it("vencido (ahora >= venceEn) es TRASPASO_VENCIDO, también justo en el vencimiento", () => {
    expect(decidirRechazo(enCursoVencido, ENTRANTE, ahora)).toEqual({
      ok: false,
      error: "TRASPASO_VENCIDO",
    });
    expect(decidirRechazo(enCursoVigente, ENTRANTE, venceEn)).toEqual({
      ok: false,
      error: "TRASPASO_VENCIDO",
    });
  });
});

describe("decidirCancelacion", () => {
  it("cancela una propuesta vigente", () => {
    expect(decidirCancelacion(enCursoVigente, ahora)).toEqual({ ok: true, valor: "CANCELAR" });
    expect(decidirCancelacion(enCursoVigente, new Date(venceEn.getTime() - 1))).toEqual({
      ok: true,
      valor: "CANCELAR",
    });
  });

  it("cancela también una vencida que sigue guardada como propuesta", () => {
    expect(decidirCancelacion(enCursoVencido, ahora)).toEqual({ ok: true, valor: "CANCELAR" });
    expect(decidirCancelacion(enCursoVigente, venceEn)).toEqual({ ok: true, valor: "CANCELAR" });
  });

  it("sin propuesta, o ya cancelada, no hay nada que hacer (idempotente)", () => {
    expect(decidirCancelacion(null, ahora)).toEqual({ ok: true, valor: "YA_NO_HABIA" });
    const cancelado = traspaso({ estado: "CANCELADO" });
    expect(decidirCancelacion(cancelado, ahora)).toEqual({ ok: true, valor: "YA_NO_HABIA" });
    expect(decidirCancelacion(cancelado, new Date(venceEn.getTime() + DOS_DIAS))).toEqual({
      ok: true,
      valor: "YA_NO_HABIA",
    });
  });

  it("cancelar lo aceptado o rechazado es TRASPASO_RESUELTO", () => {
    for (const estado of ["ACEPTADO", "RECHAZADO"] as const) {
      expect(decidirCancelacion(traspaso({ estado }), ahora)).toEqual({
        ok: false,
        error: "TRASPASO_RESUELTO",
      });
    }
  });
});

describe("propiedades del traspaso", () => {
  const instante = fc.integer({ min: 0, max: 4_000_000_000_000 });
  const estadoGuardado = fc.constantFrom<EstadoGuardadoDeTraspaso>(...ESTADOS);
  const origen = fc.constantFrom<OrigenDeTraspaso>("GERENTE", "PLATAFORMA");
  const rol = fc.constantFrom<RolDeEmpresa>("GERENTE", "ADMINISTRADOR", "OPERADOR");
  const personas = ["p-a", "p-b", "p-c", "p-d"].map(personaId);
  const unaPersona = fc.constantFrom(...personas);

  /** Una empresa con exactamente un gerente activo y miembros activos o apagados. */
  const miembroSinGerencia = fc.record({
    rol: fc.constantFrom<RolDeEmpresa>("ADMINISTRADOR", "OPERADOR"),
    activo: fc.boolean(),
  });
  const empresa = fc
    .record({
      gerente: unaPersona,
      resto: fc.tuple(miembroSinGerencia, miembroSinGerencia, miembroSinGerencia),
    })
    .map(({ gerente: quien, resto }) => [
      membresia(quien, "GERENTE"),
      ...personas
        .filter((p) => p !== quien)
        .map((p, n) => membresia(p, resto[n]?.rol ?? "OPERADOR", resto[n]?.activo ?? true)),
    ]);

  const escenario = fc.record({
    miembros: empresa,
    entrante: unaPersona,
    origen,
    estado: estadoGuardado,
    emitido: instante,
    duracion: fc.integer({ min: 1, max: 1_000_000 }),
    desfase: fc.integer({ min: -2_000_000, max: 2_000_000 }),
    actorEsElEntrante: fc.boolean(),
    otroGerente: fc.boolean(),
  });

  /** Aplica el traspaso aceptado: el saliente baja a administrador y el entrante pasa a gerente. */
  function aplicarAceptacion(
    miembros: readonly Membresia[],
    saliente: PersonaId,
    quien: PersonaId,
  ) {
    return miembros.map((m) =>
      m.personaId === saliente
        ? { ...m, rol: "ADMINISTRADOR" as const }
        : m.personaId === quien
          ? { ...m, rol: "GERENTE" as const }
          : m,
    );
  }

  it("un traspaso aceptado deja exactamente un gerente activo (el entrante)", () => {
    fc.assert(
      fc.property(escenario, (e) => {
        const vigente = e.miembros.find((m) => m.rol === "GERENTE") as Membresia;
        const miembroEntrante = e.miembros.find((m) => m.personaId === e.entrante) ?? null;
        const t = traspaso({
          origen: e.origen,
          salientePersonaId:
            e.origen === "GERENTE" ? (e.otroGerente ? OTRA : vigente.personaId) : null,
          entrantePersonaId: e.entrante,
          estado: e.estado,
          venceEn: new Date(e.emitido + e.duracion),
        });
        const cuando = new Date(e.emitido + e.duracion + e.desfase);
        const actor = e.actorEsElEntrante ? e.entrante : OTRA;
        const r = decidirAceptacionDeTraspaso(t, actor, vigente, miembroEntrante, cuando);
        if (!r.ok || r.valor !== "ACEPTAR") return;
        const despues = aplicarAceptacion(e.miembros, vigente.personaId, e.entrante);
        const gerentes = despues.filter((m) => m.activo && m.rol === "GERENTE");
        expect(gerentes.map((m) => m.personaId)).toEqual([e.entrante]);
        // Ambos activos, el saliente no es el entrante y nadie más cambió de rol.
        expect(vigente.personaId).not.toBe(e.entrante);
        expect((miembroEntrante as Membresia).activo).toBe(true);
        expect(despues.filter((m, n) => m.rol !== (e.miembros[n] as Membresia).rol)).toHaveLength(
          2,
        );
      }),
    );
  });

  it("acepta exactamente cuando se cumplen todas las condiciones (sin falsos rechazos)", () => {
    fc.assert(
      fc.property(escenario, (e) => {
        const vigente = e.miembros.find((m) => m.rol === "GERENTE") as Membresia;
        const miembroEntrante = e.miembros.find((m) => m.personaId === e.entrante) ?? null;
        const t = traspaso({
          origen: e.origen,
          salientePersonaId:
            e.origen === "GERENTE" ? (e.otroGerente ? OTRA : vigente.personaId) : null,
          entrantePersonaId: e.entrante,
          estado: e.estado,
          venceEn: new Date(e.emitido + e.duracion),
        });
        const cuando = new Date(e.emitido + e.duracion + e.desfase);
        const actor = e.actorEsElEntrante ? e.entrante : OTRA;
        const r = decidirAceptacionDeTraspaso(t, actor, vigente, miembroEntrante, cuando);
        const aceptaria =
          e.actorEsElEntrante &&
          e.estado === "PROPUESTO" &&
          e.desfase < 0 &&
          !(e.origen === "GERENTE" && e.otroGerente) &&
          miembroEntrante !== null &&
          miembroEntrante.activo &&
          miembroEntrante.rol !== "GERENTE";
        expect(r.ok && r.valor === "ACEPTAR").toBe(aceptaria);
      }),
    );
  });

  it("lo que dicen las decisiones respeta las transiciones permitidas", () => {
    fc.assert(
      fc.property(escenario, (e) => {
        const vigente = e.miembros.find((m) => m.rol === "GERENTE") as Membresia;
        const miembroEntrante = e.miembros.find((m) => m.personaId === e.entrante) ?? null;
        const t = traspaso({
          salientePersonaId: vigente.personaId,
          entrantePersonaId: e.entrante,
          estado: e.estado,
          venceEn: new Date(e.emitido + e.duracion),
        });
        const cuando = new Date(e.emitido + e.duracion + e.desfase);
        const permitido = (a: EstadoGuardadoDeTraspaso) =>
          TRANSICIONES_DE_TRASPASO[e.estado].includes(a);
        const aceptacion = decidirAceptacionDeTraspaso(
          t,
          e.entrante,
          vigente,
          miembroEntrante,
          cuando,
        );
        if (aceptacion.ok && aceptacion.valor === "ACEPTAR")
          expect(permitido("ACEPTADO")).toBe(true);
        const rechazo = decidirRechazo(t, e.entrante, cuando);
        if (rechazo.ok && rechazo.valor === "RECHAZAR") expect(permitido("RECHAZADO")).toBe(true);
        const cancelacion = decidirCancelacion(t, cuando);
        if (cancelacion.ok && cancelacion.valor === "CANCELAR")
          expect(permitido("CANCELADO")).toBe(true);
      }),
    );
  });

  it("repetir una resolución da el mismo resultado exitoso y nunca un error", () => {
    fc.assert(
      fc.property(escenario, instante, (e, tarde) => {
        const vigente = e.miembros.find((m) => m.rol === "GERENTE") as Membresia;
        const miembroEntrante = e.miembros.find((m) => m.personaId === e.entrante) ?? null;
        const base = {
          salientePersonaId: vigente.personaId,
          entrantePersonaId: e.entrante,
          venceEn: new Date(e.emitido + e.duracion),
        };
        const cuando = new Date(tarde);
        expect(
          decidirAceptacionDeTraspaso(
            traspaso({ ...base, estado: "ACEPTADO" }),
            e.entrante,
            vigente,
            miembroEntrante,
            cuando,
          ),
        ).toEqual({ ok: true, valor: "YA_ACEPTADO" });
        expect(
          decidirRechazo(traspaso({ ...base, estado: "RECHAZADO" }), e.entrante, cuando),
        ).toEqual({
          ok: true,
          valor: "YA_RECHAZADO",
        });
        expect(decidirCancelacion(traspaso({ ...base, estado: "CANCELADO" }), cuando)).toEqual({
          ok: true,
          valor: "YA_NO_HABIA",
        });
      }),
    );
  });

  it("una vez resuelto o vencido, lo que dice estadoDeTraspaso no vuelve atrás con el tiempo", () => {
    fc.assert(
      fc.property(
        estadoGuardado,
        instante,
        fc.integer({ min: 1, max: 1_000_000 }),
        instante,
        fc.nat(5_000_000),
        (estado, emitido, duracion, cuando, despues) => {
          const t = traspaso({ estado, venceEn: new Date(emitido + duracion) });
          const antes = estadoDeTraspaso(t, new Date(cuando));
          const luego = estadoDeTraspaso(t, new Date(cuando + despues));
          if (antes === "VENCIDO") expect(luego).toBe("VENCIDO");
          if (estado !== "PROPUESTO") {
            expect(antes).toBe(estado);
            expect(luego).toBe(estado);
          } else {
            expect(antes).toBe(cuando >= emitido + duracion ? "VENCIDO" : "PROPUESTO");
          }
        },
      ),
    );
  });

  it("el vencimiento de una propuesta es exactamente el plazo después de proponerla", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 8_000_000_000_000_000 }), (ms) => {
        expect(vencimientoDeTraspaso(new Date(ms)).getTime() - ms).toBe(PLAZO_DEL_TRASPASO_EN_MS);
      }),
    );
  });

  it("propuesta: nunca se propone a quien no es un miembro activo y no gerente", () => {
    fc.assert(
      fc.property(
        fc.option(rol, { nil: null }),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        (rolDelEntrante, activo, activoGlobal, hayPersona) => {
          const miembro =
            rolDelEntrante === null ? null : membresia(ENTRANTE, rolDelEntrante, activo);
          const r = decidirPropuesta(
            null,
            miembro,
            hayPersona ? persona(ENTRANTE, activoGlobal) : null,
            GERENTE,
            ahora,
          );
          const debePoderse =
            miembro !== null &&
            activo &&
            hayPersona &&
            activoGlobal &&
            rolDelEntrante !== "GERENTE";
          expect(r.ok).toBe(debePoderse);
        },
      ),
    );
  });
});
