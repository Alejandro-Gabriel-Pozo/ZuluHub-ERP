import { describe, expect, it } from "vitest";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import { REGLAS_DE_PLATAFORMA } from "../../src/capacidades/permisos/plataforma";
import {
  OPERACION_EXPLICAR,
  armarExplicarPorQue,
  type EntradaDeExplicar,
  type TxDeExplicar,
} from "../../src/plataforma/casos-de-uso/explicar-por-que";
import type { Invitacion } from "../../src/modulos/identidad/publico";
import { empresaId, invitacionId, tenantId } from "../../src/primitivas/identificadores/marca";
import {
  AHORA,
  auditoriaFalsa,
  comoAdministrador,
  conRol,
  emailDePrueba,
  estadosDe,
  idempotenciaFalsa,
  lecturaFalsa,
  personaDePrueba,
  transaccionesDe,
  uuid,
  type DatosDeLecturaFalsa,
} from "./apoyo-de-soporte";

/**
 * «Explicar por qué» (H5 §B.5.9) sin base de datos: qué lee, qué escribe (SOLO la constancia de acceso
 * y la clave de idempotencia), qué devuelve y qué errores tiene. La fidelidad contra el guard y la
 * aceptación reales está en `fidelidad-de-explicar-por-que.test.ts`; la atomicidad, la idempotencia
 * contra Postgres y la concurrencia, en `test/integracion/soporte-*.test.ts`.
 */

const EMPRESA = empresaId(uuid(10));
const PERSONA = personaDePrueba(20, true, "ana@x.test");
const CLAVE = "clave-explicar-0001";

function armar(datos: DatosDeLecturaFalsa = {}, rol: "ADMIN" | "SOPORTE" | null = "SOPORTE") {
  const soporte = lecturaFalsa({
    estados: estadosDe([EMPRESA, "ACTIVE", "ACTIVE"]),
    personas: [PERSONA],
    ...datos,
  });
  const auditoria = auditoriaFalsa();
  const idempotencia = idempotenciaFalsa();
  const tx: TxDeExplicar = {
    soporte,
    autorizacionDePlataforma: conRol(rol),
    auditoriaDePlataforma: auditoria,
    idempotencia,
  };
  const transacciones = transaccionesDe(tx);
  const explicarPorQue = armarExplicarPorQue({
    transacciones,
    reglas: REGLAS_DE_PLATAFORMA,
    reglasDeEmpresa: REGLAS_DE_EMPRESA,
  });
  return { explicarPorQue, soporte, auditoria, idempotencia, transacciones };
}

const accion = (extra: Partial<Extract<EntradaDeExplicar["objetivo"], { tipo: "ACCION" }>> = {}) =>
  ({
    claveDeIdempotencia: CLAVE,
    objetivo: {
      tipo: "ACCION",
      empresaId: EMPRESA,
      persona: { por: "EMAIL", email: "ana@x.test" },
      accion: "sucursales.crear",
      ...extra,
    },
  }) satisfies EntradaDeExplicar;

const membresia = (rol: "GERENTE" | "ADMINISTRADOR" | "OPERADOR", activo = true) => ({
  empresaId: EMPRESA,
  personaId: PERSONA.id,
  rol,
  activo,
});

describe("explicar una acción", () => {
  it("pide la transacción SERIALIZABLE (la de por defecto), con el contexto", async () => {
    const { explicarPorQue, transacciones } = armar({ membresias: [membresia("GERENTE")] });
    await explicarPorQue(comoAdministrador, accion());
    expect(transacciones.pedidas).toEqual([{ contexto: comoAdministrador }]);
  });

  it("un gerente activo en una empresa que opera puede: la explicación, la constancia y la clave", async () => {
    const { explicarPorQue, auditoria, idempotencia } = armar({
      membresias: [membresia("GERENTE")],
    });
    const r = await explicarPorQue(comoAdministrador, accion());
    expect(r.ok).toBe(true);
    if (!r.ok || r.valor.tipo !== "ACCION") throw new Error("esperaba una acción explicada");
    expect(r.valor).toMatchObject({ tipo: "ACCION", empresaId: EMPRESA, personaId: PERSONA.id });
    expect(r.valor.explicacion).toMatchObject({
      accion: "sucursales.crear",
      rol: "GERENTE",
      razonDelRol: "CON_ROL",
      estadoEfectivo: "OPERA",
      guard: { ok: true, valor: null },
      opera: { ok: true, valor: null },
      decision: { ok: true, valor: null },
    });
    // La ÚNICA constancia: sobre la empresa, con la persona, la acción y el resultado. Sin `antes`.
    expect(auditoria.registros).toEqual([
      {
        accion: "SOPORTE_EXPLICAR",
        entidad: "empresa",
        entidadId: EMPRESA,
        despues: {
          objetivo: "ACCION",
          accion: "sucursales.crear",
          personaId: PERSONA.id,
          resultado: "PERMITIDA",
        },
      },
    ]);
    expect([...idempotencia.guardadas.keys()]).toEqual([CLAVE]);
    expect(idempotencia.guardadas.get(CLAVE)).toMatchObject({
      operacion: OPERACION_EXPLICAR,
      resultado: JSON.parse(JSON.stringify(r.valor)) as unknown,
    });
  });

  it("la operación de idempotencia cumple la forma que la tabla exige", () => {
    expect(OPERACION_EXPLICAR).toBe("soporte.explicar");
    expect(OPERACION_EXPLICAR).toMatch(/^[a-z_.]+$/);
  });

  it("el rechazo del guard de la empresa es parte de lo explicado (no un error del caso)", async () => {
    const { explicarPorQue, auditoria } = armar({ membresias: [membresia("OPERADOR")] });
    const r = await explicarPorQue(comoAdministrador, accion());
    expect(r.ok && r.valor.tipo === "ACCION" && r.valor.explicacion.decision).toEqual({
      ok: false,
      error: "SIN_PERMISO",
    });
    expect(auditoria.registros[0]?.despues).toMatchObject({ resultado: "SIN_PERMISO" });
  });

  it("una empresa que no opera se asienta como EMPRESA_NO_OPERA", async () => {
    const { explicarPorQue, auditoria } = armar({
      membresias: [membresia("GERENTE")],
      estados: estadosDe([EMPRESA, "ACTIVE", "SUSPENDED"]),
    });
    const r = await explicarPorQue(comoAdministrador, accion());
    expect(r.ok && r.valor.tipo === "ACCION" && r.valor.explicacion.estadoEfectivo).toBe(
      "TENANT_SUSPENDIDO",
    );
    expect(auditoria.registros[0]?.despues).toMatchObject({ resultado: "EMPRESA_NO_OPERA" });
  });

  it("sin membresía, con la membresía apagada o con la persona suspendida no hay rol", async () => {
    const casos: Array<[DatosDeLecturaFalsa, string]> = [
      [{}, "SIN_MEMBRESIA"],
      [{ membresias: [membresia("GERENTE", false)] }, "MEMBRESIA_APAGADA"],
      [
        {
          membresias: [membresia("GERENTE")],
          personas: [personaDePrueba(20, false, "ana@x.test")],
        },
        "PERSONA_SUSPENDIDA",
      ],
    ];
    for (const [datos, razon] of casos) {
      const { explicarPorQue } = armar(datos);
      const r = await explicarPorQue(comoAdministrador, accion());
      expect(r.ok && r.valor.tipo === "ACCION" && r.valor.explicacion).toMatchObject({
        rol: null,
        razonDelRol: razon,
      });
    }
  });

  it("una persona que no existe es parte de lo explicado, y la constancia lo dice con personaId null", async () => {
    const { explicarPorQue, auditoria } = armar({ personas: [] });
    const r = await explicarPorQue(comoAdministrador, accion());
    expect(r.ok && r.valor.tipo === "ACCION" && r.valor).toMatchObject({ personaId: null });
    expect(r.ok && r.valor.tipo === "ACCION" && r.valor.explicacion.razonDelRol).toBe(
      "PERSONA_INEXISTENTE",
    );
    expect(auditoria.registros[0]?.despues).toMatchObject({ personaId: null });
  });

  it("también se puede pedir por el id de la persona (el que trae una referencia de error)", async () => {
    const { explicarPorQue, soporte } = armar({ membresias: [membresia("ADMINISTRADOR")] });
    const r = await explicarPorQue(
      comoAdministrador,
      accion({ persona: { por: "ID", personaId: PERSONA.id.toUpperCase() } }),
    );
    expect(r.ok && r.valor.tipo === "ACCION" && r.valor.explicacion.rol).toBe("ADMINISTRADOR");
    expect(soporte.pedidos.map((p) => p.metodo)).toContain("personaPorId");
    expect(soporte.pedidos.map((p) => p.metodo)).not.toContain("personaPorEmail");
    expect(soporte.pedidos.find((p) => p.metodo === "personaPorId")?.argumentos).toEqual([
      PERSONA.id,
    ]);
  });

  it("normaliza el email y los ids antes de leer, y lee solo la membresía de ESA empresa", async () => {
    const { explicarPorQue, soporte } = armar({ membresias: [membresia("GERENTE")] });
    await explicarPorQue(
      comoAdministrador,
      accion({
        empresaId: EMPRESA.toUpperCase(),
        persona: { por: "EMAIL", email: "  ANA@X.test " },
      }),
    );
    expect(soporte.pedidos).toEqual([
      { metodo: "estadosDeEmpresas", argumentos: [[EMPRESA]] },
      { metodo: "personaPorEmail", argumentos: ["ana@x.test"] },
      { metodo: "membresiasDe", argumentos: [PERSONA.id, [EMPRESA]] },
      { metodo: "modulosActivadosDe", argumentos: [EMPRESA] },
    ]);
  });

  it("los módulos activados salen de la lectura", async () => {
    const { explicarPorQue } = armar({
      membresias: [membresia("GERENTE")],
      modulosActivados: ["otro"],
    });
    const r = await explicarPorQue(comoAdministrador, accion());
    expect(r.ok).toBe(true);
  });

  it("la constancia no lleva el email de nadie", async () => {
    const { explicarPorQue, auditoria } = armar({ membresias: [membresia("GERENTE")] });
    await explicarPorQue(comoAdministrador, accion());
    expect(JSON.stringify(auditoria.registros)).not.toContain("@");
    expect(JSON.stringify(auditoria.registros)).not.toMatch(/token|hash|clave/i);
  });

  it("una empresa que no existe es un error, y no deja constancia ni clave", async () => {
    const { explicarPorQue, auditoria, idempotencia } = armar({ estados: new Map() });
    expect(await explicarPorQue(comoAdministrador, accion())).toEqual({
      ok: false,
      error: "EMPRESA_NO_ENCONTRADA",
    });
    expect(auditoria.registros).toEqual([]);
    expect(idempotencia.guardadas.size).toBe(0);
  });
});

describe("explicar: la entrada", () => {
  const sinEscribir = async (entrada: EntradaDeExplicar, error: string) => {
    const { explicarPorQue, auditoria, idempotencia, soporte } = armar();
    expect(await explicarPorQue(comoAdministrador, entrada), error).toEqual({ ok: false, error });
    expect(auditoria.registros).toEqual([]);
    expect(idempotencia.guardadas.size).toBe(0);
    expect(soporte.pedidos).toEqual([]);
  };

  it("la clave de idempotencia tiene que tener la forma de la tabla", async () => {
    for (const clave of ["", "corta", "a".repeat(15), "a".repeat(129), "con espacios 12345678"]) {
      await sinEscribir(
        { ...accion(), claveDeIdempotencia: clave },
        "CLAVE_DE_IDEMPOTENCIA_INVALIDA",
      );
    }
  });

  it("los ids, el email y la acción se validan", async () => {
    await sinEscribir(accion({ empresaId: "e-1" }), "ID_INVALIDO");
    await sinEscribir(accion({ persona: { por: "ID", personaId: "p-1" } }), "ID_INVALIDO");
    await sinEscribir(accion({ persona: { por: "EMAIL", email: "sin-arroba" } }), "EMAIL_INVALIDO");
    await sinEscribir(accion({ accion: "no.existe" }), "ACCION_DESCONOCIDA");
    await sinEscribir(accion({ accion: "constructor" }), "ACCION_DESCONOCIDA");
    await sinEscribir(accion({ accion: "__proto__" }), "ACCION_DESCONOCIDA");
    await sinEscribir(accion({ accion: "" }), "ACCION_DESCONOCIDA");
    await sinEscribir(
      { claveDeIdempotencia: CLAVE, objetivo: { tipo: "ACEPTACION", invitacionId: "i-1" } },
      "ID_INVALIDO",
    );
  });

  it("la acción tiene que ser del catálogo de la empresa, no de la plataforma", async () => {
    await sinEscribir(accion({ accion: "empresas.alta" }), "ACCION_DESCONOCIDA");
  });
});

describe("explicar: idempotencia", () => {
  it("repetir el pedido con la misma clave devuelve lo mismo, sin leer ni dejar otra constancia", async () => {
    const { explicarPorQue, auditoria, idempotencia, soporte } = armar({
      membresias: [membresia("GERENTE")],
    });
    const primera = await explicarPorQue(comoAdministrador, accion());
    const lecturas = soporte.pedidos.length;
    const segunda = await explicarPorQue(comoAdministrador, accion());
    expect(segunda).toEqual(primera);
    expect(soporte.pedidos).toHaveLength(lecturas);
    expect(auditoria.registros).toHaveLength(1);
    expect(idempotencia.guardadas.size).toBe(1);
  });

  it("el mismo pedido escrito distinto (mayúsculas, espacios) es el mismo pedido", async () => {
    const { explicarPorQue, auditoria } = armar({ membresias: [membresia("GERENTE")] });
    await explicarPorQue(comoAdministrador, accion());
    const otra = await explicarPorQue(
      comoAdministrador,
      accion({
        empresaId: EMPRESA.toUpperCase(),
        persona: { por: "EMAIL", email: " ANA@X.TEST " },
      }),
    );
    expect(otra.ok).toBe(true);
    expect(auditoria.registros).toHaveLength(1);
  });

  it("la misma clave con OTRO pedido es CLAVE_REUTILIZADA y no escribe nada nuevo", async () => {
    const { explicarPorQue, auditoria, idempotencia } = armar({
      membresias: [membresia("GERENTE")],
    });
    await explicarPorQue(comoAdministrador, accion());
    expect(await explicarPorQue(comoAdministrador, accion({ accion: "sucursales.ver" }))).toEqual({
      ok: false,
      error: "CLAVE_REUTILIZADA",
    });
    expect(
      await explicarPorQue(
        comoAdministrador,
        accion({ persona: { por: "ID", personaId: PERSONA.id } }),
      ),
    ).toEqual({
      ok: false,
      error: "CLAVE_REUTILIZADA",
    });
    expect(auditoria.registros).toHaveLength(1);
    expect(idempotencia.guardadas.size).toBe(1);
  });

  it("otra clave es otro pedido: nueva constancia", async () => {
    const { explicarPorQue, auditoria } = armar({ membresias: [membresia("GERENTE")] });
    await explicarPorQue(comoAdministrador, accion());
    await explicarPorQue(comoAdministrador, {
      ...accion(),
      claveDeIdempotencia: "otra-clave-0000002",
    });
    expect(auditoria.registros).toHaveLength(2);
  });
});

// ---- aceptación -------------------------------------------------------------------------------

const INVITACION: Invitacion = {
  id: invitacionId(uuid(30)),
  tenantId: tenantId(uuid(31)),
  tipo: "USUARIO",
  email: emailDePrueba("ana@x.test"),
  estado: "PENDIENTE",
  emitidaEn: new Date(AHORA.getTime() - 3_600_000),
  venceEn: new Date(AHORA.getTime() + 3_600_000),
  empresas: [{ empresaId: EMPRESA, rol: "OPERADOR", sucursales: [] }],
  aceptadaPor: null,
  reemplazadaPor: null,
  version: 1,
};

const aceptacion = (id: string = INVITACION.id): EntradaDeExplicar => ({
  claveDeIdempotencia: CLAVE,
  objetivo: { tipo: "ACEPTACION", invitacionId: id },
});

describe("explicar una aceptación", () => {
  it("una invitación pendiente de alguien sin cuenta se aceptaría; deja constancia sobre la invitación", async () => {
    const { explicarPorQue, auditoria, soporte } = armar({
      invitaciones: [INVITACION],
      personas: [],
    });
    const r = await explicarPorQue(comoAdministrador, aceptacion(INVITACION.id.toUpperCase()));
    expect(r).toEqual({
      ok: true,
      valor: {
        tipo: "ACEPTACION",
        invitacionId: INVITACION.id,
        explicacion: {
          estadoDeLaInvitacion: "PENDIENTE",
          decision: { ok: true, valor: { tipo: "ACEPTAR" } },
          supuestos: ["EMAIL_AUTENTICADO_ES_EL_DE_LA_INVITACION"],
        },
      },
    });
    expect(auditoria.registros).toEqual([
      {
        accion: "SOPORTE_EXPLICAR",
        entidad: "invitacion",
        entidadId: INVITACION.id,
        despues: { objetivo: "ACEPTACION", resultado: "ACEPTAR" },
      },
    ]);
    expect(soporte.pedidos).toEqual([
      { metodo: "invitacionPorId", argumentos: [INVITACION.id] },
      { metodo: "personaPorEmail", argumentos: ["ana@x.test"] },
      { metodo: "estadosDeEmpresas", argumentos: [[EMPRESA]] },
    ]);
  });

  it("una invitación que no existe es un error y no deja nada", async () => {
    const { explicarPorQue, auditoria, idempotencia } = armar();
    expect(await explicarPorQue(comoAdministrador, aceptacion(uuid(99)))).toEqual({
      ok: false,
      error: "INVITACION_NO_ENCONTRADA",
    });
    expect(auditoria.registros).toEqual([]);
    expect(idempotencia.guardadas.size).toBe(0);
  });

  it("explica los rechazos con los hechos de la persona y sus membresías", async () => {
    const resultado = async (datos: DatosDeLecturaFalsa, invitacion: Invitacion = INVITACION) => {
      const { explicarPorQue, auditoria } = armar({ invitaciones: [invitacion], ...datos });
      const r = await explicarPorQue(comoAdministrador, aceptacion(invitacion.id));
      expect(r.ok).toBe(true);
      return { r, asentado: auditoria.registros[0]?.despues };
    };
    const vencida = { ...INVITACION, venceEn: new Date(AHORA.getTime() - 1) };
    expect((await resultado({}, vencida)).asentado).toMatchObject({
      resultado: "INVITACION_VENCIDA",
    });
    expect((await resultado({}, { ...INVITACION, estado: "REVOCADA" })).asentado).toMatchObject({
      resultado: "INVITACION_REVOCADA",
    });
    expect(
      (await resultado({ personas: [personaDePrueba(20, false, "ana@x.test")] })).asentado,
    ).toMatchObject({ resultado: "PERSONA_SUSPENDIDA" });
    expect((await resultado({ membresias: [membresia("OPERADOR")] })).asentado).toMatchObject({
      resultado: "YA_ES_MIEMBRO",
    });
    expect(
      (await resultado({ membresias: [membresia("ADMINISTRADOR", false)] })).asentado,
    ).toMatchObject({ resultado: "ROL_DISTINTO_AL_ANTERIOR" });
    expect(
      (await resultado({ membresias: [membresia("OPERADOR", false)] })).asentado,
    ).toMatchObject({
      resultado: "ACEPTAR",
    });
    expect(
      (await resultado({ estados: estadosDe([EMPRESA, "SUSPENDED", "ACTIVE"]) })).asentado,
    ).toMatchObject({ resultado: "EMPRESA_NO_OPERA" });
  });

  it("repetirla con la misma clave devuelve lo mismo y deja una sola constancia", async () => {
    const { explicarPorQue, auditoria, soporte } = armar({ invitaciones: [INVITACION] });
    const primera = await explicarPorQue(comoAdministrador, aceptacion());
    const lecturas = soporte.pedidos.length;
    expect(await explicarPorQue(comoAdministrador, aceptacion())).toEqual(primera);
    expect(soporte.pedidos).toHaveLength(lecturas);
    expect(auditoria.registros).toHaveLength(1);
  });

  it("la misma clave para una acción y para una aceptación es CLAVE_REUTILIZADA", async () => {
    const { explicarPorQue } = armar({
      invitaciones: [INVITACION],
      membresias: [membresia("GERENTE")],
    });
    await explicarPorQue(comoAdministrador, accion());
    expect(await explicarPorQue(comoAdministrador, aceptacion())).toEqual({
      ok: false,
      error: "CLAVE_REUTILIZADA",
    });
  });

  it("la persona y las membresías de la invitación se leen con SU email y SUS empresas", async () => {
    const dos: Invitacion = {
      ...INVITACION,
      empresas: [
        { empresaId: EMPRESA, rol: "OPERADOR", sucursales: [] },
        { empresaId: empresaId(uuid(11)), rol: "OPERADOR", sucursales: [] },
      ],
    };
    const { explicarPorQue, soporte } = armar({
      invitaciones: [dos],
      estados: estadosDe([EMPRESA, "ACTIVE", "ACTIVE"], [empresaId(uuid(11)), "ACTIVE", "ACTIVE"]),
    });
    await explicarPorQue(comoAdministrador, aceptacion());
    expect(soporte.pedidos.find((p) => p.metodo === "membresiasDe")?.argumentos).toEqual([
      PERSONA.id,
      [EMPRESA, empresaId(uuid(11))],
    ]);
  });
});
