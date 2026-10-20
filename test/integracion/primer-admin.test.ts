import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearPrimerAdmin } from "../../src/adaptadores/postgres/primer-admin";
import {
  crearBaseAparte,
  crearEmpresaActiva,
  crearEmpresaEnAlta,
  crearEntornoDePrueba,
  type EmpresaDePrueba,
} from "./entorno";
import {
  crearInvitacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
  emailAlAzar,
  incluirEmpresa,
  revocarDeBase,
} from "./fixtures-identidad";
import { crearAdminDeBase } from "./plataforma-apoyo";

/**
 * `crearPrimerAdmin` (H5 P7) contra una base real: siembra al primer administrador con la cadena del dueño,
 * es idempotente, aplica el invariante F5 (ninguna membresía ni invitación pendiente), deja UNA constancia y
 * resiste dos siembras simultáneas del mismo email.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const emailDeAdmin = () => emailAlAzar("primer-admin");

describe.skipIf(base === null)("crear el primer administrador de plataforma", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let enAlta: EmpresaDePrueba;
  let activa: EmpresaDePrueba;

  beforeAll(async () => {
    if (base === null) return;
    // Base propia: los conteos globales de estas pruebas no se mezclan con los de otros archivos en paralelo.
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    const entorno = crearEntornoDePrueba(propia.base);
    enAlta = await crearEmpresaEnAlta(entorno);
    activa = await crearEmpresaActiva(entorno);
  });
  afterAll(async () => {
    await dueno.end();
    await propia.destruir();
  });

  const url = () => propia.base.dueno;

  const filasDeAdmin = async (email: string) =>
    (
      await dueno.query<{ id: string; rol: string; activo: boolean; email: string }>(
        "select id, rol, activo, email from admin_plataforma where email = $1",
        [email.trim().toLowerCase()],
      )
    ).rows;

  const constancias = async (adminId: string) =>
    (
      await dueno.query<{ actor: string; accion: string; entidad: string; despues: unknown }>(
        "select actor, accion, entidad, despues from auditoria_plataforma where entidad = 'admin_plataforma' and entidad_id = $1",
        [adminId],
      )
    ).rows;

  const cantidadDeAdmins = async () =>
    Number(
      (await dueno.query<{ n: string }>("select count(*)::int as n from admin_plataforma")).rows[0]
        ?.n,
    );

  const cantidadDeConstancias = async () =>
    Number(
      (
        await dueno.query<{ n: string }>(
          "select count(*)::int as n from auditoria_plataforma where accion = 'ADMIN_PLATAFORMA_ALTA'",
        )
      ).rows[0]?.n,
    );

  it("siembra un ADMIN activo con el email normalizado y deja UNA constancia del sistema, sin el email", async () => {
    const email = emailDeAdmin();
    const r = await crearPrimerAdmin(url(), `  ${email.toUpperCase()} `);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.yaEstaba).toBe(false);
    expect(await filasDeAdmin(email)).toEqual([
      { id: r.valor.adminId, rol: "ADMIN", activo: true, email },
    ]);
    const filas = await constancias(r.valor.adminId);
    expect(filas).toEqual([
      {
        actor: "sistema",
        accion: "ADMIN_PLATAFORMA_ALTA",
        entidad: "admin_plataforma",
        despues: { rol: "ADMIN", origen: "script crear-primer-admin" },
      },
    ]);
    expect(JSON.stringify(filas)).not.toContain(email.split("@")[0]);
  });

  it("repetirlo no duplica ni falla: dice que ya estaba, con el mismo identificador, y no audita de nuevo", async () => {
    const email = emailDeAdmin();
    const primera = await crearPrimerAdmin(url(), email);
    const antes = await cantidadDeConstancias();
    const segunda = await crearPrimerAdmin(url(), email.toUpperCase());
    expect(primera.ok && segunda.ok).toBe(true);
    if (!primera.ok || !segunda.ok) return;
    expect(segunda.valor).toEqual({ adminId: primera.valor.adminId, yaEstaba: true });
    expect(await filasDeAdmin(email)).toHaveLength(1);
    expect(await constancias(primera.valor.adminId)).toHaveLength(1);
    expect(await cantidadDeConstancias()).toBe(antes);
  });

  it.each(["", "   ", "sin-arroba", "@dominio.test", "usuario@", "con espacio@dominio.test"])(
    "el email «%s» se rechaza sin tocar la red ni la base",
    async (email) => {
      const antes = await cantidadDeAdmins();
      // Una cadena que no conecta: si intentara abrir la conexión, fallaría con otro error.
      const r = await crearPrimerAdmin("postgres://nadie:nada@127.0.0.1:1/ninguna", email);
      expect(r).toEqual({ ok: false, error: "EMAIL_INVALIDO" });
      expect(await cantidadDeAdmins()).toBe(antes);
    },
  );

  describe("invariante F5: un administrador no tiene membresías ni invitaciones pendientes", () => {
    async function rechazaSinTocarNada(email: string, motivo: string) {
      const admins = await cantidadDeAdmins();
      const constanciasAntes = await cantidadDeConstancias();
      expect(await crearPrimerAdmin(url(), email)).toEqual({ ok: false, error: motivo });
      expect(await filasDeAdmin(email)).toEqual([]);
      expect(await cantidadDeAdmins()).toBe(admins);
      expect(await cantidadDeConstancias()).toBe(constanciasAntes);
    }

    it.each([
      ["GERENTE", true],
      ["OPERADOR", true],
      ["ADMINISTRADOR", true],
      ["OPERADOR", false],
    ] as const)("una membresía de rol %s (activa: %s) lo impide", async (rol, activo) => {
      const persona = await crearPersonaDeBase(dueno, emailDeAdmin());
      await crearMembresiaDeBase(dueno, activa.empresa, persona.id, rol, activo);
      await rechazaSinTocarNada(persona.email, "ADMIN_CON_MEMBRESIA");
      // El email con otra capitalización es el mismo email.
      await rechazaSinTocarNada(persona.email.toUpperCase(), "ADMIN_CON_MEMBRESIA");
    });

    it("ser propietario de un grupo (membresía de tenant) también lo impide", async () => {
      const persona = await crearPersonaDeBase(dueno, emailDeAdmin());
      await dueno.query(
        "insert into membresia_tenant (persona_id, tenant_id, rol, activo) values ($1, $2, 'PROPIETARIO', false)",
        [persona.id, activa.tenant],
      );
      await rechazaSinTocarNada(persona.email, "ADMIN_CON_MEMBRESIA");
    });

    it("una invitación pendiente de alta de gerente lo impide", async () => {
      const email = emailDeAdmin();
      const invitacion = await crearInvitacionDeBase(dueno, {
        tenant: enAlta.tenant,
        tipo: "ALTA_GERENTE",
        email,
      });
      await incluirEmpresa(dueno, invitacion, enAlta.empresa, "GERENTE");
      await rechazaSinTocarNada(email, "ADMIN_CON_INVITACION_PENDIENTE");
    });

    it("una invitación pendiente de usuario también, aunque esté vencida", async () => {
      const email = emailDeAdmin();
      const pasado = new Date(Date.now() - 10 * 86_400_000);
      const invitacion = await crearInvitacionDeBase(dueno, {
        tenant: activa.tenant,
        tipo: "USUARIO",
        email,
        emitidaEn: new Date(pasado.getTime() - 86_400_000),
        venceEn: pasado,
      });
      await incluirEmpresa(dueno, invitacion, activa.empresa, "OPERADOR");
      await rechazaSinTocarNada(email, "ADMIN_CON_INVITACION_PENDIENTE");
    });

    it("una invitación ya revocada no lo impide", async () => {
      const email = emailDeAdmin();
      const invitacion = await crearInvitacionDeBase(dueno, {
        tenant: activa.tenant,
        tipo: "USUARIO",
        email,
      });
      await incluirEmpresa(dueno, invitacion, activa.empresa, "OPERADOR");
      await revocarDeBase(dueno, invitacion);
      const r = await crearPrimerAdmin(url(), email);
      expect(r.ok && r.valor.yaEstaba).toBe(false);
    });

    it("una persona sin ninguna membresía ni invitación sí puede ser administrador", async () => {
      const persona = await crearPersonaDeBase(dueno, emailDeAdmin());
      const r = await crearPrimerAdmin(url(), persona.email);
      expect(r.ok && r.valor.yaEstaba).toBe(false);
    });

    it("la segunda barrera: el disparador de la base rechaza el alta aunque el chequeo del código no lo viera", async () => {
      const persona = await crearPersonaDeBase(dueno, emailDeAdmin());
      await crearMembresiaDeBase(dueno, activa.empresa, persona.id, "OPERADOR");
      await expect(
        dueno.query("insert into admin_plataforma (email, rol) values ($1, 'ADMIN')", [
          persona.email,
        ]),
      ).rejects.toMatchObject({ constraint: "admin_plataforma_sin_membresia" });
    });
  });

  describe("un administrador que ya existe pero no es ADMIN activo no se toca", () => {
    it.each([
      ["un SOPORTE", { rol: "SOPORTE", activo: true }],
      ["un ADMIN dado de baja", { rol: "ADMIN", activo: false }],
    ] as const)("%s", async (_cual, estado) => {
      const email = emailDeAdmin();
      const existente = await crearAdminDeBase(dueno, { ...estado, email });
      const constanciasAntes = await cantidadDeConstancias();
      expect(await crearPrimerAdmin(url(), email)).toEqual({
        ok: false,
        error: "ADMIN_EXISTENTE_NO_ES_ADMIN_ACTIVO",
      });
      expect(await filasDeAdmin(email)).toEqual([
        { id: existente.id, rol: estado.rol, activo: estado.activo, email },
      ]);
      expect(await cantidadDeConstancias()).toBe(constanciasAntes);
    });
  });

  describe("concurrencia: dos siembras simultáneas del mismo email", () => {
    it.each([2, 6])(
      "%s siembras a la vez dejan UN administrador y UNA constancia; una crea y las demás dicen que ya estaba",
      async (cuantas) => {
        const email = emailDeAdmin();
        const resultados = await Promise.all(
          Array.from({ length: cuantas }, (_, i) =>
            crearPrimerAdmin(url(), i % 2 === 0 ? email : email.toUpperCase()),
          ),
        );
        expect(resultados.every((r) => r.ok)).toBe(true);
        const validos = resultados.flatMap((r) => (r.ok ? [r.valor] : []));
        expect(validos.filter((v) => !v.yaEstaba)).toHaveLength(1);
        expect(new Set(validos.map((v) => v.adminId)).size).toBe(1);
        const filas = await filasDeAdmin(email);
        expect(filas).toHaveLength(1);
        expect(await constancias(filas[0]?.id as string)).toHaveLength(1);
      },
    );

    it("varias rondas con emails distintos a la vez no se pisan entre sí", async () => {
      const emails = Array.from({ length: 4 }, emailDeAdmin);
      const resultados = await Promise.all(
        emails.flatMap((email) => [crearPrimerAdmin(url(), email), crearPrimerAdmin(url(), email)]),
      );
      expect(resultados.every((r) => r.ok)).toBe(true);
      for (const email of emails) expect(await filasDeAdmin(email)).toHaveLength(1);
    });
  });

  it("falla con una cadena que no conecta, sin dejar nada", async () => {
    const antes = await cantidadDeAdmins();
    const cadena = `postgres://usuario:${randomBytes(6).toString("hex")}@127.0.0.1:1/base`;
    await expect(crearPrimerAdmin(cadena, emailDeAdmin())).rejects.toBeInstanceOf(Error);
    expect(await cantidadDeAdmins()).toBe(antes);
  });
});
