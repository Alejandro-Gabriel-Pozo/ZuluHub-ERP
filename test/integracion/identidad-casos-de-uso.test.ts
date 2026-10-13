import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { crearTokensHmac } from "../../src/adaptadores/tokens/tokens-hmac";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import {
  crearCasosDeUsoDeIdentidad,
  type CasosDeUsoDeIdentidad,
} from "../../src/modulos/identidad/publico";
import {
  empresaId,
  invitacionId,
  personaId,
  sucursalId,
  type EmpresaId,
  type InvitacionId,
  type PersonaId,
  type SucursalId,
} from "../../src/primitivas/identificadores/marca";
import type { Tokens } from "../../src/puertos/tokens";
import {
  AHORA_DE_PRUEBA,
  comoEmpresa,
  crearBaseAparte,
  crearEmpresaActiva,
  crearEmpresaEnAlta,
  crearEntornoDePrueba,
  type EmpresaDePrueba,
} from "./entorno";
import {
  crearAsignacionDeBase,
  crearInvitacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
  emailAlAzar,
  hashDeToken,
  incluirEmpresa,
  sucursalDe,
  tokenAlAzar,
  type RolDePrueba,
} from "./fixtures-identidad";
import { usuarioDePrueba } from "../utilidades/usuarios";

/**
 * H3, tramo 3: los cuatro casos de uso de identidad contra una base real, con los roles limitados
 * y el contexto firmado (nunca el dueño de la base, salvo para armar el escenario y para mirar).
 * Cubre I1 a I10 (escenarios de punta a punta) y D1 a D5 (idempotencia), más los errores de cada
 * caso de uso y su aislamiento. La concurrencia está en `identidad-concurrencia.test.ts`.
 */

const base = inject("baseDePruebas");
const DIA = 86_400_000;
const ahora = AHORA_DE_PRUEBA;
const en = (dias: number) => new Date(ahora.getTime() + dias * DIA);

type Fila = Record<string, unknown>;
/** Para comparar con `toEqual` un texto cualquiera (un id generado). */
const cualquierTexto = expect.any(String) as string;

describe.skipIf(base === null)("identidad: los casos de uso contra una base real", () => {
  // Base propia de este archivo: SERIALIZABLE aborta por falsos positivos cuando OTROS archivos de
  // prueba, en paralelo, escriben las mismas tablas (los bloqueos de lectura son por página o tabla).
  // Aislarla hace que los reintentos que se ven acá sean solo los de la concurrencia que se prueba.
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entorno: ReturnType<typeof crearEntornoDePrueba>;
  let dueno: pg.Client;
  let tokens: Tokens;
  let casos: CasosDeUsoDeIdentidad;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDePrueba(propia.base, 10);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    tokens = crearTokensHmac(randomBytes(32));
    casos = crearCasosDeUsoDeIdentidad({
      transacciones: entorno,
      tokens,
      reglas: REGLAS_DE_EMPRESA,
    });
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
    (await dueno.query<T>(texto, parametros)).rows;
  const contar = async (texto: string, parametros: unknown[] = []) =>
    Number((await filas<{ n: string }>(texto, parametros))[0]?.n);

  // ---- escenarios ---------------------------------------------------------------------------

  type Escenario = EmpresaDePrueba &
    Readonly<{
      empresaId: EmpresaId;
      sucursal: SucursalId;
      gerente: PersonaId;
      ctx: ContextoOperativo;
    }>;

  /** Una empresa activa con su sucursal y su gerente (miembro activo). */
  const escenario = async (tenant?: EmpresaDePrueba["tenant"]): Promise<Escenario> => {
    const e = await crearEmpresaActiva(entorno, tenant === undefined ? {} : { tenant });
    const sucursal = sucursalId(await sucursalDe(dueno, e.empresa));
    const g = await crearPersonaDeBase(dueno);
    await crearMembresiaDeBase(dueno, e.empresa, g.id, "GERENTE");
    const gerente = personaId(g.id);
    return { ...e, empresaId: e.empresa, sucursal, gerente, ctx: comoEmpresa(e.empresa, gerente) };
  };

  /** Un miembro más de la empresa (creado por el dueño de la base). */
  const miembro = async (e: Escenario, rol: RolDePrueba, activo = true) => {
    const p = await crearPersonaDeBase(dueno);
    await crearMembresiaDeBase(dueno, e.empresa, p.id, rol, activo);
    return { id: personaId(p.id), email: p.email, ctx: comoEmpresa(e.empresa, personaId(p.id)) };
  };

  /** Invita con el caso de uso y devuelve el id y el token (derivado, como lo haría el mail). */
  const invitar = async (
    e: Escenario,
    opciones: {
      email?: string;
      rol?: "ADMINISTRADOR" | "OPERADOR";
      sucursales?: SucursalId[];
    } = {},
  ) => {
    const email = opciones.email ?? emailAlAzar("invitado");
    const r = await casos.invitarUsuario(e.ctx, {
      email,
      rol: opciones.rol ?? "OPERADOR",
      sucursales: opciones.sucursales ?? [e.sucursal],
    });
    if (!r.ok) throw new Error(`no se pudo invitar: ${JSON.stringify(r.error)}`);
    return { id: r.valor.invitacionId, email, token: tokens.derivar(r.valor.invitacionId) };
  };

  const aceptar = (token: string, email: string | null, cuando: Date = ahora) =>
    casos.aceptarInvitacion({
      token,
      emailAutenticado: email,
      usuarioAuth: usuarioDePrueba(email ?? "sin-sesion"),
      ahora: cuando,
    });

  /** Una invitación de USUARIO a varias empresas, armada por el dueño de la base. */
  const invitacionMultiempresa = async (
    empresas: { e: EmpresaDePrueba; rol: RolDePrueba; sucursales?: string[] }[],
    email = emailAlAzar("multi"),
  ) => {
    const emitido = tokens.emitir();
    const tenant = empresas[0]?.e.tenant as string;
    const inv = await crearInvitacionDeBase(dueno, {
      tenant,
      id: emitido.invitacionId,
      tokenHash: emitido.tokenHash,
      email,
    });
    for (const { e, rol, sucursales } of empresas) {
      await incluirEmpresa(dueno, inv, e.empresa, rol, sucursales ?? []);
    }
    return { inv, email, token: emitido.token };
  };

  /** Una empresa en alta con la invitación al gerente emitida por la plataforma (otra fase, H5). */
  const altaPendiente = async (email = emailAlAzar("gerente")) => {
    const empresa = await crearEmpresaEnAlta(entorno);
    const emitido = tokens.emitir();
    const inv = await crearInvitacionDeBase(dueno, {
      tenant: empresa.tenant,
      id: emitido.invitacionId,
      tokenHash: emitido.tokenHash,
      tipo: "ALTA_GERENTE",
      email,
      emitidaEn: new Date("2026-10-11T00:00:00Z"),
      venceEn: new Date("2026-10-12T00:00:00Z"),
    });
    await incluirEmpresa(dueno, inv, empresa.empresa, "GERENTE");
    return { empresa, inv, email, token: emitido.token };
  };

  // ---- lo que se mira en la base ------------------------------------------------------------

  const auditoria = (empresa: string, accion?: string) =>
    filas(
      `select accion, actor_persona_id, entidad, entidad_id, antes, despues from auditoria_empresa
       where empresa_id = $1 and ($2::text is null or accion = $2) order by id`,
      [empresa, accion ?? null],
    );
  const trabajos = (empresa: string) =>
    filas(
      "select tipo, datos, clave_idempotencia, estado from trabajo where empresa_id = $1 order by creado_en, id",
      [empresa],
    );
  const invitacion = async (id: string) =>
    (await filas("select * from invitacion where id = $1", [id]))[0];
  const membresia = async (empresa: string, persona: string) =>
    (
      await filas("select * from membresia where empresa_id = $1 and persona_id = $2", [
        empresa,
        persona,
      ])
    )[0];
  const personaPorEmail = async (email: string) =>
    (await filas("select * from persona where email = $1", [email]))[0];

  /** Todo lo que pueden tocar los casos de uso, para las empresas indicadas: la "foto" de la base. */
  const foto = async (empresas: string[], emails: string[] = []) =>
    JSON.stringify({
      membresias: await filas(
        "select * from membresia where empresa_id = any($1) order by empresa_id, persona_id",
        [empresas],
      ),
      asignaciones: await filas(
        "select * from asignacion_sucursal where empresa_id = any($1) order by empresa_id, persona_id, sucursal_id",
        [empresas],
      ),
      invitaciones: await filas(
        `select i.* from invitacion i where i.id in (select invitacion_id from invitacion_empresa where empresa_id = any($1))
         order by i.id`,
        [empresas],
      ),
      auditoria: await filas(
        "select id, empresa_id, accion from auditoria_empresa where empresa_id = any($1) order by id",
        [empresas],
      ),
      trabajos: await filas(
        "select id, empresa_id, tipo, estado from trabajo where empresa_id = any($1) order by id",
        [empresas],
      ),
      personas: await filas("select * from persona where email = any($1) order by email", [emails]),
      empresas: await filas(
        "select id, estado, version from empresa where id = any($1) order by id",
        [empresas],
      ),
    });

  const suspenderEmpresa = (empresa: string) =>
    dueno.query("update empresa set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1", [
      empresa,
    ]);

  // =============================================================================================
  // I1 a I10: de punta a punta
  // =============================================================================================
  describe("escenarios de punta a punta (I1 a I10)", () => {
    it("I1: invitar crea la invitación (7 días), el trabajo y la auditoría, sin guardar el token", async () => {
      const e = await escenario();
      const { id, email, token } = await invitar(e, { email: "  NuevaPersona@Prueba.TEST " });
      expect(email.trim().toLowerCase()).toBe("nuevapersona@prueba.test");

      const inv = await invitacion(id);
      expect(inv).toMatchObject({
        tenant_id: e.tenant,
        tipo: "USUARIO",
        email: "nuevapersona@prueba.test",
        estado: "PENDIENTE",
        emitida_por: e.gerente,
        aceptada_por: null,
        reemplazada_por: null,
      });
      expect(inv?.["emitida_en"]).toEqual(ahora);
      expect(inv?.["vence_en"]).toEqual(en(7));
      // La base guarda el hash del token derivado del id, nunca el token.
      expect(inv?.["token_hash"]).toBe(hashDeToken(token));
      expect(inv?.["token_hash"]).toBe(tokens.hash(tokens.derivar(invitacionId(id))));
      expect(
        await filas(
          "select empresa_id, rol, estado, tipo from invitacion_empresa where invitacion_id = $1",
          [id],
        ),
      ).toEqual([{ empresa_id: e.empresa, rol: "OPERADOR", estado: "PENDIENTE", tipo: "USUARIO" }]);
      expect(
        await filas(
          "select empresa_id, sucursal_id from invitacion_sucursal where invitacion_id = $1",
          [id],
        ),
      ).toEqual([{ empresa_id: e.empresa, sucursal_id: e.sucursal }]);

      // El trabajo pide el envío con datos sin secretos y clave de idempotencia por invitación.
      expect(await trabajos(e.empresa)).toEqual([
        {
          tipo: "enviar_invitacion",
          datos: { invitacionId: id },
          clave_idempotencia: `invitacion:${id}:envio`,
          estado: "PENDIENTE",
        },
      ]);
      const registros = await auditoria(e.empresa);
      expect(registros).toHaveLength(1);
      expect(registros[0]).toMatchObject({
        accion: "INVITACION_EMITIDA",
        actor_persona_id: e.gerente,
        entidad: "invitacion",
        entidad_id: id,
      });
      // Ni el trabajo ni la auditoría llevan el token ni su hash.
      const rastro = JSON.stringify([registros, await trabajos(e.empresa)]);
      expect(rastro).not.toContain(token);
      expect(rastro).not.toContain(hashDeToken(token));
    });

    it("I2: aceptar una invitación de usuario crea la persona, la membresía, las asignaciones y la auditoría", async () => {
      const e = await escenario();
      const { id, email, token } = await invitar(e, { rol: "ADMINISTRADOR" });
      expect(await personaPorEmail(email)).toBeUndefined();

      const r = await aceptar(token, email.toUpperCase());
      expect(r).toEqual({
        ok: true,
        valor: {
          yaEstabaAceptada: false,
          personaId: cualquierTexto,
          empresas: [{ empresaId: e.empresa, rol: "ADMINISTRADOR" }],
        },
      });
      const persona = await personaPorEmail(email);
      expect(persona).toMatchObject({ email, activo_global: true });
      expect(await invitacion(id)).toMatchObject({
        estado: "ACEPTADA",
        aceptada_por: persona?.["id"],
        aceptada_en: ahora,
      });
      expect(await membresia(e.empresa, persona?.["id"] as string)).toMatchObject({
        rol: "ADMINISTRADOR",
        activo: true,
        invitacion_id: id,
      });
      expect(
        await filas("select sucursal_id, activa from asignacion_sucursal where persona_id = $1", [
          persona?.["id"],
        ]),
      ).toEqual([{ sucursal_id: e.sucursal, activa: true }]);
      const registros = await auditoria(e.empresa, "INVITACION_ACEPTADA");
      expect(registros).toHaveLength(1);
      expect(registros[0]).toMatchObject({
        actor_persona_id: persona?.["id"],
        entidad: "invitacion",
        entidad_id: id,
        despues: {
          estado: "ACEPTADA",
          rol: "ADMINISTRADOR",
          reactivada: false,
          sucursales: [e.sucursal],
        },
      });
      // Quien aceptó ya no tiene trabajos nuevos pendientes: aceptar no encola nada.
      expect(await trabajos(e.empresa)).toHaveLength(1);
      expect(JSON.stringify(registros)).not.toContain(token);
    });

    it("I3: aceptar el alta del gerente crea al gerente y pasa la empresa de PROVISIONING a ACTIVE", async () => {
      const { empresa, inv, email, token } = await altaPendiente();
      expect(
        (await filas("select estado from empresa where id = $1", [empresa.empresa]))[0]?.["estado"],
      ).toBe("PROVISIONING");

      const r = await aceptar(token, email, new Date("2026-10-11T12:00:00Z"));
      expect(r.ok && r.valor.yaEstabaAceptada).toBe(false);
      const persona = await personaPorEmail(email);
      expect(await membresia(empresa.empresa, persona?.["id"] as string)).toMatchObject({
        rol: "GERENTE",
        activo: true,
        invitacion_id: inv.id,
      });
      expect(
        await filas("select estado, motivo_estado from empresa where id = $1", [empresa.empresa]),
      ).toEqual([{ estado: "ACTIVE", motivo_estado: null }]);
      expect(await invitacion(inv.id)).toMatchObject({ estado: "ACEPTADA" });
      expect((await auditoria(empresa.empresa)).map((a) => a["accion"])).toEqual([
        "ALTA_ACEPTADA",
        "EMPRESA_ACTIVADA",
      ]);
    });

    it("I4: una invitación vencida no se acepta, y no queda nada escrito (ni la persona)", async () => {
      const e = await escenario();
      const { id, email, token } = await invitar(e);
      const antes = await foto([e.empresa], [email]);
      // Vence a los 7 días justos: en ese instante ya no vale.
      expect(await aceptar(token, email, en(7))).toEqual({
        ok: false,
        error: "INVITACION_VENCIDA",
      });
      expect(await aceptar(token, email, en(30))).toEqual({
        ok: false,
        error: "INVITACION_VENCIDA",
      });
      expect(await foto([e.empresa], [email])).toBe(antes);
      expect(await invitacion(id)).toMatchObject({ estado: "PENDIENTE" });
      // Un instante antes del vencimiento todavía vale.
      expect((await aceptar(token, email, new Date(en(7).getTime() - 1))).ok).toBe(true);
    });

    it("I4b: el alta vence a las 24 horas", async () => {
      const { inv, email, token } = await altaPendiente();
      const emitida = new Date("2026-10-11T00:00:00Z");
      expect(await aceptar(token, email, new Date(emitida.getTime() + 24 * 3_600_000))).toEqual({
        ok: false,
        error: "INVITACION_VENCIDA",
      });
      expect(await invitacion(inv.id)).toMatchObject({ estado: "PENDIENTE" });
    });

    it("I5: tras reenviar, el token viejo ya no sirve y el nuevo sí", async () => {
      const e = await escenario();
      const vieja = await invitar(e);
      const r = await casos.reenviarInvitacion(e.ctx, { invitacionId: invitacionId(vieja.id) });
      expect(r).toEqual({
        ok: true,
        valor: { invitacionId: cualquierTexto, yaEstabaReenviada: false },
      });
      const nuevaId = r.ok ? r.valor.invitacionId : "";
      expect(nuevaId).not.toBe(vieja.id);
      const tokenNuevo = tokens.derivar(nuevaId as InvitacionId);
      expect(tokenNuevo).not.toBe(vieja.token);

      expect(await aceptar(vieja.token, vieja.email)).toEqual({
        ok: false,
        error: "INVITACION_REVOCADA",
      });
      expect(await invitacion(vieja.id)).toMatchObject({
        estado: "REVOCADA",
        reemplazada_por: nuevaId,
      });
      expect(await invitacion(nuevaId)).toMatchObject({ estado: "PENDIENTE", email: vieja.email });
      expect((await invitacion(nuevaId))?.["vence_en"]).toEqual(en(7));
      expect((await aceptar(tokenNuevo, vieja.email)).ok).toBe(true);
      // Un trabajo de envío por invitación: la vieja y la nueva.
      expect((await trabajos(e.empresa)).map((t) => t["datos"])).toEqual([
        { invitacionId: vieja.id },
        { invitacionId: nuevaId },
      ]);
    });

    it("I6: apagar una membresía apaga sus asignaciones y revoca las invitaciones pendientes a su email", async () => {
      const e = await escenario();
      const otra = await escenario(e.tenant);
      const tercera = await escenario(e.tenant);
      const p = await miembro(e, "OPERADOR");
      await crearAsignacionDeBase(dueno, e.empresa, p.id, e.sucursal);
      // La base admite una sola pendiente por empresa y email: esta es de DOS empresas (la de la
      // baja y otra) y se revoca entera.
      const doble = await invitacionMultiempresa(
        [
          { e, rol: "OPERADOR" },
          { e: otra, rol: "OPERADOR" },
        ],
        p.email,
      );
      // No se tocan: una pendiente de OTRA persona en la misma empresa, y una del mismo email que
      // no incluye a la empresa de la baja.
      const ajena = await invitar(e);
      const deOtraEmpresa = await invitacionMultiempresa(
        [{ e: tercera, rol: "OPERADOR" }],
        p.email,
      );

      const r = await casos.apagarMembresia(e.ctx, { personaId: p.id });
      expect(r).toEqual({ ok: true, valor: { yaEstabaApagada: false, invitacionesRevocadas: 1 } });
      expect(await membresia(e.empresa, p.id)).toMatchObject({ activo: false });
      expect(
        await filas("select activa from asignacion_sucursal where persona_id = $1", [p.id]),
      ).toEqual([{ activa: false }]);
      expect(await invitacion(doble.inv.id)).toMatchObject({ estado: "REVOCADA" });
      expect(await invitacion(ajena.id)).toMatchObject({ estado: "PENDIENTE" });
      expect(await invitacion(deOtraEmpresa.inv.id)).toMatchObject({ estado: "PENDIENTE" });
      expect((await auditoria(e.empresa)).map((a) => a["accion"]).sort()).toEqual(
        ["INVITACION_EMITIDA", "INVITACION_REVOCADA", "MEMBRESIA_APAGADA"].sort(),
      );
      // Y ya no se puede aceptar la que se revocó.
      expect(await aceptar(doble.token, p.email)).toEqual({
        ok: false,
        error: "INVITACION_REVOCADA",
      });
    });

    it("I7: una falla después de encolar y auditar no deja nada (ni invitación, ni trabajo, ni auditoría)", async () => {
      const e = await escenario();
      const email = emailAlAzar("falla");
      const conFalla = crearEntornoDePrueba(propia.base, 3, (tx) => ({
        ...tx,
        auditoria: {
          registrar: async (registro) => {
            await tx.auditoria.registrar(registro);
            throw new Error("falla forzada después de auditar");
          },
        },
      }));
      try {
        const roto = crearCasosDeUsoDeIdentidad({
          transacciones: conFalla,
          tokens,
          reglas: REGLAS_DE_EMPRESA,
        });
        const antes = await foto([e.empresa], [email]);
        await expect(
          roto.invitarUsuario(e.ctx, { email, rol: "OPERADOR", sucursales: [e.sucursal] }),
        ).rejects.toThrow("falla forzada");
        expect(await foto([e.empresa], [email])).toBe(antes);
        expect(await trabajos(e.empresa)).toEqual([]);

        // Lo mismo al aceptar: la persona, la aceptación y las membresías se revierten juntas.
        const ok = await invitar(e, { email });
        const antesDeAceptar = await foto([e.empresa], [email]);
        await expect(
          roto.aceptarInvitacion({
            token: ok.token,
            emailAutenticado: email,
            usuarioAuth: usuarioDePrueba(email),
            ahora,
          }),
        ).rejects.toThrow("falla forzada");
        expect(await foto([e.empresa], [email])).toBe(antesDeAceptar);
        expect(await personaPorEmail(email)).toBeUndefined();
        expect(await invitacion(ok.id)).toMatchObject({ estado: "PENDIENTE" });
      } finally {
        await conFalla.cerrar();
      }
    });

    it("I8: una persona suspendida globalmente no acepta, y no queda nada escrito", async () => {
      const e = await escenario();
      const suspendida = await crearPersonaDeBase(dueno);
      await dueno.query("update persona set activo_global = false where id = $1", [suspendida.id]);
      const { id, token } = await invitar(e, { email: suspendida.email });
      const antes = await foto([e.empresa], [suspendida.email]);
      expect(await aceptar(token, suspendida.email)).toEqual({
        ok: false,
        error: "PERSONA_SUSPENDIDA",
      });
      expect(await foto([e.empresa], [suspendida.email])).toBe(antes);
      expect(await invitacion(id)).toMatchObject({ estado: "PENDIENTE" });
    });

    it("I9: invitar a un miembro activo es YA_ES_MIEMBRO, y a uno apagado sí se puede", async () => {
      const e = await escenario();
      const activo = await miembro(e, "OPERADOR");
      const apagado = await miembro(e, "OPERADOR", false);
      const antes = await foto([e.empresa]);
      expect(
        await casos.invitarUsuario(e.ctx, { email: activo.email, rol: "OPERADOR", sucursales: [] }),
      ).toEqual({ ok: false, error: "YA_ES_MIEMBRO" });
      expect(await foto([e.empresa])).toBe(antes);
      const aApagado = await casos.invitarUsuario(e.ctx, {
        email: apagado.email,
        rol: "OPERADOR",
        sucursales: [],
      });
      expect(aApagado.ok).toBe(true);
    });

    it("I10: el email autenticado tiene que ser el de la invitación; sin sesión tampoco", async () => {
      const e = await escenario();
      const { id, email, token } = await invitar(e);
      const antes = await foto([e.empresa], [email, "otra@prueba.test"]);
      expect(await aceptar(token, "otra@prueba.test")).toEqual({
        ok: false,
        error: "INVITACION_DE_OTRO_EMAIL",
      });
      expect(await aceptar(token, null)).toEqual({ ok: false, error: "INVITACION_DE_OTRO_EMAIL" });
      expect(await aceptar(token, "esto no es un email")).toEqual({
        ok: false,
        error: "INVITACION_DE_OTRO_EMAIL",
      });
      expect(await foto([e.empresa], [email, "otra@prueba.test"])).toBe(antes);
      expect(await invitacion(id)).toMatchObject({ estado: "PENDIENTE", aceptada_por: null });
      // Ya aceptada, repetirla con otro email tampoco devuelve éxito.
      expect((await aceptar(token, email)).ok).toBe(true);
      expect(await aceptar(token, "otra@prueba.test")).toEqual({
        ok: false,
        error: "INVITACION_DE_OTRO_EMAIL",
      });
    });
  });

  // =============================================================================================
  // Más reglas de cada caso de uso
  // =============================================================================================
  describe("aceptarInvitacion", () => {
    it("un token que no existe es INVITACION_NO_ENCONTRADA", async () => {
      expect(await aceptar(tokenAlAzar().token, "alguien@prueba.test")).toEqual({
        ok: false,
        error: "INVITACION_NO_ENCONTRADA",
      });
      expect(await aceptar("", null)).toEqual({ ok: false, error: "INVITACION_NO_ENCONTRADA" });
    });

    it("el alta de una empresa que ya no está en alta es ALTA_NO_PENDIENTE", async () => {
      const e = await escenario();
      const emitido = tokens.emitir();
      const email = emailAlAzar("gerente");
      const inv = await crearInvitacionDeBase(dueno, {
        tenant: e.tenant,
        id: emitido.invitacionId,
        tokenHash: emitido.tokenHash,
        tipo: "ALTA_GERENTE",
        email,
      });
      await incluirEmpresa(dueno, inv, e.empresa, "GERENTE");
      expect(await aceptar(emitido.token, email)).toEqual({
        ok: false,
        error: "ALTA_NO_PENDIENTE",
      });
    });

    it("con una empresa suspendida, o con el tenant suspendido, es EMPRESA_NO_OPERA con el motivo", async () => {
      const e = await escenario();
      const { id, email, token } = await invitar(e);
      await suspenderEmpresa(e.empresa);
      expect(await aceptar(token, email)).toEqual({
        ok: false,
        error: { codigo: "EMPRESA_NO_OPERA", empresaId: e.empresa, motivo: "EMPRESA_SUSPENDIDA" },
      });
      await dueno.query(
        "update empresa set estado = 'ACTIVE', motivo_estado = null where id = $1",
        [e.empresa],
      );
      await dueno.query(
        "update tenant set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
        [e.tenant],
      );
      expect(await aceptar(token, email)).toEqual({
        ok: false,
        error: { codigo: "EMPRESA_NO_OPERA", empresaId: e.empresa, motivo: "TENANT_SUSPENDIDO" },
      });
      expect(await invitacion(id)).toMatchObject({ estado: "PENDIENTE" });
      expect(await personaPorEmail(email)).toBeUndefined();
    });

    it("YA_ES_MIEMBRO: quien ya es miembro activo de una de las empresas no acepta, y se revierte todo", async () => {
      const e1 = await escenario();
      const e2 = await escenario(e1.tenant);
      const ya = await miembro(e1, "OPERADOR");
      const { inv, token } = await invitacionMultiempresa(
        [
          { e: e1, rol: "OPERADOR" },
          { e: e2, rol: "OPERADOR" },
        ],
        ya.email,
      );
      const antes = await foto([e1.empresa, e2.empresa], [ya.email]);
      expect(await aceptar(token, ya.email)).toEqual({ ok: false, error: "YA_ES_MIEMBRO" });
      expect(await foto([e1.empresa, e2.empresa], [ya.email])).toBe(antes);
      expect(await invitacion(inv.id)).toMatchObject({ estado: "PENDIENTE" });
      expect(await membresia(e2.empresa, ya.id)).toBeUndefined();
    });

    it("reactivar una membresía apagada con el MISMO rol: la reactiva y reactiva sus asignaciones", async () => {
      const e = await escenario();
      const otraSucursal = (
        await filas<{ id: string }>(
          "insert into sucursal (empresa_id, nombre) values ($1, 'Anexo') returning id",
          [e.empresa],
        )
      )[0]?.id as string;
      const p = await miembro(e, "OPERADOR", false);
      await crearAsignacionDeBase(dueno, e.empresa, p.id, e.sucursal, false);
      const versionAntes = (await membresia(e.empresa, p.id))?.["version"] as number;
      const { token } = await invitar(e, {
        email: p.email,
        sucursales: [e.sucursal, sucursalId(otraSucursal)],
      });

      const r = await aceptar(token, p.email);
      expect(r.ok && r.valor.personaId).toBe(p.id);
      expect(await membresia(e.empresa, p.id)).toMatchObject({ activo: true, rol: "OPERADOR" });
      expect((await membresia(e.empresa, p.id))?.["version"]).toBe(versionAntes + 1);
      expect(
        await filas(
          "select sucursal_id, activa from asignacion_sucursal where persona_id = $1 order by sucursal_id",
          [p.id],
        ),
      ).toEqual(
        [e.sucursal, otraSucursal].sort().map((sucursal_id) => ({ sucursal_id, activa: true })),
      );
      expect((await auditoria(e.empresa, "INVITACION_ACEPTADA"))[0]).toMatchObject({
        despues: { reactivada: true },
      });
    });

    it("reactivar con OTRO rol no se soporta: ROL_DISTINTO_AL_ANTERIOR y no se escribe nada", async () => {
      const e = await escenario();
      const p = await miembro(e, "OPERADOR", false);
      const { id, token } = await invitar(e, { email: p.email, rol: "ADMINISTRADOR" });
      const antes = await foto([e.empresa], [p.email]);
      expect(await aceptar(token, p.email)).toEqual({
        ok: false,
        error: { codigo: "ROL_DISTINTO_AL_ANTERIOR", empresaId: e.empresa },
      });
      expect(await foto([e.empresa], [p.email])).toBe(antes);
      expect(await invitacion(id)).toMatchObject({ estado: "PENDIENTE" });
      expect(await membresia(e.empresa, p.id)).toMatchObject({ activo: false, rol: "OPERADOR" });
    });

    it("repetir una aceptación ya hecha por la misma persona devuelve ok sin escribir (D1)", async () => {
      const e = await escenario();
      const { email, token } = await invitar(e);
      const primera = await aceptar(token, email);
      expect(primera.ok && primera.valor.yaEstabaAceptada).toBe(false);
      const despues = await foto([e.empresa], [email]);
      const segunda = await aceptar(token, email);
      expect(segunda).toEqual({
        ok: true,
        valor: {
          yaEstabaAceptada: true,
          personaId: primera.ok ? primera.valor.personaId : "",
          empresas: [{ empresaId: e.empresa, rol: "OPERADOR" }],
        },
      });
      expect(await foto([e.empresa], [email])).toBe(despues);
    });

    it("vencida o con la empresa suspendida después de aceptar, la repetición sigue siendo ok (ya está aceptada)", async () => {
      const e = await escenario();
      const { email, token } = await invitar(e);
      expect((await aceptar(token, email)).ok).toBe(true);
      await suspenderEmpresa(e.empresa);
      const repetida = await aceptar(token, email, en(60));
      expect(repetida.ok && repetida.valor.yaEstabaAceptada).toBe(true);
    });
  });

  describe("invitarUsuario", () => {
    it("el email se normaliza, y uno inválido es EMAIL_INVALIDO sin tocar la base", async () => {
      const e = await escenario();
      const antes = await foto([e.empresa]);
      for (const mal of ["", "sin-arroba", "@x.com", "x@", "con espacio@x.com"]) {
        expect(
          await casos.invitarUsuario(e.ctx, { email: mal, rol: "OPERADOR", sucursales: [] }),
        ).toEqual({
          ok: false,
          error: "EMAIL_INVALIDO",
        });
      }
      expect(await foto([e.empresa])).toBe(antes);
    });

    it("el rol GERENTE no se invita (el gerente se traspasa) y no queda nada escrito", async () => {
      const e = await escenario();
      const antes = await foto([e.empresa]);
      const r = await casos.invitarUsuario(e.ctx, {
        email: emailAlAzar(),
        rol: "GERENTE",
        sucursales: [],
      });
      expect(r).toEqual({ ok: false, error: "ROL_NO_INVITABLE" });
      expect(await foto([e.empresa])).toBe(antes);
    });

    it("una sucursal de otra empresa es SUCURSAL_NO_ES_DE_LA_EMPRESA y se revierte todo", async () => {
      const e = await escenario();
      const otra = await escenario(e.tenant);
      const email = emailAlAzar();
      const antes = await foto([e.empresa, otra.empresa], [email]);
      const r = await casos.invitarUsuario(e.ctx, {
        email,
        rol: "OPERADOR",
        sucursales: [otra.sucursal],
      });
      expect(r).toEqual({ ok: false, error: "SUCURSAL_NO_ES_DE_LA_EMPRESA" });
      expect(await foto([e.empresa, otra.empresa], [email])).toBe(antes);
    });

    it("las sucursales repetidas se cuentan una sola vez", async () => {
      const e = await escenario();
      const { id } = await invitar(e, { sucursales: [e.sucursal, e.sucursal] });
      expect(
        await contar("select count(*) as n from invitacion_sucursal where invitacion_id = $1", [
          id,
        ]),
      ).toBe(1);
    });

    it("con una pendiente vigente devuelve esa, sea cual sea el rol pedido, y no escribe (D2)", async () => {
      const e = await escenario();
      const primera = await invitar(e, { rol: "OPERADOR" });
      const despues = await foto([e.empresa]);
      const repetida = await casos.invitarUsuario(e.ctx, {
        email: primera.email.toUpperCase(),
        rol: "ADMINISTRADOR",
        sucursales: [],
      });
      expect(repetida).toEqual({ ok: true, valor: { invitacionId: primera.id, yaExistia: true } });
      expect(await foto([e.empresa])).toBe(despues);
      expect(await trabajos(e.empresa)).toHaveLength(1);
      expect(await auditoria(e.empresa)).toHaveLength(1);
    });

    it("una pendiente vencida se revoca y se reemplaza por una nueva", async () => {
      const e = await escenario();
      const vieja = await invitar(e);
      const r = await casos.invitarUsuario(
        { ...e.ctx, ahora: en(8) },
        { email: vieja.email, rol: "ADMINISTRADOR", sucursales: [] },
      );
      expect(r).toEqual({
        ok: true,
        valor: { invitacionId: cualquierTexto, yaExistia: false },
      });
      const nuevaId = r.ok ? r.valor.invitacionId : "";
      expect(nuevaId).not.toBe(vieja.id);
      expect(await invitacion(vieja.id)).toMatchObject({
        estado: "REVOCADA",
        reemplazada_por: nuevaId,
      });
      expect(await invitacion(nuevaId)).toMatchObject({ estado: "PENDIENTE" });
      expect(
        await contar(
          "select count(*) as n from invitacion_empresa where empresa_id = $1 and email = $2 and estado = 'PENDIENTE'",
          [e.empresa, vieja.email],
        ),
      ).toBe(1);
      expect((await trabajos(e.empresa)).map((t) => t["datos"])).toEqual([
        { invitacionId: vieja.id },
        { invitacionId: nuevaId },
      ]);
      expect((await auditoria(e.empresa, "INVITACION_EMITIDA"))[1]).toMatchObject({
        despues: { reemplazaA: vieja.id, rol: "ADMINISTRADOR" },
      });
    });

    it("una empresa suspendida no invita: EMPRESA_NO_OPERA", async () => {
      const e = await escenario();
      await suspenderEmpresa(e.empresa);
      expect(
        await casos.invitarUsuario(e.ctx, {
          email: emailAlAzar(),
          rol: "OPERADOR",
          sucursales: [],
        }),
      ).toEqual({
        ok: false,
        error: { codigo: "EMPRESA_NO_OPERA", empresaId: e.empresa, motivo: "EMPRESA_SUSPENDIDA" },
      });
    });
  });

  describe("apagarMembresia", () => {
    it("el gerente no se apaga: ES_EL_GERENTE", async () => {
      const e = await escenario();
      const admin = await miembro(e, "ADMINISTRADOR");
      const antes = await foto([e.empresa]);
      expect(await casos.apagarMembresia(admin.ctx, { personaId: e.gerente })).toEqual({
        ok: false,
        error: "ES_EL_GERENTE",
      });
      expect(await casos.apagarMembresia(e.ctx, { personaId: e.gerente })).toEqual({
        ok: false,
        error: "ES_EL_GERENTE",
      });
      expect(await foto([e.empresa])).toBe(antes);
    });

    it("el último admin no se apaga: ULTIMO_ADMIN (sin gerente activo)", async () => {
      const e = await escenario();
      // Desde 0005 la base no deja apagar a un gerente (`membresia_gerente_no_se_apaga`): una empresa
      // sin gerente activo se arma quitando su membresía, como el dueño de la base.
      await dueno.query("delete from membresia where empresa_id = $1 and persona_id = $2", [
        e.empresa,
        e.gerente,
      ]);
      const unico = await miembro(e, "ADMINISTRADOR");
      const operador = await miembro(e, "OPERADOR");
      expect(await casos.apagarMembresia(unico.ctx, { personaId: unico.id })).toEqual({
        ok: false,
        error: "ULTIMO_ADMIN",
      });
      // Un operador sí se apaga, aunque sea el único operador.
      expect((await casos.apagarMembresia(unico.ctx, { personaId: operador.id })).ok).toBe(true);
      expect(await membresia(e.empresa, unico.id)).toMatchObject({ activo: true });
    });

    it("una persona que no es de la empresa es MEMBRESIA_NO_ENCONTRADA (también la de otra empresa)", async () => {
      const e = await escenario();
      const otra = await escenario();
      expect(await casos.apagarMembresia(e.ctx, { personaId: otra.gerente })).toEqual({
        ok: false,
        error: "MEMBRESIA_NO_ENCONTRADA",
      });
      expect(await membresia(otra.empresa, otra.gerente)).toMatchObject({ activo: true });
    });

    it("apagar dos veces: ok la segunda y no escribe ni audita de nuevo (D4)", async () => {
      const e = await escenario();
      const p = await miembro(e, "OPERADOR");
      await crearAsignacionDeBase(dueno, e.empresa, p.id, e.sucursal);
      expect(await casos.apagarMembresia(e.ctx, { personaId: p.id })).toEqual({
        ok: true,
        valor: { yaEstabaApagada: false, invitacionesRevocadas: 0 },
      });
      const despues = await foto([e.empresa]);
      expect(await casos.apagarMembresia(e.ctx, { personaId: p.id })).toEqual({
        ok: true,
        valor: { yaEstabaApagada: true, invitacionesRevocadas: 0 },
      });
      expect(await foto([e.empresa])).toBe(despues);
      expect(await auditoria(e.empresa, "MEMBRESIA_APAGADA")).toHaveLength(1);
    });

    it("una empresa suspendida no apaga a nadie: EMPRESA_NO_OPERA", async () => {
      const e = await escenario();
      const p = await miembro(e, "OPERADOR");
      await suspenderEmpresa(e.empresa);
      expect(await casos.apagarMembresia(e.ctx, { personaId: p.id })).toEqual({
        ok: false,
        error: { codigo: "EMPRESA_NO_OPERA", empresaId: e.empresa, motivo: "EMPRESA_SUSPENDIDA" },
      });
      expect(await membresia(e.empresa, p.id)).toMatchObject({ activo: true });
    });

    it("la persona apagada vuelve con una invitación nueva y con el mismo rol", async () => {
      const e = await escenario();
      const p = await miembro(e, "OPERADOR");
      await casos.apagarMembresia(e.ctx, { personaId: p.id });
      const { token } = await invitar(e, { email: p.email });
      expect((await aceptar(token, p.email)).ok).toBe(true);
      expect(await membresia(e.empresa, p.id)).toMatchObject({ activo: true });
    });
  });

  describe("reenviarInvitacion", () => {
    it("reenviar dos veces la misma de origen devuelve la misma reemplazante y no escribe de nuevo (D3)", async () => {
      const e = await escenario();
      const vieja = await invitar(e);
      const primera = await casos.reenviarInvitacion(e.ctx, {
        invitacionId: invitacionId(vieja.id),
      });
      expect(primera.ok && primera.valor.yaEstabaReenviada).toBe(false);
      const despues = await foto([e.empresa]);
      const segunda = await casos.reenviarInvitacion(e.ctx, {
        invitacionId: invitacionId(vieja.id),
      });
      expect(segunda).toEqual({
        ok: true,
        valor: {
          invitacionId: primera.ok ? primera.valor.invitacionId : "",
          yaEstabaReenviada: true,
        },
      });
      expect(await foto([e.empresa])).toBe(despues);
      expect(await auditoria(e.empresa, "INVITACION_REENVIADA")).toHaveLength(1);
      expect(await trabajos(e.empresa)).toHaveLength(2);
    });

    it("una vencida se puede reenviar; una aceptada no; una revocada sin reemplazo tampoco", async () => {
      const e = await escenario();
      const vencida = await invitar(e);
      const r = await casos.reenviarInvitacion(
        { ...e.ctx, ahora: en(9) },
        { invitacionId: invitacionId(vencida.id) },
      );
      expect(r.ok).toBe(true);
      expect((await invitacion(r.ok ? r.valor.invitacionId : ""))?.["vence_en"]).toEqual(en(16));

      const aceptada = await invitar(e);
      await aceptar(aceptada.token, aceptada.email);
      expect(
        await casos.reenviarInvitacion(e.ctx, { invitacionId: invitacionId(aceptada.id) }),
      ).toEqual({
        ok: false,
        error: "INVITACION_NO_PENDIENTE",
      });

      const revocada = await invitar(e);
      await dueno.query(
        "update invitacion set estado = 'REVOCADA', revocada_en = $2, motivo_revocacion = 'prueba' where id = $1",
        [revocada.id, ahora],
      );
      expect(
        await casos.reenviarInvitacion(e.ctx, { invitacionId: invitacionId(revocada.id) }),
      ).toEqual({
        ok: false,
        error: "INVITACION_REVOCADA",
      });
    });

    it("el alta del gerente no se reenvía desde una empresa (es de plataforma)", async () => {
      const e = await escenario();
      const emitido = tokens.emitir();
      const inv = await crearInvitacionDeBase(dueno, {
        tenant: e.tenant,
        id: emitido.invitacionId,
        tokenHash: emitido.tokenHash,
        tipo: "ALTA_GERENTE",
      });
      await incluirEmpresa(dueno, inv, e.empresa, "GERENTE");
      expect(await casos.reenviarInvitacion(e.ctx, { invitacionId: invitacionId(inv.id) })).toEqual(
        {
          ok: false,
          error: "REENVIO_NO_PERMITIDO",
        },
      );
    });

    it("una invitación de otra empresa (aunque sea del mismo tenant) es INVITACION_NO_ENCONTRADA", async () => {
      const e = await escenario();
      const otra = await escenario(e.tenant);
      const deOtra = await invitar(otra);
      const antes = await foto([otra.empresa]);
      expect(
        await casos.reenviarInvitacion(e.ctx, { invitacionId: invitacionId(deOtra.id) }),
      ).toEqual({
        ok: false,
        error: "INVITACION_NO_ENCONTRADA",
      });
      expect(
        await casos.reenviarInvitacion(e.ctx, {
          invitacionId: invitacionId(tokens.emitir().invitacionId),
        }),
      ).toEqual({
        ok: false,
        error: "INVITACION_NO_ENCONTRADA",
      });
      expect(await foto([otra.empresa])).toBe(antes);
    });

    it("una empresa suspendida no reenvía: EMPRESA_NO_OPERA", async () => {
      const e = await escenario();
      const vieja = await invitar(e);
      await suspenderEmpresa(e.empresa);
      expect(
        await casos.reenviarInvitacion(e.ctx, { invitacionId: invitacionId(vieja.id) }),
      ).toEqual({
        ok: false,
        error: { codigo: "EMPRESA_NO_OPERA", empresaId: e.empresa, motivo: "EMPRESA_SUSPENDIDA" },
      });
      expect(await invitacion(vieja.id)).toMatchObject({ estado: "PENDIENTE" });
    });
  });

  // =============================================================================================
  // Guard de permisos (H4): lo verifica el caso de uso en el servidor, no la base
  // =============================================================================================
  describe("guard de permisos: solo un gerente o administrador activo de la empresa, no suspendido", () => {
    type Actor = { nombre: string; armar: (e: Escenario) => Promise<ContextoOperativo> };
    const actores: Actor[] = [
      { nombre: "un operador", armar: async (e) => (await miembro(e, "OPERADOR")).ctx },
      {
        nombre: "un administrador apagado",
        armar: async (e) => (await miembro(e, "ADMINISTRADOR", false)).ctx,
      },
      {
        nombre: "una persona que no es miembro",
        armar: async () =>
          comoEmpresa(
            empresaId((await escenario()).empresa),
            personaId((await crearPersonaDeBase(dueno)).id),
          ),
      },
      {
        nombre: "el sistema (sin persona)",
        armar: (e) => Promise.resolve(comoEmpresa(e.empresa, null)),
      },
      {
        nombre: "el gerente de OTRA empresa",
        armar: async (e) => {
          const otra = await escenario(e.tenant);
          return comoEmpresa(e.empresa, otra.gerente);
        },
      },
      // S4/D8: la suspensión de plataforma quita todos los permisos aunque la membresía siga activa.
      {
        nombre: "un gerente suspendido globalmente (persona.activo_global = false)",
        armar: async (e) => {
          await dueno.query("update persona set activo_global = false where id = $1", [e.gerente]);
          return e.ctx;
        },
      },
      {
        nombre: "un administrador activo suspendido globalmente",
        armar: async (e) => {
          const admin = await miembro(e, "ADMINISTRADOR");
          await dueno.query("update persona set activo_global = false where id = $1", [admin.id]);
          return admin.ctx;
        },
      },
    ];

    for (const actor of actores) {
      it(`${actor.nombre} no puede invitar, reenviar ni apagar: SIN_PERMISO y nada escrito`, async () => {
        const e = await escenario();
        const p = await miembro(e, "OPERADOR");
        const vieja = await invitar(e);
        const ctx = await actor.armar(e);
        const antes = await foto([e.empresa]);

        expect(
          await casos.invitarUsuario(ctx, {
            email: emailAlAzar(),
            rol: "OPERADOR",
            sucursales: [],
          }),
        ).toEqual({
          ok: false,
          error: "SIN_PERMISO",
        });
        expect(
          await casos.reenviarInvitacion(ctx, { invitacionId: invitacionId(vieja.id) }),
        ).toEqual({
          ok: false,
          error: "SIN_PERMISO",
        });
        expect(await casos.apagarMembresia(ctx, { personaId: p.id })).toEqual({
          ok: false,
          error: "SIN_PERMISO",
        });
        expect(await foto([e.empresa])).toBe(antes);
      });
    }

    it("la suspensión global se lee en cada operación: al levantarla vuelve a poder, sin nada guardado", async () => {
      const e = await escenario();
      const entrada = { email: emailAlAzar(), rol: "OPERADOR", sucursales: [] } as const;
      expect((await casos.invitarUsuario(e.ctx, entrada)).ok).toBe(true);

      await dueno.query("update persona set activo_global = false where id = $1", [e.gerente]);
      expect(await casos.invitarUsuario(e.ctx, { ...entrada, email: emailAlAzar() })).toEqual({
        ok: false,
        error: "SIN_PERMISO",
      });

      await dueno.query("update persona set activo_global = true where id = $1", [e.gerente]);
      expect((await casos.invitarUsuario(e.ctx, { ...entrada, email: emailAlAzar() })).ok).toBe(
        true,
      );
    });

    it("una baja corta el acceso en la operación siguiente (los permisos no se guardan en sesión)", async () => {
      const e = await escenario();
      const admin = await miembro(e, "ADMINISTRADOR");
      const entrada = { email: emailAlAzar(), rol: "OPERADOR", sucursales: [] } as const;
      expect((await casos.invitarUsuario(admin.ctx, entrada)).ok).toBe(true);

      expect((await casos.apagarMembresia(e.ctx, { personaId: admin.id })).ok).toBe(true);

      expect(await casos.invitarUsuario(admin.ctx, { ...entrada, email: emailAlAzar() })).toEqual({
        ok: false,
        error: "SIN_PERMISO",
      });
    });

    it("un administrador activo sí puede (no hace falta ser gerente)", async () => {
      const e = await escenario();
      const admin = await miembro(e, "ADMINISTRADOR");
      const r = await casos.invitarUsuario(admin.ctx, {
        email: emailAlAzar(),
        rol: "OPERADOR",
        sucursales: [],
      });
      expect(r.ok).toBe(true);
    });
  });

  // =============================================================================================
  // D5: todo o nada con varias empresas
  // =============================================================================================
  describe("D5: una invitación a tres empresas, con una que no opera, no deja ninguna membresía", () => {
    it("con una empresa suspendida: EMPRESA_NO_OPERA y ninguna membresía, ni persona, ni auditoría", async () => {
      const e1 = await escenario();
      const e2 = await escenario(e1.tenant);
      const e3 = await escenario(e1.tenant);
      const s1 = e1.sucursal;
      const { inv, email, token } = await invitacionMultiempresa([
        { e: e1, rol: "OPERADOR", sucursales: [s1] },
        { e: e2, rol: "ADMINISTRADOR" },
        { e: e3, rol: "OPERADOR" },
      ]);
      await suspenderEmpresa(e2.empresa);
      const empresas = [e1.empresa, e2.empresa, e3.empresa];
      const antes = await foto(empresas, [email]);

      const r = await aceptar(token, email);
      expect(r).toEqual({
        ok: false,
        error: { codigo: "EMPRESA_NO_OPERA", empresaId: e2.empresa, motivo: "EMPRESA_SUSPENDIDA" },
      });
      expect(await foto(empresas, [email])).toBe(antes);
      expect(await invitacion(inv.id)).toMatchObject({ estado: "PENDIENTE" });
      expect(
        await contar(
          "select count(*) as n from membresia where empresa_id = any($1) and rol <> 'GERENTE'",
          [empresas],
        ),
      ).toBe(0);

      // Cuando la empresa vuelve a operar, la MISMA invitación se acepta en las tres.
      await dueno.query(
        "update empresa set estado = 'ACTIVE', motivo_estado = null where id = $1",
        [e2.empresa],
      );
      const ok = await aceptar(token, email);
      expect(ok.ok && ok.valor.empresas.map((x) => x.empresaId).sort()).toEqual(
        [...empresas].sort(),
      );
      expect(
        await contar(
          "select count(*) as n from membresia where empresa_id = any($1) and rol <> 'GERENTE'",
          [empresas],
        ),
      ).toBe(3);
    });

    it("con las tres operando, la aceptación crea las tres membresías y una auditoría por empresa", async () => {
      const e1 = await escenario();
      const e2 = await escenario(e1.tenant);
      const e3 = await escenario(e1.tenant);
      const { email, token } = await invitacionMultiempresa([
        { e: e1, rol: "OPERADOR", sucursales: [e1.sucursal] },
        { e: e2, rol: "ADMINISTRADOR", sucursales: [e2.sucursal] },
        { e: e3, rol: "OPERADOR" },
      ]);
      const r = await aceptar(token, email);
      expect(r.ok).toBe(true);
      const persona = (await personaPorEmail(email))?.["id"] as string;
      expect(
        await filas(
          "select empresa_id, rol from membresia where persona_id = $1 order by rol, empresa_id",
          [persona],
        ),
      ).toHaveLength(3);
      for (const e of [e1, e2, e3]) {
        expect(await auditoria(e.empresa, "INVITACION_ACEPTADA")).toHaveLength(1);
      }
      expect(
        await contar("select count(*) as n from asignacion_sucursal where persona_id = $1", [
          persona,
        ]),
      ).toBe(2);
    });
  });

  // =============================================================================================
  // Guardas de seguridad que no dependen del escenario
  // =============================================================================================
  describe("seguridad", () => {
    it("el token no se registra en ninguna tabla que tocan los casos de uso", async () => {
      const e = await escenario();
      const { email, token, id } = await invitar(e);
      await aceptar(token, email);
      const vieja = await invitar(e);
      await casos.reenviarInvitacion(e.ctx, { invitacionId: invitacionId(vieja.id) });
      const volcado = JSON.stringify({
        invitaciones: await filas(
          "select * from invitacion where id in (select invitacion_id from invitacion_empresa where empresa_id = $1)",
          [e.empresa],
        ),
        trabajos: await trabajos(e.empresa),
        auditoria: await auditoria(e.empresa),
        membresias: await filas("select * from membresia where empresa_id = $1", [e.empresa]),
      });
      for (const t of [token, vieja.token, tokens.derivar(invitacionId(id))]) {
        expect(volcado).not.toContain(t);
      }
    });

    it("quien llega con el token de una invitación no puede aceptar la de otro token (el hash es la llave)", async () => {
      const e = await escenario();
      const a = await invitar(e);
      const b = await invitar(e);
      // Con el token de A y el email de B no se acepta nada.
      expect(await aceptar(a.token, b.email)).toEqual({
        ok: false,
        error: "INVITACION_DE_OTRO_EMAIL",
      });
      expect(await invitacion(b.id)).toMatchObject({ estado: "PENDIENTE" });
    });
  });
});
