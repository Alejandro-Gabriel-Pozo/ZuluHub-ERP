import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { crearTokensHmac } from "../../src/adaptadores/tokens/tokens-hmac";
import {
  emailDesdeTexto,
  nuevaInvitacion,
  type Email,
  type Invitacion,
} from "../../src/modulos/identidad/publico";
import {
  empresaId,
  invitacionId,
  personaId,
  sucursalId,
  type PersonaId,
} from "../../src/primitivas/identificadores/marca";
import { ok } from "../../src/primitivas/resultado/resultado";
import {
  AHORA_DE_PRUEBA,
  comoEmpresa,
  comoInvitacion,
  comoPlataforma,
  crearBaseAparte,
  crearEmpresaActiva,
  crearEntornoDePrueba,
  type EmpresaDePrueba,
} from "./entorno";
import {
  aceptarDeBase,
  crearAsignacionDeBase,
  crearInvitacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
  emailAlAzar,
  incluirEmpresa,
  revocarDeBase,
  sucursalDe,
} from "./fixtures-identidad";

/**
 * Los repositorios de identidad y los adaptadores de trabajos y auditoría contra una base real: las
 * condiciones de estado y de versión de cada `UPDATE`, el alta sin `RETURNING`, la clave de
 * idempotencia de la cola y la guarda de secretos.
 */

const base = inject("baseDePruebas");
const ahora = AHORA_DE_PRUEBA;

const email = (texto: string): Email => {
  const r = emailDesdeTexto(texto);
  if (!r.ok) throw new Error("email inválido en la prueba");
  return r.valor;
};

describe.skipIf(base === null)("identidad: repositorios y adaptadores contra una base real", () => {
  // Base propia de este archivo: SERIALIZABLE aborta por falsos positivos cuando OTROS archivos de
  // prueba, en paralelo, escriben las mismas tablas (los bloqueos de lectura son por página o tabla).
  // Aislarla hace que los reintentos que se ven acá sean solo los de la concurrencia que se prueba.
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entorno: ReturnType<typeof crearEntornoDePrueba>;
  let dueno: pg.Client;
  const tokens = crearTokensHmac(randomBytes(32));

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDePrueba(propia.base, 8);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  const filas = async (texto: string, parametros: unknown[] = []) =>
    (await dueno.query<Record<string, unknown>>(texto, parametros)).rows;

  type Escenario = EmpresaDePrueba & { actor: PersonaId; sucursal: string };
  const escenario = async (): Promise<Escenario> => {
    const e = await crearEmpresaActiva(entorno);
    const g = await crearPersonaDeBase(dueno);
    await crearMembresiaDeBase(dueno, e.empresa, g.id, "GERENTE");
    return { ...e, actor: personaId(g.id), sucursal: await sucursalDe(dueno, e.empresa) };
  };

  const pendiente = async (e: Escenario, correo = emailAlAzar()) => {
    const inv = await crearInvitacionDeBase(dueno, { tenant: e.tenant, email: correo });
    await incluirEmpresa(dueno, inv, e.empresa, "OPERADOR", [e.sucursal]);
    return inv;
  };

  describe("las actualizaciones condicionadas por estado y versión", () => {
    it("revocar: solo con la versión esperada y solo desde PENDIENTE", async () => {
      const e = await escenario();
      const inv = await pendiente(e);
      const ctx = comoEmpresa(e.empresa, e.actor);
      const revocar = (version: number) =>
        entorno.ejecutar({ contexto: ctx }, async (tx) =>
          ok(await tx.invitaciones.revocar(invitacionId(inv.id), version, ahora, "prueba")),
        );
      expect(await revocar(99)).toEqual({ ok: true, valor: false });
      expect((await filas("select estado from invitacion where id = $1", [inv.id]))[0]).toEqual({
        estado: "PENDIENTE",
      });
      expect(await revocar(1)).toEqual({ ok: true, valor: true });
      // Ya revocada: ni con la versión nueva se revoca de nuevo.
      const version = (await filas("select version from invitacion where id = $1", [inv.id]))[0]?.[
        "version"
      ] as number;
      expect(version).toBe(2);
      expect(await revocar(version)).toEqual({ ok: true, valor: false });
    });

    it("marcarAceptada: solo con la versión esperada y solo desde PENDIENTE", async () => {
      const e = await escenario();
      const inv = await pendiente(e);
      const persona = await crearPersonaDeBase(dueno, inv.email);
      const aceptar = (version: number) =>
        entorno.ejecutar({ contexto: comoInvitacion(inv.tokenHash) }, async (tx) =>
          ok(
            await tx.invitaciones.marcarAceptada(
              invitacionId(inv.id),
              version,
              personaId(persona.id),
              ahora,
            ),
          ),
        );
      expect(await aceptar(7)).toEqual({ ok: true, valor: false });
      expect((await filas("select estado from invitacion where id = $1", [inv.id]))[0]).toEqual({
        estado: "PENDIENTE",
      });
      expect(await aceptar(1)).toEqual({ ok: true, valor: true });
      expect(await aceptar(2)).toEqual({ ok: true, valor: false });
      expect(
        (await filas("select estado, aceptada_por from invitacion where id = $1", [inv.id]))[0],
      ).toEqual({
        estado: "ACEPTADA",
        aceptada_por: persona.id,
      });
    });

    it("vincularReemplazo: solo sobre una REVOCADA que todavía no tiene reemplazo", async () => {
      const e = await escenario();
      const vieja = await pendiente(e);
      const nueva = await crearInvitacionDeBase(dueno, { tenant: e.tenant, email: emailAlAzar() });
      await incluirEmpresa(dueno, nueva, e.empresa, "OPERADOR");
      const vincular = () =>
        entorno.ejecutar({ contexto: comoEmpresa(e.empresa, e.actor) }, async (tx) =>
          ok(
            await tx.invitaciones.vincularReemplazo(invitacionId(vieja.id), invitacionId(nueva.id)),
          ),
        );
      // PENDIENTE: no se vincula.
      expect(await vincular()).toEqual({ ok: true, valor: false });
      await revocarDeBase(dueno, vieja);
      expect(await vincular()).toEqual({ ok: true, valor: true });
      // Ya tiene reemplazo: no se pisa.
      expect(await vincular()).toEqual({ ok: true, valor: false });
      expect(
        (await filas("select reemplazada_por from invitacion where id = $1", [vieja.id]))[0],
      ).toEqual({
        reemplazada_por: nueva.id,
      });
    });

    it("membresía: reactivar solo si está apagada y apagar solo si está activa, siempre con la versión", async () => {
      const e = await escenario();
      const p = await crearPersonaDeBase(dueno);
      await crearMembresiaDeBase(dueno, e.empresa, p.id, "OPERADOR", false);
      const persona = personaId(p.id);
      const ctx = comoEmpresa(e.empresa, e.actor);
      const apagar = (v: number) =>
        entorno.ejecutar({ contexto: ctx }, async (tx) =>
          ok(await tx.membresias.apagar(e.empresa, persona, v)),
        );
      // Apagada: no se apaga de nuevo.
      expect(await apagar(1)).toEqual({ ok: true, valor: false });

      // Reactivarla es cosa del invitado (con una invitación aceptada que incluya la empresa).
      const inv = await pendiente(e, p.email);
      await aceptarDeBase(dueno, inv, p.id);
      const reactivar = (v: number) =>
        entorno.ejecutar({ contexto: comoInvitacion(inv.tokenHash) }, async (tx) =>
          ok(await tx.membresias.reactivar(e.empresa, persona, v)),
        );
      expect(await reactivar(9)).toEqual({ ok: true, valor: false });
      expect(await reactivar(1)).toEqual({ ok: true, valor: true });
      expect(await reactivar(2)).toEqual({ ok: true, valor: false });
      expect(await apagar(5)).toEqual({ ok: true, valor: false });
      expect(await apagar(2)).toEqual({ ok: true, valor: true });
    });

    it("asignaciones: reactivar con la versión; apagarTodas cuenta solo las activas", async () => {
      const e = await escenario();
      const p = await crearPersonaDeBase(dueno);
      await crearMembresiaDeBase(dueno, e.empresa, p.id, "OPERADOR");
      const otra = (
        await filas("insert into sucursal (empresa_id, nombre) values ($1, 'Otra') returning id", [
          e.empresa,
        ])
      )[0]?.["id"] as string;
      await crearAsignacionDeBase(dueno, e.empresa, p.id, e.sucursal, true);
      await crearAsignacionDeBase(dueno, e.empresa, p.id, otra, false);
      const persona = personaId(p.id);
      const ctx = comoEmpresa(e.empresa, e.actor);
      const apagarTodas = () =>
        entorno.ejecutar({ contexto: ctx }, async (tx) =>
          ok(await tx.asignaciones.apagarTodas(e.empresa, persona)),
        );
      expect(await apagarTodas()).toEqual({ ok: true, valor: 1 });
      expect(await apagarTodas()).toEqual({ ok: true, valor: 0 });

      const inv = await pendiente(e, p.email);
      await aceptarDeBase(dueno, inv, p.id);
      const reactivar = (v: number) =>
        entorno.ejecutar({ contexto: comoInvitacion(inv.tokenHash) }, async (tx) =>
          ok(await tx.asignaciones.reactivar(e.empresa, persona, sucursalId(e.sucursal), v)),
        );
      expect(await reactivar(1)).toEqual({ ok: true, valor: false }); // versión vieja: ya subió al apagarla
      expect(await reactivar(2)).toEqual({ ok: true, valor: true });
      expect(await reactivar(3)).toEqual({ ok: true, valor: false });
    });
  });

  describe("lecturas", () => {
    it("obtenerPorHash arma la invitación con sus empresas y sucursales en orden estable", async () => {
      const e1 = await escenario();
      const e2 = await crearEmpresaActiva(entorno, { tenant: e1.tenant });
      const inv = await crearInvitacionDeBase(dueno, { tenant: e1.tenant });
      await incluirEmpresa(dueno, inv, e1.empresa, "ADMINISTRADOR", [e1.sucursal]);
      await incluirEmpresa(dueno, inv, e2.empresa, "OPERADOR");
      const leida = await entorno.ejecutar(
        { contexto: comoInvitacion(inv.tokenHash) },
        async (tx) => ok(await tx.invitaciones.obtenerPorHash(inv.tokenHash)),
      );
      expect(leida.ok).toBe(true);
      const invitacion = (leida.ok ? leida.valor : null) as Invitacion;
      expect(invitacion).toMatchObject({
        id: inv.id,
        tenantId: e1.tenant,
        tipo: "USUARIO",
        estado: "PENDIENTE",
        aceptadaPor: null,
        reemplazadaPor: null,
        version: 1,
      });
      expect(invitacion.empresas.map((x) => x.empresaId)).toEqual([e1.empresa, e2.empresa].sort());
      expect(invitacion.empresas.find((x) => x.empresaId === e1.empresa)).toMatchObject({
        rol: "ADMINISTRADOR",
        sucursales: [e1.sucursal],
      });
      expect(invitacion.empresas.find((x) => x.empresaId === e2.empresa)).toMatchObject({
        rol: "OPERADOR",
        sucursales: [],
      });
      // Un hash que no existe no encuentra nada.
      const nada = await entorno.ejecutar({ contexto: comoInvitacion(inv.tokenHash) }, async (tx) =>
        ok(await tx.invitaciones.obtenerPorHash("0".repeat(64))),
      );
      expect(nada).toEqual({ ok: true, valor: null });
    });

    it("el contexto operativo ve de una invitación solo la parte de su empresa", async () => {
      const e1 = await escenario();
      const e2 = await crearEmpresaActiva(entorno, { tenant: e1.tenant });
      const inv = await crearInvitacionDeBase(dueno, { tenant: e1.tenant });
      await incluirEmpresa(dueno, inv, e1.empresa, "OPERADOR");
      await incluirEmpresa(dueno, inv, e2.empresa, "OPERADOR");
      const leida = await entorno.ejecutar(
        { contexto: comoEmpresa(e1.empresa, e1.actor) },
        async (tx) => ok(await tx.invitaciones.obtenerPorId(invitacionId(inv.id))),
      );
      const invitacion = (leida.ok ? leida.valor : null) as Invitacion;
      expect(invitacion.empresas.map((x) => x.empresaId)).toEqual([e1.empresa]);
    });

    it("pendientesDeEmail: solo las PENDIENTES de ese email que incluyen la empresa", async () => {
      const e = await escenario();
      const otra = await escenario();
      const correo = emailAlAzar("pend");
      const revocada = await crearInvitacionDeBase(dueno, { tenant: e.tenant, email: correo });
      await incluirEmpresa(dueno, revocada, e.empresa, "OPERADOR");
      await revocarDeBase(dueno, revocada);
      const viva = await pendiente(e, correo);
      await pendiente(e, emailAlAzar("otro-email"));
      await pendiente(otra, correo);
      const lista = await entorno.ejecutar(
        { contexto: comoEmpresa(e.empresa, e.actor) },
        async (tx) =>
          ok((await tx.invitaciones.pendientesDeEmail(e.empresa, email(correo))).map((i) => i.id)),
      );
      expect(lista).toEqual({ ok: true, valor: [viva.id] });
    });
  });

  describe("el alta de una invitación (sin RETURNING) y sus restricciones", () => {
    const emitirEnPlataforma = async (
      e: EmpresaDePrueba,
      correo: string,
      rol: "GERENTE" | "OPERADOR",
      tipo: "ALTA_GERENTE" | "USUARIO",
    ) => {
      const emitido = tokens.emitir();
      const nueva = nuevaInvitacion(
        {
          id: emitido.invitacionId,
          tokenHash: emitido.tokenHash,
          tenantId: e.tenant,
          tipo,
          email: email(correo),
          empresas: [{ empresaId: empresaId(e.empresa), rol, sucursales: [] }],
          emitidaPor: null,
        },
        ahora,
      );
      if (!nueva.ok) throw new Error("invitación inválida");
      return entorno.ejecutar({ contexto: comoPlataforma() }, async (tx) => {
        await tx.invitaciones.crear(nueva.valor);
        return ok(nueva.valor.id);
      });
    };

    it("una persona que ya existe con ese email no se duplica: persona_email_uk sale como Unicidad tipada", async () => {
      const e = await escenario();
      const inv = await pendiente(e);
      const existente = await crearPersonaDeBase(dueno, inv.email);
      expect(existente.email).toBe(inv.email);
      const r = await entorno.ejecutar({ contexto: comoInvitacion(inv.tokenHash) }, async (tx) =>
        ok(await tx.personas.crear(email(inv.email))),
      );
      expect(r).toEqual({
        ok: false,
        error: { tipo: "Unicidad", restriccion: "persona_email_uk" },
      });
    });

    it("un invitado solo puede crear la persona de SU email", async () => {
      const e = await escenario();
      const inv = await pendiente(e);
      const r = await entorno.ejecutar({ contexto: comoInvitacion(inv.tokenHash) }, async (tx) =>
        ok(await tx.personas.crear(email(emailAlAzar("ajeno")))),
      );
      expect(r).toEqual({ ok: false, error: { tipo: "AccesoDenegado" } });
    });

    it("dos invitaciones pendientes al mismo email y empresa: la segunda es Unicidad invitacion_empresa_pendiente_uk", async () => {
      const e = await escenario();
      const correo = emailAlAzar("dup");
      expect((await emitirEnPlataforma(e, correo, "OPERADOR", "USUARIO")).ok).toBe(true);
      const segunda = await emitirEnPlataforma(e, correo, "OPERADOR", "USUARIO");
      expect(segunda).toEqual({
        ok: false,
        error: { tipo: "Unicidad", restriccion: "invitacion_empresa_pendiente_uk" },
      });
    });

    it("una sucursal de otra empresa es Referencia invitacion_sucursal_sucursal_fkey", async () => {
      const e = await escenario();
      const otra = await escenario();
      const emitido = tokens.emitir();
      const nueva = nuevaInvitacion(
        {
          id: emitido.invitacionId,
          tokenHash: emitido.tokenHash,
          tenantId: e.tenant,
          tipo: "USUARIO",
          email: email(emailAlAzar()),
          empresas: [
            {
              empresaId: empresaId(e.empresa),
              rol: "OPERADOR",
              sucursales: [sucursalId(otra.sucursal)],
            },
          ],
          emitidaPor: e.actor,
        },
        ahora,
      );
      if (!nueva.ok) throw new Error("invitación inválida");
      const r = await entorno.ejecutar(
        { contexto: comoEmpresa(e.empresa, e.actor) },
        async (tx) => {
          await tx.invitaciones.crear(nueva.valor);
          return ok(null);
        },
      );
      expect(r).toEqual({
        ok: false,
        error: { tipo: "Referencia", restriccion: "invitacion_sucursal_sucursal_fkey" },
      });
      expect(
        await filas("select id from invitacion where id = $1", [emitido.invitacionId]),
      ).toEqual([]);
    });
  });

  describe("puerto trabajos (cola)", () => {
    const encolar = (
      empresa: string | null,
      clave: string,
      datos: Record<string, string> = { invitacionId: "x" },
    ) =>
      entorno.ejecutar(
        { contexto: empresa === null ? comoPlataforma() : comoEmpresa(empresaId(empresa), null) },
        async (tx) =>
          ok(
            await tx.trabajos.encolar({
              empresaId: empresa === null ? null : empresaId(empresa),
              tipo: "enviar_invitacion",
              datos,
              claveDeIdempotencia: clave,
            }),
          ),
      );

    it("encolar dos veces la misma clave deja una sola fila (la segunda es YA_ENCOLADO)", async () => {
      const e = await escenario();
      expect(await encolar(e.empresa, "clave-1")).toEqual({ ok: true, valor: "ENCOLADO" });
      expect(await encolar(e.empresa, "clave-1", { invitacionId: "otro dato" })).toEqual({
        ok: true,
        valor: "YA_ENCOLADO",
      });
      expect(await encolar(e.empresa, "clave-2")).toEqual({ ok: true, valor: "ENCOLADO" });
      const trabajos = await filas(
        "select clave_idempotencia, datos from trabajo where empresa_id = $1 order by clave_idempotencia",
        [e.empresa],
      );
      // La segunda con la misma clave NO pisó los datos de la primera.
      expect(trabajos).toEqual([
        { clave_idempotencia: "clave-1", datos: { invitacionId: "x" } },
        { clave_idempotencia: "clave-2", datos: { invitacionId: "x" } },
      ]);
    });

    it("la misma clave en dos empresas distintas son dos trabajos; en el ámbito plataforma, uno solo", async () => {
      const a = await escenario();
      const b = await escenario();
      expect(await encolar(a.empresa, "compartida")).toEqual({ ok: true, valor: "ENCOLADO" });
      expect(await encolar(b.empresa, "compartida")).toEqual({ ok: true, valor: "ENCOLADO" });
      const clave = `plataforma-${randomBytes(4).toString("hex")}`;
      expect(await encolar(null, clave)).toEqual({ ok: true, valor: "ENCOLADO" });
      expect(await encolar(null, clave)).toEqual({ ok: true, valor: "YA_ENCOLADO" });
    });

    it("dos encolados simultáneos de la misma clave: uno solo gana, sin error", async () => {
      const e = await escenario();
      const resultados = await Promise.all(
        Array.from({ length: 4 }, () => encolar(e.empresa, "carrera")),
      );
      expect(resultados.every((r) => r.ok)).toBe(true);
      expect(resultados.filter((r) => r.ok && r.valor === "ENCOLADO")).toHaveLength(1);
      expect(await filas("select id from trabajo where empresa_id = $1", [e.empresa])).toHaveLength(
        1,
      );
    });

    it("rechaza datos con aspecto de secreto y claves vacías (defectos del llamador: lanzan)", async () => {
      const e = await escenario();
      await expect(encolar(e.empresa, "c", { token: "abc" })).rejects.toThrow(RangeError);
      await expect(encolar(e.empresa, "c", { tokenHash: "abc" })).rejects.toThrow(
        /parece un secreto/,
      );
      await expect(encolar(e.empresa, "  ")).rejects.toThrow(/clave de idempotencia/);
      expect(await filas("select id from trabajo where empresa_id = $1", [e.empresa])).toEqual([]);
    });
  });

  describe("puerto auditoría", () => {
    it("registra en la misma transacción: si la transacción se revierte, el registro no queda", async () => {
      const e = await escenario();
      const r = await entorno.ejecutar(
        { contexto: comoEmpresa(e.empresa, e.actor) },
        async (tx) => {
          await tx.auditoria.registrar({
            empresaId: e.empresa,
            actorPersonaId: e.actor,
            accion: "PRUEBA",
            entidad: "x",
            entidadId: "1",
            despues: { n: 1 },
          });
          return { ok: false as const, error: "REVERTIR" };
        },
      );
      expect(r).toEqual({ ok: false, error: "REVERTIR" });
      expect(
        await filas("select id from auditoria_empresa where empresa_id = $1", [e.empresa]),
      ).toEqual([]);
    });

    it("guarda antes y despues como JSON (o nulos) y rechaza campos con aspecto de secreto", async () => {
      const e = await escenario();
      const registrar = (extra: Record<string, unknown>) =>
        entorno.ejecutar({ contexto: comoEmpresa(e.empresa, e.actor) }, async (tx) => {
          await tx.auditoria.registrar({
            empresaId: e.empresa,
            actorPersonaId: e.actor,
            accion: "PRUEBA",
            entidad: "x",
            entidadId: "1",
            ...extra,
          });
          return ok(null);
        });
      expect((await registrar({ antes: { a: 1 }, despues: { lista: ["x"], b: null } })).ok).toBe(
        true,
      );
      expect((await registrar({})).ok).toBe(true);
      expect(
        await filas(
          "select antes, despues from auditoria_empresa where empresa_id = $1 order by id",
          [e.empresa],
        ),
      ).toEqual([
        { antes: { a: 1 }, despues: { lista: ["x"], b: null } },
        { antes: null, despues: null },
      ]);
      await expect(registrar({ despues: { tokenHash: "x" } })).rejects.toThrow(/parece un secreto/);
      await expect(registrar({ antes: { anidado: { token: "x" } } })).rejects.toThrow(RangeError);
      expect(
        await filas("select id from auditoria_empresa where empresa_id = $1", [e.empresa]),
      ).toHaveLength(2);
    });
  });
});
