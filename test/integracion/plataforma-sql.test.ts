import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  firmarCarga,
  instalarClaveDeContexto,
  type CargaDeContexto,
} from "../../src/adaptadores/postgres/contexto-firmado";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import { TRABAJO_ENVIAR_INVITACION } from "../../src/modulos/identidad/publico";
import { ok } from "../../src/primitivas/resultado/resultado";
import { ADMIN_DE_PRUEBA, EMAIL_DE_ADMIN_DE_PRUEBA, SOPORTE_DE_PRUEBA } from "./admins-de-prueba";
import {
  comoPlataforma,
  crearBaseAparte,
  crearEmpresaActiva,
  crearEmpresaEnAlta,
  crearEntornoDePrueba,
  crearPropietario,
  cuitAlAzar,
  nombreAlAzar,
  type EmpresaDePrueba,
} from "./entorno";
import {
  crearInvitacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
  emailAlAzar,
  incluirEmpresa,
  tokenAlAzar,
  type InvitacionDePrueba,
} from "./fixtures-identidad";

/**
 * H5 plataforma, tramo P2: la migración 0004 contra una base real. Qué prueba, en cuatro bloques:
 *  1. Catálogo: lo que la base DECLARA (tablas, columnas, políticas exactas, funciones, privilegios).
 *  2. Aislamiento por rol de base: quién ve y escribe qué, con conexiones reales de cada rol.
 *  3. El actor firmado: quién puede hacer qué según el claim `a` (ADMIN, SOPORTE, `sistema`, un
 *     administrador dado de baja, un id desconocido, sin token, token ajeno, vencido o adulterado).
 *  4. Las restricciones de las tablas nuevas (aun para el dueño de la base).
 * Las conexiones son directas por `pg` con el rol real: no pasan por el adaptador.
 */

const base = inject("baseDePruebas");

const PLATAFORMA = "zuluhub_plataforma";
const ROLES = [
  "zuluhub_app",
  "zuluhub_grupo",
  "zuluhub_trabajos",
  "zuluhub_plataforma",
  "zuluhub_autenticacion",
] as const;
const TABLAS_NUEVAS = [
  "admin_plataforma",
  "idempotencia_plataforma",
  "referencia_de_error",
] as const;

/** Lo que la plataforma puede leer (con una o con todas las columnas). */
const TABLAS_LEGIBLES = [
  "admin_plataforma",
  "auditoria_plataforma",
  "empresa",
  "idempotencia_plataforma",
  "instalacion",
  "invitacion",
  "invitacion_empresa",
  "membresia",
  "membresia_tenant",
  "persona",
  "referencia_de_error",
  "tenant",
  "trabajo",
] as const;

/** Datos operativos: la plataforma no los lee, con ningún actor. */
const TABLAS_OPERATIVAS = [
  "sucursal",
  "asignacion_sucursal",
  "invitacion_sucursal",
  "auditoria_empresa",
  "auditoria_acceso_grupo",
  "contexto_clave",
] as const;

const ahoraEnS = () => Math.floor(Date.now() / 1000);

// ---- tokens firmados ---------------------------------------------------------------------------

/** Una carga de plataforma vigente 5 minutos, a nombre del ADMIN sembrado, con lo que se le pase. */
const carga = (cambios: Partial<CargaDeContexto> = {}): CargaDeContexto => ({
  u: PLATAFORMA,
  e: null,
  t: null,
  p: null,
  i: null,
  x: ahoraEnS() + 300,
  a: ADMIN_DE_PRUEBA,
  ...cambios,
});
const tokenDe = (actor: string | null, cambios: Partial<CargaDeContexto> = {}): string =>
  firmarCarga(base!.clave, carga({ a: actor, ...cambios }));

/** Firma con la clave real un payload arbitrario (sin pasar por `CargaDeContexto`). */
function firmarPayload(payload: Record<string, unknown>): string {
  const cuerpo = `v1.${base!.clave.kid}.${Buffer.from(JSON.stringify(payload), "utf8").toString("hex")}`;
  const mac = createHmac("sha256", base!.clave.secreto).update(cuerpo).digest("hex");
  return `${cuerpo}.${mac}`;
}

// ---- sesiones con el rol real --------------------------------------------------------------------

type Intento =
  | { ok: true; filas: number; rows: Record<string, unknown>[] }
  | { ok: false; codigo: string; restriccion: string | undefined; mensaje: string };

class Sesion {
  constructor(private readonly cliente: pg.Client) {}

  /** Una sentencia dentro de un savepoint: un error no aborta la sesión. */
  async intentar(texto: string, parametros: unknown[] = []): Promise<Intento> {
    await this.cliente.query("savepoint intento");
    try {
      const r = await this.cliente.query(texto, parametros);
      await this.cliente.query("release savepoint intento");
      return { ok: true, filas: r.rowCount ?? 0, rows: r.rows as Record<string, unknown>[] };
    } catch (error) {
      await this.cliente.query("rollback to savepoint intento");
      const e = error as { code?: string; constraint?: string; message?: string };
      return {
        ok: false,
        codigo: e.code ?? "?",
        restriccion: e.constraint,
        mensaje: e.message ?? "",
      };
    }
  }

  /** Cuántas filas ve de una tabla (o -1 si la base no lo deja). */
  async contar(tabla: string): Promise<number> {
    const r = await this.intentar(`select count(*)::int as n from ${tabla}`);
    return r.ok ? Number(r.rows[0]?.["n"]) : -1;
  }

  async actor(): Promise<string | null> {
    const r = await this.intentar("select app_actor_plataforma() as a");
    if (!r.ok) throw new Error(`app_actor_plataforma(): ${r.mensaje}`);
    return (r.rows[0]?.["a"] as string | null) ?? null;
  }
}

/** Una sesión con `url` y, si hay, ese token; todo se deshace al terminar. */
async function conSesion<T>(
  url: string,
  token: string | null,
  trabajo: (s: Sesion) => Promise<T>,
): Promise<T> {
  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();
  try {
    await cliente.query("begin");
    if (token !== null) await cliente.query("select set_config('app.ctx', $1, true)", [token]);
    return await trabajo(new Sesion(cliente));
  } finally {
    await cliente.query("rollback").catch(() => undefined);
    await cliente.end();
  }
}
const comoPlat = <T>(token: string | null, trabajo: (s: Sesion) => Promise<T>) =>
  conSesion(base!.plataforma, token, trabajo);

/** Una sola sentencia con un token de plataforma. */
const unaVez = (token: string | null, texto: string, parametros: unknown[] = []) =>
  comoPlat(token, (s) => s.intentar(texto, parametros));

function esperarRechazo(r: Intento, codigos: readonly string[] = ["42501"]): void {
  expect(r.ok, "tenía que rechazarse").toBe(false);
  if (!r.ok) expect(codigos, r.mensaje).toContain(r.codigo);
}
const esperarFilas = (r: Intento, n: number) => {
  expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);
  if (r.ok) expect(r.filas).toBe(n);
};

describe.skipIf(base === null)("plataforma: la migración 0004 contra una base real", () => {
  let dueno: pg.Client;
  let entorno: ReturnType<typeof crearEntornoDePrueba>;
  let activa: EmpresaDePrueba;
  let enAlta: EmpresaDePrueba;
  let propietario: string;
  let altaPendiente: InvitacionDePrueba;
  let usuarioPendiente: InvitacionDePrueba;
  let personaMiembro: string;
  const OTRO_ADMIN = randomUUID();
  const ADMIN_DE_BAJA = randomUUID();
  const DESCONOCIDO = randomUUID();

  const filas = async <T extends Record<string, unknown>>(
    texto: string,
    parametros: unknown[] = [],
  ) => (await dueno.query<T>(texto, parametros)).rows;

  beforeAll(async () => {
    if (base === null) return;
    dueno = new pg.Client({ connectionString: base.dueno });
    await dueno.connect();
    entorno = crearEntornoDePrueba(base);
    activa = await crearEmpresaActiva(entorno);
    enAlta = await crearEmpresaEnAlta(entorno);
    propietario = await crearPropietario(entorno, activa.tenant);
    const miembro = await crearPersonaDeBase(dueno);
    personaMiembro = miembro.id;
    await crearMembresiaDeBase(dueno, activa.empresa, miembro.id, "GERENTE");
    altaPendiente = await crearInvitacionDeBase(dueno, {
      tenant: enAlta.tenant,
      tipo: "ALTA_GERENTE",
    });
    await incluirEmpresa(dueno, altaPendiente, enAlta.empresa, "GERENTE");
    usuarioPendiente = await crearInvitacionDeBase(dueno, { tenant: activa.tenant });
    await incluirEmpresa(dueno, usuarioPendiente, activa.empresa, "OPERADOR");
    await dueno.query(
      `insert into admin_plataforma (id, email, rol, activo) values
         ($1, $2, 'ADMIN', true), ($3, $4, 'ADMIN', false)`,
      [OTRO_ADMIN, emailAlAzar("otro-admin"), ADMIN_DE_BAJA, emailAlAzar("admin-de-baja")],
    );
    // Una fila en cada tabla que la plataforma lee: así "0 filas" no se cumple por vacío.
    await dueno.query(
      `insert into auditoria_plataforma (actor, accion, entidad, entidad_id)
       values ($1, 'PRUEBA', 'tenant', 'x')`,
      [ADMIN_DE_PRUEBA],
    );
    await dueno.query(
      `insert into trabajo (empresa_id, tipo, clave_idempotencia) values ($1, 'mantenimiento', $2)`,
      [activa.empresa, nombreAlAzar("clave-trabajo")],
    );
    await dueno.query(
      `insert into idempotencia_plataforma (admin_id, clave, operacion, huella, resultado)
       values ($1, $2, 'empresas.alta', $3, '{}'::jsonb)`,
      [ADMIN_DE_PRUEBA, randomBytes(12).toString("hex"), "ab".repeat(32)],
    );
    await dueno.query(
      `insert into referencia_de_error (referencia, accion, motivo) values ('ZH-ABCD-1234', 'usuarios.invitar', 'SIN_PERMISO')`,
    );
  });
  afterAll(async () => {
    await entorno.cerrar();
    await dueno.end();
  });

  // ===========================================================================================
  // 1. Catálogo
  // ===========================================================================================
  describe("catálogo", () => {
    it("las tablas nuevas existen con exactamente estas columnas", async () => {
      const columnasDe = async (tabla: string) =>
        (
          await filas<{ column_name: string }>(
            `select column_name from information_schema.columns
             where table_schema = 'public' and table_name = $1 order by ordinal_position`,
            [tabla],
          )
        ).map((c) => c.column_name);
      expect(await columnasDe("admin_plataforma")).toEqual([
        "id",
        "email",
        "rol",
        "activo",
        "creado_en",
        "actualizado_en",
        "version",
      ]);
      expect(await columnasDe("idempotencia_plataforma")).toEqual([
        "admin_id",
        "clave",
        "operacion",
        "huella",
        "resultado",
        "creado_en",
      ]);
      expect(await columnasDe("referencia_de_error")).toEqual([
        "id",
        "referencia",
        "accion",
        "motivo",
        "empresa_id",
        "persona_id",
        "creado_en",
      ]);
    });

    it("RLS activo y forzado en las tablas nuevas, sin privilegios para PUBLIC y con la clave foránea a empresa", async () => {
      const tablas = await filas<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `select relname, relrowsecurity, relforcerowsecurity from pg_class
         where relnamespace = 'public'::regnamespace and relname = any($1) order by 1`,
        [[...TABLAS_NUEVAS]],
      );
      expect(tablas.map((t) => t.relname)).toEqual([...TABLAS_NUEVAS].sort());
      for (const t of tablas) {
        expect(t.relrowsecurity, `${t.relname}: RLS activo`).toBe(true);
        expect(t.relforcerowsecurity, `${t.relname}: RLS forzado`).toBe(true);
      }
      expect(
        await filas(
          `select 1 from information_schema.table_privileges
           where table_schema = 'public' and grantee = 'PUBLIC' and table_name = any($1)`,
          [[...TABLAS_NUEVAS]],
        ),
      ).toEqual([]);
      const fk = await filas<{ conname: string }>(
        `select conname from pg_constraint
         where conrelid = 'public.referencia_de_error'::regclass and contype = 'f' order by 1`,
      );
      expect(fk.map((f) => f.conname)).toEqual([
        "referencia_de_error_empresa_id_fkey",
        "referencia_de_error_persona_id_fkey",
      ]);
    });

    it("las políticas del rol de plataforma son exactamente estas (una abierta de más sumaría acceso)", async () => {
      const politicas = await filas<{ p: string }>(
        `select format('%s.%s:%s:%s', tablename, policyname, cmd, permissive) as p
         from pg_policies where schemaname = 'public' and 'zuluhub_plataforma' = any (roles)
         order by 1`,
      );
      expect(politicas.map((f) => f.p).sort()).toEqual(
        [
          // tablas nuevas (permisivas, con la condición del actor dentro)
          "admin_plataforma.admin_plataforma_plataforma_leer:SELECT:PERMISSIVE",
          "idempotencia_plataforma.idempotencia_plataforma_alta:INSERT:PERMISSIVE",
          "idempotencia_plataforma.idempotencia_plataforma_leer:SELECT:PERMISSIVE",
          "referencia_de_error.referencia_de_error_plataforma_alta:INSERT:PERMISSIVE",
          "referencia_de_error.referencia_de_error_plataforma_leer:SELECT:PERMISSIVE",
          "membresia.membresia_plataforma_leer:SELECT:PERMISSIVE",
          // 0001 y 0002 (permisivas, sin cambios)
          "auditoria_empresa.auditoria_empresa_plataforma_alta:INSERT:PERMISSIVE",
          "auditoria_plataforma.auditoria_plataforma_alta:INSERT:PERMISSIVE",
          "auditoria_plataforma.auditoria_plataforma_leer:SELECT:PERMISSIVE",
          "empresa.empresa_plataforma_alta:INSERT:PERMISSIVE",
          "empresa.empresa_plataforma_cambiar:UPDATE:PERMISSIVE",
          "empresa.empresa_plataforma_leer:SELECT:PERMISSIVE",
          "instalacion.instalacion_plataforma:SELECT:PERMISSIVE",
          "invitacion.invitacion_plataforma_alta:INSERT:PERMISSIVE",
          "invitacion.invitacion_plataforma_cambiar:UPDATE:PERMISSIVE",
          "invitacion.invitacion_plataforma_leer:SELECT:PERMISSIVE",
          "invitacion_empresa.invitacion_empresa_plataforma_alta:INSERT:PERMISSIVE",
          "invitacion_empresa.invitacion_empresa_plataforma_leer:SELECT:PERMISSIVE",
          "membresia_tenant.membresia_tenant_plataforma_alta:INSERT:PERMISSIVE",
          "membresia_tenant.membresia_tenant_plataforma_cambiar:UPDATE:PERMISSIVE",
          "membresia_tenant.membresia_tenant_plataforma_leer:SELECT:PERMISSIVE",
          "persona.persona_plataforma_alta:INSERT:PERMISSIVE",
          "persona.persona_plataforma_cambiar:UPDATE:PERMISSIVE",
          "persona.persona_plataforma_leer:SELECT:PERMISSIVE",
          "sucursal.sucursal_plataforma_sembrar:INSERT:PERMISSIVE",
          "tenant.tenant_plataforma_alta:INSERT:PERMISSIVE",
          "tenant.tenant_plataforma_cambiar:UPDATE:PERMISSIVE",
          "tenant.tenant_plataforma_leer:SELECT:PERMISSIVE",
          "trabajo.trabajo_plataforma_alta:INSERT:PERMISSIVE",
          "trabajo.trabajo_plataforma_leer:SELECT:PERMISSIVE",
          // 0004 (restrictivas: se suman con AND)
          "auditoria_empresa.auditoria_empresa_plataforma_admin:INSERT:RESTRICTIVE",
          "auditoria_plataforma.auditoria_plataforma_actor_firmado:INSERT:RESTRICTIVE",
          "auditoria_plataforma.auditoria_plataforma_con_actor:SELECT:RESTRICTIVE",
          "empresa.empresa_plataforma_admin_alta:INSERT:RESTRICTIVE",
          "empresa.empresa_plataforma_con_actor:SELECT:RESTRICTIVE",
          "empresa.empresa_plataforma_quien_cambia:UPDATE:RESTRICTIVE",
          "instalacion.instalacion_plataforma_con_actor:SELECT:RESTRICTIVE",
          "invitacion.invitacion_plataforma_con_actor:SELECT:RESTRICTIVE",
          "invitacion.invitacion_plataforma_quien_cambia:UPDATE:RESTRICTIVE",
          "invitacion.invitacion_plataforma_quien_emite:INSERT:RESTRICTIVE",
          "invitacion_empresa.invitacion_empresa_plataforma_con_actor:SELECT:RESTRICTIVE",
          "invitacion_empresa.invitacion_empresa_plataforma_quien_emite:INSERT:RESTRICTIVE",
          "membresia.membresia_plataforma_con_actor:SELECT:RESTRICTIVE",
          "membresia_tenant.membresia_tenant_plataforma_admin_alta:INSERT:RESTRICTIVE",
          "membresia_tenant.membresia_tenant_plataforma_admin_cambiar:UPDATE:RESTRICTIVE",
          "membresia_tenant.membresia_tenant_plataforma_con_actor:SELECT:RESTRICTIVE",
          "persona.persona_plataforma_admin_alta:INSERT:RESTRICTIVE",
          "persona.persona_plataforma_admin_cambiar:UPDATE:RESTRICTIVE",
          "persona.persona_plataforma_con_actor:SELECT:RESTRICTIVE",
          "sucursal.sucursal_plataforma_admin_alta:INSERT:RESTRICTIVE",
          "tenant.tenant_plataforma_admin_alta:INSERT:RESTRICTIVE",
          "tenant.tenant_plataforma_admin_cambiar:UPDATE:RESTRICTIVE",
          "tenant.tenant_plataforma_con_actor:SELECT:RESTRICTIVE",
          "trabajo.trabajo_plataforma_con_actor:SELECT:RESTRICTIVE",
          "trabajo.trabajo_plataforma_quien_encola:INSERT:RESTRICTIVE",
        ].sort(),
      );
    });

    it("las políticas de la aplicación y el grupo sobre las tablas nuevas son solo las de la referencia de error", async () => {
      const politicas = await filas<{ p: string }>(
        `select format('%s.%s:%s:%s:%s', tablename, policyname, cmd, permissive, array_to_string(roles, '+')) as p
         from pg_policies
         where schemaname = 'public' and tablename = any($1) and not ('zuluhub_plataforma' = any (roles))
         order by 1`,
        [[...TABLAS_NUEVAS]],
      );
      expect(politicas.map((f) => f.p).sort()).toEqual(
        [
          "referencia_de_error.referencia_de_error_app_alta:INSERT:PERMISSIVE:zuluhub_app",
          "referencia_de_error.referencia_de_error_grupo_alta:INSERT:PERMISSIVE:zuluhub_grupo",
          "referencia_de_error.referencia_de_error_invitado_alta:INSERT:PERMISSIVE:zuluhub_app",
        ].sort(),
      );
    });

    /**
     * La cobertura que exige el diseño: toda tabla que la plataforma lee tiene su restrictiva de
     * lectura, y toda tabla que escribe tiene la restrictiva del comando. Se recibe un cliente para
     * poder probar que el chequeo MUERDE sobre una base a la que se le quitó una política.
     */
    const coberturaFaltante = async (cliente: pg.Client): Promise<string[]> => {
      const consultar = async <T extends Record<string, unknown>>(texto: string) =>
        (await cliente.query<T>(texto)).rows;
      const faltan: string[] = [];
      // Tablas que la plataforma puede LEER (de la tabla entera o de alguna columna).
      const lee = await consultar<{ t: string }>(
        `select distinct table_name as t from information_schema.column_privileges
         where table_schema = 'public' and grantee = 'zuluhub_plataforma' and privilege_type = 'SELECT'`,
      );
      // Tablas y comandos que puede ESCRIBIR (INSERT o UPDATE de alguna columna).
      const escribe = await consultar<{ t: string; c: string }>(
        `select distinct table_name as t, privilege_type as c from information_schema.column_privileges
         where table_schema = 'public' and grantee = 'zuluhub_plataforma' and privilege_type in ('INSERT', 'UPDATE')`,
      );
      const politicas = await consultar<{
        t: string;
        c: string;
        restrictiva: boolean;
        texto: string;
      }>(
        `select tablename as t, cmd as c, permissive = 'RESTRICTIVE' as restrictiva,
                coalesce(qual, '') || ' ' || coalesce(with_check, '') as texto
         from pg_policies where schemaname = 'public' and 'zuluhub_plataforma' = any (roles)`,
      );
      const menciona = (texto: string) =>
        /app_actor_plataforma|plataforma_actor_vigente|admin_plataforma_con_rol/.test(texto);
      for (const { t } of lee) {
        const propias = politicas.filter((p) => p.t === t && p.c === "SELECT");
        const cubierta =
          propias.some((p) => p.restrictiva && menciona(p.texto)) ||
          // Las tablas nuevas llevan la condición del actor en su propia política permisiva.
          ((TABLAS_NUEVAS as readonly string[]).includes(t) &&
            propias.length > 0 &&
            propias.every((p) => !p.restrictiva && menciona(p.texto)));
        if (!cubierta) faltan.push(`${t}:SELECT`);
      }
      for (const { t, c } of escribe) {
        const propias = politicas.filter((p) => p.t === t && p.c === c);
        const cubierta =
          propias.some((p) => p.restrictiva && menciona(p.texto)) ||
          ((TABLAS_NUEVAS as readonly string[]).includes(t) &&
            propias.length > 0 &&
            propias.every((p) => !p.restrictiva && menciona(p.texto)));
        if (!cubierta) faltan.push(`${t}:${c}`);
      }
      return faltan.sort();
    };

    it("cada tabla que la plataforma lee o escribe tiene su política restrictiva con el actor", async () => {
      expect(await coberturaFaltante(dueno)).toEqual([]);
    });

    it(
      "el chequeo de cobertura muerde: detecta una restrictiva que falta",
      { timeout: 30_000 },
      async () => {
        if (base === null) return;
        const aparte = await crearBaseAparte(base);
        const cliente = new pg.Client({ connectionString: aparte.base.dueno });
        await cliente.connect();
        try {
          expect(await coberturaFaltante(cliente)).toEqual([]);
          await cliente.query("drop policy tenant_plataforma_con_actor on tenant");
          await cliente.query("drop policy empresa_plataforma_quien_cambia on empresa");
          await cliente.query(
            "drop policy invitacion_empresa_plataforma_quien_emite on invitacion_empresa",
          );
          await cliente.query("drop policy trabajo_plataforma_quien_encola on trabajo");
          await cliente.query(
            "drop policy referencia_de_error_plataforma_leer on referencia_de_error",
          );
          expect(await coberturaFaltante(cliente)).toEqual([
            "empresa:UPDATE",
            "invitacion_empresa:INSERT",
            "referencia_de_error:SELECT",
            "tenant:SELECT",
            "trabajo:INSERT",
          ]);
        } finally {
          await cliente.end();
          await aparte.destruir();
        }
      },
    );

    it("las políticas evalúan el actor una sola vez por sentencia: (SELECT f()), nunca la función suelta", async () => {
      const todas = await filas<{ policyname: string; texto: string }>(
        `select policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '') as texto
         from pg_policies
         where schemaname = 'public' and 'zuluhub_plataforma' = any (roles)
           and (coalesce(qual, '') || coalesce(with_check, '')) ~ '(app_actor_plataforma|admin_plataforma_con_rol|plataforma_actor_vigente)'`,
      );
      expect(todas.length).toBeGreaterThanOrEqual(25);
      for (const p of todas) {
        for (const f of [
          "app_actor_plataforma",
          "admin_plataforma_con_rol",
          "plataforma_actor_vigente",
        ]) {
          const total = (p.texto.match(new RegExp(`${f}\\(`, "g")) ?? []).length;
          const conSelect = (p.texto.match(new RegExp(`SELECT ${f}\\(`, "g")) ?? []).length;
          expect(conSelect, `${p.policyname} (${f})`).toBe(total);
        }
      }
    });

    it("las funciones del actor: search_path fijo, sin SECURITY DEFINER, estables y ejecutables solo por la plataforma", async () => {
      const funciones = await filas<{
        proname: string;
        prosecdef: boolean;
        provolatile: string;
        proconfig: string[] | null;
      }>(
        `select proname, prosecdef, provolatile, proconfig from pg_proc
         where pronamespace = 'public'::regnamespace
           and proname in ('app_actor_plataforma', 'admin_plataforma_con_rol', 'plataforma_actor_vigente',
                           'admin_plataforma_validar', 'admin_plataforma_no_se_borra')
         order by 1`,
      );
      expect(funciones.map((f) => f.proname)).toEqual([
        "admin_plataforma_con_rol",
        "admin_plataforma_no_se_borra",
        "admin_plataforma_validar",
        "app_actor_plataforma",
        "plataforma_actor_vigente",
      ]);
      for (const f of funciones) {
        expect(f.prosecdef, f.proname).toBe(false);
        expect(f.proconfig, f.proname).toContain("search_path=pg_catalog, public, pg_temp");
      }
      for (const nombre of [
        "app_actor_plataforma",
        "admin_plataforma_con_rol",
        "plataforma_actor_vigente",
      ]) {
        expect(funciones.find((f) => f.proname === nombre)?.provolatile, nombre).toBe("s");
      }
      for (const [firma, plataforma] of [
        ["app_actor_plataforma()", true],
        ["admin_plataforma_con_rol(text[])", true],
        ["plataforma_actor_vigente()", true],
        ["admin_plataforma_validar()", false],
        ["admin_plataforma_no_se_borra()", false],
      ] as const) {
        for (const rol of ROLES) {
          const { rows } = await dueno.query<{ puede: boolean }>(
            `select has_function_privilege($1, $2::regprocedure, 'EXECUTE') as puede`,
            [rol, `public.${firma}`],
          );
          expect(rows[0]?.puede, `${rol} ejecuta ${firma}`).toBe(plataforma && rol === PLATAFORMA);
        }
      }
    });

    it("contexto_firmado sigue siendo la única SECURITY DEFINER", async () => {
      const definer = await filas<{ proname: string }>(
        `select proname from pg_proc where pronamespace = 'public'::regnamespace and prosecdef order by 1`,
      );
      expect(definer.map((f) => f.proname)).toEqual(["contexto_firmado"]);
    });

    it("la plataforma lee exactamente 4 columnas de membresia, y ningún rol más las lee por columna", async () => {
      const columnas = await filas<{ grantee: string; column_name: string }>(
        `select grantee, column_name from information_schema.column_privileges
         where table_schema = 'public' and table_name = 'membresia' and privilege_type = 'SELECT'
           and grantee = any($1) order by 1, 2`,
        [[...ROLES]],
      );
      expect(columnas.filter((c) => c.grantee === PLATAFORMA).map((c) => c.column_name)).toEqual([
        "activo",
        "empresa_id",
        "persona_id",
        "rol",
      ]);
      // La aplicación sigue leyendo toda la tabla; nadie más.
      expect([
        ...new Set(columnas.filter((c) => c.grantee !== PLATAFORMA).map((c) => c.grantee)),
      ]).toEqual(["zuluhub_app"]);
    });

    it("lo que la plataforma puede leer, columna por columna, es exactamente esto (las tablas enteras más 4 de membresia)", async () => {
      const reales = await filas<{ t: string; c: string }>(
        `select table_name as t, column_name as c from information_schema.column_privileges
         where table_schema = 'public' and grantee = 'zuluhub_plataforma' and privilege_type = 'SELECT'
         order by 1, 2`,
      );
      const porTabla = new Map<string, string[]>();
      for (const { t, c } of reales) porTabla.set(t, [...(porTabla.get(t) ?? []), c]);
      expect([...porTabla.keys()].sort()).toEqual([...TABLAS_LEGIBLES].sort());
      for (const tabla of TABLAS_LEGIBLES) {
        if (tabla === "membresia") continue;
        const todas = await filas<{ column_name: string }>(
          `select column_name from information_schema.columns
           where table_schema = 'public' and table_name = $1 order by 1`,
          [tabla],
        );
        expect(porTabla.get(tabla), tabla).toEqual(todas.map((c) => c.column_name));
      }
    });

    it("el INSERT y el UPDATE de la plataforma sobre las tablas nuevas son los que corresponden (y ningún DELETE)", async () => {
      const permisos = await filas<{ grantee: string; t: string; c: string; p: string }>(
        `select grantee, table_name as t, column_name as c, privilege_type as p
         from information_schema.column_privileges
         where table_schema = 'public' and table_name = any($1) and grantee = any($2)
           and privilege_type in ('INSERT', 'UPDATE')
         order by 1, 2, 3`,
        [[...TABLAS_NUEVAS], [...ROLES]],
      );
      expect(permisos.map((p) => `${p.grantee}:${p.t}.${p.c}:${p.p}`).sort()).toEqual(
        [
          ...["admin_id", "clave", "operacion", "huella", "resultado"].map(
            (c) => `zuluhub_plataforma:idempotencia_plataforma.${c}:INSERT`,
          ),
          ...["referencia", "accion", "motivo", "empresa_id", "persona_id"].flatMap((c) =>
            ["zuluhub_app", "zuluhub_grupo", "zuluhub_plataforma"].map(
              (rol) => `${rol}:referencia_de_error.${c}:INSERT`,
            ),
          ),
        ].sort(),
      );
      // Nadie escribe `admin_plataforma`: la alta y la baja las hace el dueño con un script.
      expect(permisos.filter((p) => p.t === "admin_plataforma")).toEqual([]);
    });

    it("el SOPORTE solo encola envíos de invitación: la base nombra el mismo tipo que el código", async () => {
      const { rows } = await dueno.query<{ with_check: string }>(
        `select with_check from pg_policies where policyname = 'trabajo_plataforma_quien_encola'`,
      );
      expect(rows[0]?.with_check).toContain(`'${TRABAJO_ENVIAR_INVITACION}'`);
    });

    it("el quinto rol, zuluhub_autenticacion: sin superusuario, sin BYPASSRLS, sin pertenencias y con topes de tiempo", async () => {
      const [rol] = await filas<Record<string, unknown>>(
        `select rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication, rolinherit
         from pg_roles where rolname = 'zuluhub_autenticacion'`,
      );
      expect(rol).toMatchObject({
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolreplication: false,
        rolinherit: false,
      });
      expect(
        await filas(
          `select 1 from pg_auth_members m join pg_roles r on r.oid = m.member where r.rolname = 'zuluhub_autenticacion'`,
        ),
      ).toEqual([]);
      const [topes] = await filas<{ setconfig: string[] }>(
        `select s.setconfig from pg_db_role_setting s join pg_roles r on r.oid = s.setrole
         where s.setdatabase = 0 and r.rolname = 'zuluhub_autenticacion'`,
      );
      expect([...(topes?.setconfig ?? [])].sort()).toEqual([
        "idle_in_transaction_session_timeout=60s",
        "lock_timeout=15s",
        "statement_timeout=30s",
      ]);
      const { rows: temp } = await dueno.query<{ temp: boolean }>(
        `select has_database_privilege('zuluhub_autenticacion', current_database(), 'TEMP') as temp`,
      );
      expect(temp[0]?.temp).toBe(false);
      // No es dueño de nada.
      expect(
        await filas(
          `select 1 from pg_class c join pg_roles r on r.oid = c.relowner where r.rolname = 'zuluhub_autenticacion'`,
        ),
      ).toEqual([]);
    });

    it("el quinto rol no tiene NINGÚN privilegio sobre las tablas, columnas, funciones ni secuencias del esquema public", async () => {
      expect(
        await filas(
          `select 1 from information_schema.table_privileges where grantee = 'zuluhub_autenticacion'`,
        ),
      ).toEqual([]);
      expect(
        await filas(
          `select 1 from information_schema.column_privileges where grantee = 'zuluhub_autenticacion'`,
        ),
      ).toEqual([]);
      const tablas = await filas<{ t: string }>(
        `select c.relname as t from pg_class c where c.relnamespace = 'public'::regnamespace
           and c.relkind in ('r', 'p', 'v', 'm')`,
      );
      expect(tablas.length).toBeGreaterThan(15);
      for (const { t } of tablas) {
        const { rows } = await dueno.query<{ puede: boolean }>(
          `select (
             has_table_privilege('zuluhub_autenticacion', format('public.%I', $1::text), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
             or has_any_column_privilege('zuluhub_autenticacion', format('public.%I', $1::text), 'SELECT,INSERT,UPDATE,REFERENCES')
           ) as puede`,
          [t],
        );
        expect(rows[0]?.puede, `autenticacion sobre ${t}`).toBe(false);
      }
      const secuencias = await filas<{ s: string }>(
        `select c.relname as s from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'S'`,
      );
      expect(secuencias.length).toBeGreaterThan(0);
      for (const { s } of secuencias) {
        const { rows } = await dueno.query<{ puede: boolean }>(
          `select has_sequence_privilege('zuluhub_autenticacion', format('public.%I', $1::text), 'USAGE,SELECT,UPDATE') as puede`,
          [s],
        );
        expect(rows[0]?.puede, `autenticacion sobre la secuencia ${s}`).toBe(false);
      }
      const funciones = await filas<{ firma: string }>(
        `select p.oid::regprocedure::text as firma from pg_proc p
         where p.pronamespace = 'public'::regnamespace
           and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`,
      );
      expect(funciones.length).toBeGreaterThan(15);
      for (const { firma } of funciones) {
        const { rows } = await dueno.query<{ puede: boolean }>(
          `select has_function_privilege('zuluhub_autenticacion', $1::regprocedure, 'EXECUTE') as puede`,
          [firma],
        );
        expect(rows[0]?.puede, `autenticacion ejecuta ${firma}`).toBe(false);
      }
      const { rows: esquema } = await dueno.query<{ puede: boolean }>(
        `select has_schema_privilege('zuluhub_autenticacion', 'public', 'CREATE') as puede`,
      );
      expect(esquema[0]?.puede).toBe(false);
      const { rows: bd } = await dueno.query<{ puede: boolean }>(
        `select has_database_privilege('zuluhub_autenticacion', current_database(), 'CREATE') as puede`,
      );
      expect(bd[0]?.puede).toBe(false);
    });

    it("el bloque del rol de la autenticación se puede repetir sin efecto y frena si el rol es miembro de otro", async () => {
      const migracion = readFileSync(
        join(import.meta.dirname, "../../migraciones/0004_plataforma.sql"),
        "utf8",
      );
      const bloque = /^DO \$\$[\s\S]*?^\$\$;/m.exec(migracion)?.[0] ?? "";
      expect(bloque).toContain("zuluhub_autenticacion");
      await dueno.query("begin");
      try {
        await expect(dueno.query(bloque)).resolves.toBeDefined();
        await expect(dueno.query(bloque)).resolves.toBeDefined();
        // Si alguien le dio atributos de más, la migración se los quita.
        await dueno.query("alter role zuluhub_autenticacion createdb inherit");
        await dueno.query(bloque);
        const [rol] = (
          await dueno.query<{ rolcreatedb: boolean; rolinherit: boolean }>(
            "select rolcreatedb, rolinherit from pg_roles where rolname = 'zuluhub_autenticacion'",
          )
        ).rows;
        expect(rol).toEqual({ rolcreatedb: false, rolinherit: false });
        // Y si alguien le dio objetos temporales (cierran la suplantación por pg_temp), también se los quita.
        await dueno.query(
          `do $$ begin execute format('grant temporary on database %I to zuluhub_autenticacion', current_database()); end $$`,
        );
        const { rows: conTemp } = await dueno.query<{ temp: boolean }>(
          `select has_database_privilege('zuluhub_autenticacion', current_database(), 'TEMP') as temp`,
        );
        expect(conTemp[0]?.temp).toBe(true);
        await dueno.query(bloque);
        const { rows: sinTemp } = await dueno.query<{ temp: boolean }>(
          `select has_database_privilege('zuluhub_autenticacion', current_database(), 'TEMP') as temp`,
        );
        expect(sinTemp[0]?.temp).toBe(false);
        await dueno.query("grant pg_monitor to zuluhub_autenticacion");
        await expect(dueno.query(bloque)).rejects.toThrow(
          /zuluhub_autenticacion es miembro de pg_monitor/,
        );
      } finally {
        await dueno.query("rollback");
      }
    });
  });

  // ===========================================================================================
  // 2. Aislamiento por rol de base
  // ===========================================================================================
  describe("aislamiento entre roles de base", () => {
    const tokenApp = () =>
      firmarCarga(base!.clave, carga({ u: "zuluhub_app", e: activa.empresa, a: null }));
    const tokenGrupo = () =>
      firmarCarga(
        base!.clave,
        carga({ u: "zuluhub_grupo", t: activa.tenant, p: propietario, a: null }),
      );
    const tokenTrabajos = () => firmarCarga(base!.clave, carga({ u: "zuluhub_trabajos", a: null }));

    it("la aplicación, el grupo, los trabajos y la autenticación no leen admin_plataforma, idempotencia_plataforma ni auditoria_plataforma (42501)", async () => {
      const sesiones: ReadonlyArray<readonly [string, string, string | null]> = [
        ["app", base!.app, tokenApp()],
        ["grupo", base!.grupo, tokenGrupo()],
        ["trabajos", base!.trabajos, tokenTrabajos()],
        ["autenticacion", base!.autenticacion, null],
      ];
      for (const [nombre, url, token] of sesiones) {
        for (const tabla of [
          "admin_plataforma",
          "idempotencia_plataforma",
          "auditoria_plataforma",
        ]) {
          const r = await conSesion(url, token, (s) => s.intentar(`select * from ${tabla}`));
          esperarRechazo(r);
          expect(r.ok ? "" : r.mensaje, `${nombre} lee ${tabla}`).toMatch(/permission denied/);
        }
      }
    });

    it("tampoco pueden escribirlas ni borrarlas", async () => {
      const sesiones: ReadonlyArray<readonly [string, string, string | null]> = [
        ["app", base!.app, tokenApp()],
        ["grupo", base!.grupo, tokenGrupo()],
        ["trabajos", base!.trabajos, tokenTrabajos()],
        ["autenticacion", base!.autenticacion, null],
      ];
      for (const [nombre, url, token] of sesiones) {
        await conSesion(url, token, async (s) => {
          for (const consulta of [
            `insert into admin_plataforma (email, rol) values ('x@prueba.test', 'ADMIN')`,
            `update admin_plataforma set activo = false`,
            `delete from admin_plataforma`,
            `insert into idempotencia_plataforma (admin_id, clave, operacion, huella, resultado)
             values ('${ADMIN_DE_PRUEBA}', '${"k".repeat(20)}', 'x', '${"a".repeat(64)}', '{}')`,
            `insert into auditoria_plataforma (actor, accion, entidad, entidad_id) values ('x', 'x', 'x', 'x')`,
          ]) {
            esperarRechazo(await s.intentar(consulta), ["42501"]);
            expect(nombre).toBeTruthy();
          }
        });
      }
    });

    it("los demás roles no ejecutan las funciones del actor (42501)", async () => {
      const sesiones: ReadonlyArray<readonly [string, string, string | null]> = [
        ["app", base!.app, tokenApp()],
        ["grupo", base!.grupo, tokenGrupo()],
        ["trabajos", base!.trabajos, tokenTrabajos()],
        ["autenticacion", base!.autenticacion, null],
      ];
      for (const [, url, token] of sesiones) {
        await conSesion(url, token, async (s) => {
          esperarRechazo(await s.intentar("select app_actor_plataforma()"));
          esperarRechazo(await s.intentar("select admin_plataforma_con_rol(array['ADMIN'])"));
          esperarRechazo(await s.intentar("select plataforma_actor_vigente()"));
        });
      }
    });

    it("la plataforma no lee datos operativos, con ningún actor: sucursal, asignaciones, sucursales invitadas, auditoría de empresa (42501)", async () => {
      for (const actor of [ADMIN_DE_PRUEBA, SOPORTE_DE_PRUEBA, "sistema"]) {
        await comoPlat(tokenDe(actor), async (s) => {
          for (const tabla of TABLAS_OPERATIVAS) {
            const r = await s.intentar(`select * from ${tabla}`);
            esperarRechazo(r);
            expect(r.ok ? "" : r.mensaje, `${actor} lee ${tabla}`).toMatch(/permission denied/);
          }
        });
      }
    });

    it("de las membresías la plataforma lee 4 columnas: las 4 sí; invitacion_id, fechas y versión (o un SELECT *) no (42501)", async () => {
      await comoPlat(tokenDe(ADMIN_DE_PRUEBA), async (s) => {
        const ok4 = await s.intentar("select empresa_id, persona_id, rol, activo from membresia");
        expect(ok4.ok).toBe(true);
        expect(ok4.ok && ok4.rows.some((f) => f["persona_id"] === personaMiembro)).toBe(true);
        expect(await s.contar("membresia")).toBeGreaterThan(0);
        for (const consulta of [
          "select * from membresia",
          "select invitacion_id from membresia",
          "select creado_en from membresia",
          "select actualizado_en from membresia",
          "select version from membresia",
          "select empresa_id from membresia where invitacion_id is not null",
          "select empresa_id from membresia order by creado_en",
        ]) {
          esperarRechazo(await s.intentar(consulta));
        }
        // Y no la escribe.
        esperarRechazo(
          await s.intentar(
            "insert into membresia (empresa_id, persona_id, rol) values ($1, $2, 'OPERADOR')",
            [activa.empresa, propietario],
          ),
        );
        esperarRechazo(await s.intentar("update membresia set activo = false"));
        esperarRechazo(await s.intentar("delete from membresia"));
      });
    });

    it("la plataforma ve lo que administra (control positivo): una fila al menos en cada tabla legible", async () => {
      await comoPlat(tokenDe(ADMIN_DE_PRUEBA), async (s) => {
        for (const tabla of TABLAS_LEGIBLES) {
          expect(await s.contar(tabla), tabla).toBeGreaterThan(0);
        }
      });
      await comoPlat(tokenDe(SOPORTE_DE_PRUEBA), async (s) => {
        for (const tabla of TABLAS_LEGIBLES) {
          // SOPORTE no tiene claves de idempotencia propias todavía.
          if (tabla === "idempotencia_plataforma") continue;
          expect(await s.contar(tabla), tabla).toBeGreaterThan(0);
        }
      });
    });

    it("nadie borra ni trunca nada: ni la plataforma con ningún actor, ni los demás (42501)", async () => {
      for (const actor of [ADMIN_DE_PRUEBA, SOPORTE_DE_PRUEBA, "sistema"]) {
        await comoPlat(tokenDe(actor), async (s) => {
          for (const tabla of [...TABLAS_LEGIBLES, ...TABLAS_OPERATIVAS]) {
            esperarRechazo(await s.intentar(`delete from ${tabla}`));
            esperarRechazo(await s.intentar(`truncate ${tabla}`));
          }
        });
      }
    });

    it(
      "sin un actor vigente la plataforma ve 0 filas en todas sus tablas y no escribe nada",
      { timeout: 60_000 },
      async () => {
        const ahora = ahoraEnS();
        const sinActor: ReadonlyArray<readonly [string, string | null]> = [
          ["sin token", null],
          ["token con a = null", tokenDe(null)],
          [
            "token de un cliente viejo (sin el claim a)",
            firmarPayload({ u: PLATAFORMA, e: null, t: null, p: null, i: null, x: ahora + 300 }),
          ],
          ["token vencido", tokenDe(ADMIN_DE_PRUEBA, { x: ahora - 5 })],
          [
            "token de otro rol (la aplicación)",
            firmarCarga(base!.clave, carga({ u: "zuluhub_app", a: ADMIN_DE_PRUEBA })),
          ],
          [
            "token del grupo con el actor",
            firmarCarga(base!.clave, carga({ u: "zuluhub_grupo", a: ADMIN_DE_PRUEBA })),
          ],
          [
            "token de trabajos con el actor",
            firmarCarga(base!.clave, carga({ u: "zuluhub_trabajos", a: ADMIN_DE_PRUEBA })),
          ],
          [
            "token firmado con otra clave",
            firmarCarga({ kid: base!.clave.kid, secreto: randomBytes(32) }, carga()),
          ],
          [
            "token con un kid que no existe",
            firmarCarga({ kid: 999, secreto: base!.clave.secreto }, carga()),
          ],
          ["administrador desconocido", tokenDe(DESCONOCIDO)],
          ["administrador dado de baja", tokenDe(ADMIN_DE_BAJA)],
          ["el actor en mayúsculas", tokenDe(ADMIN_DE_PRUEBA.toUpperCase())],
          ["el actor con un espacio", tokenDe(` ${ADMIN_DE_PRUEBA}`)],
          ["SISTEMA en mayúsculas", tokenDe("SISTEMA")],
          ["sistema con un espacio", tokenDe("sistema ")],
          ["actor vacío", tokenDe("")],
          [
            "actor numérico",
            firmarPayload({
              u: PLATAFORMA,
              e: null,
              t: null,
              p: null,
              i: null,
              x: ahora + 300,
              a: 123,
            }),
          ],
          [
            "actor que es un objeto",
            firmarPayload({
              u: PLATAFORMA,
              e: null,
              t: null,
              p: null,
              i: null,
              x: ahora + 300,
              a: { id: ADMIN_DE_PRUEBA },
            }),
          ],
          [
            "actor que es una lista",
            firmarPayload({
              u: PLATAFORMA,
              e: null,
              t: null,
              p: null,
              i: null,
              x: ahora + 300,
              a: [ADMIN_DE_PRUEBA],
            }),
          ],
        ];
        const conLaTablaDeAdmins = new Set([
          "administrador desconocido",
          "administrador dado de baja",
          "el actor en mayúsculas",
          "el actor con un espacio",
          "SISTEMA en mayúsculas",
          "sistema con un espacio",
          "actor numérico",
          "actor que es un objeto",
          "actor que es una lista",
        ]);
        for (const [nombre, token] of sinActor) {
          await comoPlat(token, async (s) => {
            for (const tabla of TABLAS_LEGIBLES) {
              // Con un actor firmado que no es vigente, `admin_plataforma` se puede leer: es la tabla que
              // permite al caso de uso decidir SIN_PERMISO. Con eso no se lee nada operativo.
              const esperado =
                tabla === "admin_plataforma" && conLaTablaDeAdmins.has(nombre) ? null : 0;
              const n = await s.contar(tabla);
              if (esperado === null) expect(n, `${nombre}: ${tabla}`).toBeGreaterThan(0);
              else expect(n, `${nombre}: ${tabla}`).toBe(esperado);
            }
          });
          // Y ninguna escritura prospera (cada una en su propia sesión: algunas fallan en un disparador).
          const escrituras: ReadonlyArray<readonly [string, unknown[]]> = [
            ["insert into tenant (nombre) values ('sin-actor')", []],
            ["insert into persona (email) values ('sin-actor@prueba.test')", []],
            [
              "insert into auditoria_plataforma (actor, accion, entidad, entidad_id) values ('x', 'x', 'x', 'x')",
              [],
            ],
            [
              "insert into referencia_de_error (referencia, accion, motivo) values ('ZH-0000-0000', 'a.b', 'X')",
              [],
            ],
          ];
          for (const [texto, parametros] of escrituras) {
            esperarRechazo(await unaVez(token, texto, parametros), ["42501", "55000"]);
          }
          for (const texto of [
            "update tenant set nombre = nombre",
            "update empresa set razon_social = razon_social",
            "update persona set activo_global = activo_global",
            "update invitacion set estado = estado",
            "update membresia_tenant set activo = activo",
          ]) {
            esperarFilas(await unaVez(token, texto), 0);
          }
        }
      },
    );

    it("el control positivo del bloque anterior: el mismo ADMIN con un token vigente sí escribe", async () => {
      await comoPlat(tokenDe(ADMIN_DE_PRUEBA), async (s) => {
        esperarFilas(
          await s.intentar("insert into tenant (nombre) values ($1)", [nombreAlAzar("t")]),
          1,
        );
        esperarFilas(
          await s.intentar("update tenant set nombre = nombre"),
          await s.contar("tenant"),
        );
      });
    });
  });

  // ===========================================================================================
  // 3. El actor firmado
  // ===========================================================================================
  describe("el actor firmado", () => {
    it("el adaptador firma el actor y la base lo lee: el id del administrador o 'sistema'", async () => {
      for (const [contexto, esperado] of [
        [comoPlataforma(), ADMIN_DE_PRUEBA],
        [comoPlataforma({ tipo: "ADMIN", id: SOPORTE_DE_PRUEBA }), SOPORTE_DE_PRUEBA],
        [comoPlataforma({ tipo: "SISTEMA", proceso: "barrido" }), "sistema"],
      ] as const) {
        const r = await entorno.ejecutar({ contexto }, async ({ db }) => {
          const { rows } = await sql<{
            a: string | null;
          }>`select app_actor_plataforma() as a`.execute(db);
          return ok(rows[0]?.a ?? null);
        });
        expect(r).toEqual({ ok: true, valor: esperado });
      }
    });

    it("app_actor_plataforma(): el actor firmado; null sin claim, con claim vacío o sin firma válida", async () => {
      expect(await comoPlat(tokenDe(ADMIN_DE_PRUEBA), (s) => s.actor())).toBe(ADMIN_DE_PRUEBA);
      expect(await comoPlat(tokenDe("sistema"), (s) => s.actor())).toBe("sistema");
      expect(await comoPlat(tokenDe(null), (s) => s.actor())).toBeNull();
      expect(await comoPlat(tokenDe(""), (s) => s.actor())).toBeNull();
      expect(await comoPlat(null, (s) => s.actor())).toBeNull();
    });

    it("el actor no se puede falsificar: cambiar `a` en un token firmado invalida la firma", async () => {
      const original = tokenDe(SOPORTE_DE_PRUEBA);
      const [version, kid, payloadHex, mac] = original.split(".") as [
        string,
        string,
        string,
        string,
      ];
      const payload = JSON.parse(Buffer.from(payloadHex, "hex").toString("utf8")) as Record<
        string,
        unknown
      >;
      expect(payload["a"]).toBe(SOPORTE_DE_PRUEBA);
      for (const nuevoActor of [ADMIN_DE_PRUEBA, "sistema", null]) {
        const adulterado = Buffer.from(
          JSON.stringify({ ...payload, a: nuevoActor }),
          "utf8",
        ).toString("hex");
        const falso = `${version}.${kid}.${adulterado}.${mac}`;
        expect(await comoPlat(falso, (s) => s.actor()), String(nuevoActor)).toBeNull();
        // Y con ese token la plataforma no ve nada.
        expect(await comoPlat(falso, (s) => s.contar("tenant"))).toBe(0);
      }
      // Control positivo: el original, intacto, vale.
      expect(await comoPlat(original, (s) => s.actor())).toBe(SOPORTE_DE_PRUEBA);
    });

    it("el actor no se puede agregar a un token que no lo trae ni sacarlo: el payload va firmado entero", async () => {
      const sinActor = tokenDe(null);
      const [version, kid, payloadHex, mac] = sinActor.split(".") as [
        string,
        string,
        string,
        string,
      ];
      const payload = JSON.parse(Buffer.from(payloadHex, "hex").toString("utf8")) as Record<
        string,
        unknown
      >;
      const conActor = Buffer.from(
        JSON.stringify({ ...payload, a: ADMIN_DE_PRUEBA }),
        "utf8",
      ).toString("hex");
      expect(await comoPlat(`${version}.${kid}.${conActor}.${mac}`, (s) => s.actor())).toBeNull();
    });

    it("no se puede reutilizar entre roles: el token de plataforma no vale en la sesión de otro rol, ni al revés", async () => {
      const deAdmin = tokenDe(ADMIN_DE_PRUEBA);
      for (const [url, nombre] of [
        [base!.app, "app"],
        [base!.grupo, "grupo"],
        [base!.trabajos, "trabajos"],
      ] as const) {
        const ctx = await conSesion(url, deAdmin, async (s) => {
          const r = await s.intentar("select contexto_firmado() is null as vacio");
          return r.ok ? r.rows[0]?.["vacio"] : "error";
        });
        expect(ctx, nombre).toBe(true);
      }
      // Un token de la aplicación que llevara un actor tampoco abre la plataforma.
      const deApp = firmarCarga(
        base!.clave,
        carga({ u: "zuluhub_app", e: activa.empresa, a: ADMIN_DE_PRUEBA }),
      );
      expect(await comoPlat(deApp, (s) => s.actor())).toBeNull();
    });

    it("quien tiene el token de SOPORTE no pasa a ADMIN: ni con otro token adulterado, ni con variables de usuario", async () => {
      await comoPlat(tokenDe(SOPORTE_DE_PRUEBA), async (s) => {
        // Cambiar la variable por un token que no firmó el servidor: la plataforma pierde todo.
        const falso = tokenDe(ADMIN_DE_PRUEBA).replace(/.$/, (c) => (c === "0" ? "1" : "0"));
        await s.intentar("select set_config('app.ctx', $1, true)", [falso]);
        expect(await s.actor()).toBeNull();
        expect(await s.contar("tenant")).toBe(0);
        // Con variables de usuario inventadas no se obtiene nada.
        await s.intentar("select set_config('app.ctx', $1, true)", [tokenDe(SOPORTE_DE_PRUEBA)]);
        await s.intentar("select set_config('app.actor', $1, true)", [ADMIN_DE_PRUEBA]);
        await s.intentar("select set_config('app.actor_plataforma', $1, true)", [ADMIN_DE_PRUEBA]);
        expect(await s.actor()).toBe(SOPORTE_DE_PRUEBA);
        esperarRechazo(
          await s.intentar("insert into tenant (nombre) values ($1)", [nombreAlAzar("t")]),
        );
      });
    });

    it("lo único que se puede hacer con un token es cambiarlo por otro válido que ya se tenga (y vale el último)", async () => {
      await comoPlat(tokenDe(SOPORTE_DE_PRUEBA), async (s) => {
        expect(await s.actor()).toBe(SOPORTE_DE_PRUEBA);
        await s.intentar("select set_config('app.ctx', $1, true)", [tokenDe(ADMIN_DE_PRUEBA)]);
        // Es el límite documentado: un token de ADMIN que el servidor ya emitió sigue siendo de ADMIN.
        expect(await s.actor()).toBe(ADMIN_DE_PRUEBA);
      });
    });

    it(
      "un token vencido en mitad de la transacción deja a la plataforma sin ver nada (falla cerrado)",
      { timeout: 30_000 },
      async () => {
        await comoPlat(tokenDe(ADMIN_DE_PRUEBA, { x: ahoraEnS() + 3 }), async (s) => {
          expect(await s.contar("tenant")).toBeGreaterThan(0);
          await new Promise((r) => setTimeout(r, 3200));
          expect(await s.contar("tenant")).toBe(0);
          esperarRechazo(
            await s.intentar("insert into tenant (nombre) values ($1)", [nombreAlAzar("t")]),
            ["42501", "55000"],
          );
        });
      },
    );

    describe("SOPORTE por SQL directo", () => {
      const soporte = () => tokenDe(SOPORTE_DE_PRUEBA);

      it("no cambia la estructura: UPDATE de tenant, empresa, persona y membresia_tenant afecta 0 filas", async () => {
        await comoPlat(soporte(), async (s) => {
          esperarFilas(await s.intentar("update tenant set nombre = 'x' || nombre"), 0);
          esperarFilas(
            await s.intentar("update tenant set estado = 'SUSPENDED', motivo_estado = 'x'"),
            0,
          );
          esperarFilas(
            await s.intentar("update empresa set razon_social = 'x' || razon_social"),
            0,
          );
          esperarFilas(
            await s.intentar(
              "update empresa set estado = 'SUSPENDED', motivo_estado = 'x' where estado = 'ACTIVE'",
            ),
            0,
          );
          esperarFilas(
            await s.intentar(
              "update empresa set estado = 'CANCELLED', motivo_estado = 'x' where estado = 'PROVISIONING'",
            ),
            0,
          );
          esperarFilas(await s.intentar("update persona set activo_global = false"), 0);
          esperarFilas(await s.intentar("update membresia_tenant set activo = false"), 0);
        });
      });

      it("no crea estructura: INSERT de tenant, empresa, persona, membresia_tenant, sucursal y auditoría de empresa viola la RLS (42501)", async () => {
        await comoPlat(soporte(), async (s) => {
          esperarRechazo(
            await s.intentar("insert into tenant (nombre) values ($1)", [nombreAlAzar("t")]),
          );
          esperarRechazo(
            await s.intentar(
              "insert into empresa (tenant_id, cuit, razon_social) values ($1, $2, $3)",
              [activa.tenant, cuitAlAzar(), nombreAlAzar("e")],
            ),
          );
          esperarRechazo(
            await s.intentar("insert into persona (email) values ($1)", [emailAlAzar("p")]),
          );
          esperarRechazo(
            await s.intentar(
              "insert into membresia_tenant (persona_id, tenant_id, rol) values ($1, $2, 'PROPIETARIO')",
              [personaMiembro, activa.tenant],
            ),
          );
          esperarRechazo(
            await s.intentar("insert into sucursal (empresa_id, nombre) values ($1, $2)", [
              enAlta.empresa,
              nombreAlAzar("s"),
            ]),
          );
          esperarRechazo(
            await s.intentar(
              "insert into auditoria_empresa (empresa_id, accion, entidad, entidad_id) values ($1, 'X', 'x', 'x')",
              [activa.empresa],
            ),
          );
        });
      });

      it("no invita a una empresa en marcha: una invitación de USUARIO (cabecera o fila de empresa) se rechaza; la del alta, no", async () => {
        await comoPlat(soporte(), async (s) => {
          const cabecera = (tipo: string) =>
            s.intentar(
              `insert into invitacion (id, tenant_id, tipo, email, token_hash, emitida_en, vence_en)
               values ($1, $2, $3, $4, $5, now(), now() + interval '1 day')`,
              [randomUUID(), activa.tenant, tipo, emailAlAzar("nuevo"), tokenAlAzar().tokenHash],
            );
          esperarRechazo(await cabecera("USUARIO"));
          esperarFilas(await cabecera("ALTA_GERENTE"), 1);
        });
        // Control: el ADMIN sí emite una invitación de usuario (lo que le dio 0002).
        await comoPlat(tokenDe(ADMIN_DE_PRUEBA), async (s) => {
          esperarFilas(
            await s.intentar(
              `insert into invitacion (id, tenant_id, tipo, email, token_hash, emitida_en, vence_en)
               values ($1, $2, 'USUARIO', $3, $4, now(), now() + interval '1 day')`,
              [randomUUID(), activa.tenant, emailAlAzar("nuevo"), tokenAlAzar().tokenHash],
            ),
            1,
          );
        });
        // La fila de empresa de un USUARIO, aunque la cabecera exista (la crea el dueño).
        const cabecera = await crearInvitacionDeBase(dueno, { tenant: activa.tenant });
        await comoPlat(soporte(), async (s) => {
          esperarRechazo(
            await s.intentar(
              `insert into invitacion_empresa (invitacion_id, empresa_id, tenant_id, rol, email, token_hash, tipo)
               values ($1, $2, $3, 'OPERADOR', $4, $5, 'USUARIO')`,
              [cabecera.id, activa.empresa, activa.tenant, cabecera.email, cabecera.tokenHash],
            ),
          );
        });
        await comoPlat(tokenDe(ADMIN_DE_PRUEBA), async (s) => {
          esperarFilas(
            await s.intentar(
              `insert into invitacion_empresa (invitacion_id, empresa_id, tenant_id, rol, email, token_hash, tipo)
               values ($1, $2, $3, 'OPERADOR', $4, $5, 'USUARIO')`,
              [cabecera.id, activa.empresa, activa.tenant, cabecera.email, cabecera.tokenHash],
            ),
            1,
          );
        });
      });

      it("solo toca invitaciones del alta: revoca la pendiente del alta y no la de un usuario (0 filas)", async () => {
        await comoPlat(soporte(), async (s) => {
          esperarFilas(
            await s.intentar(
              `update invitacion set estado = 'REVOCADA', revocada_en = now(), motivo_revocacion = 'REVOCADA_POR_PLATAFORMA'
             where id = $1`,
              [usuarioPendiente.id],
            ),
            0,
          );
          esperarFilas(
            await s.intentar(
              `update invitacion set estado = 'REVOCADA', revocada_en = now(), motivo_revocacion = 'REVOCADA_POR_PLATAFORMA'
             where id = $1`,
              [altaPendiente.id],
            ),
            1,
          );
        });
      });

      it("solo encola el envío de invitaciones: otro tipo de trabajo se rechaza", async () => {
        await comoPlat(soporte(), async (s) => {
          esperarRechazo(
            await s.intentar(
              "insert into trabajo (empresa_id, tipo, clave_idempotencia) values ($1, 'mantenimiento', $2)",
              [enAlta.empresa, nombreAlAzar("k")],
            ),
          );
          esperarRechazo(
            await s.intentar(
              "insert into trabajo (empresa_id, tipo, clave_idempotencia) values ($1, $2, $3)",
              [enAlta.empresa, `${TRABAJO_ENVIAR_INVITACION}_otro`, nombreAlAzar("k")],
            ),
          );
          esperarFilas(
            await s.intentar(
              "insert into trabajo (empresa_id, tipo, clave_idempotencia) values ($1, $2, $3)",
              [enAlta.empresa, TRABAJO_ENVIAR_INVITACION, nombreAlAzar("k")],
            ),
            1,
          );
        });
      });

      it("el flujo de reenviar el alta, completo, con los permisos de SOPORTE: revoca, emite la nueva, vincula, encola, audita y guarda la clave", async () => {
        const { tokenHash } = tokenAlAzar();
        const nuevaId = randomUUID();
        const email = emailAlAzar("reenvio");
        await comoPlat(soporte(), async (s) => {
          esperarFilas(
            await s.intentar(
              `update invitacion set estado = 'REVOCADA', revocada_en = now(), motivo_revocacion = 'REENVIADA' where id = $1`,
              [altaPendiente.id],
            ),
            1,
          );
          esperarFilas(
            await s.intentar(
              `insert into invitacion (id, tenant_id, tipo, email, token_hash, emitida_en, vence_en)
             values ($1, $2, 'ALTA_GERENTE', $3, $4, now(), now() + interval '1 day')`,
              [nuevaId, enAlta.tenant, email, tokenHash],
            ),
            1,
          );
          esperarFilas(
            await s.intentar(
              `insert into invitacion_empresa (invitacion_id, empresa_id, tenant_id, rol, email, token_hash, tipo)
             values ($1, $2, $3, 'GERENTE', $4, $5, 'ALTA_GERENTE')`,
              [nuevaId, enAlta.empresa, enAlta.tenant, email, tokenHash],
            ),
            1,
          );
          esperarFilas(
            await s.intentar(`update invitacion set reemplazada_por = $2 where id = $1`, [
              altaPendiente.id,
              nuevaId,
            ]),
            1,
          );
          esperarFilas(
            await s.intentar(
              "insert into trabajo (empresa_id, tipo, clave_idempotencia) values ($1, $2, $3)",
              [enAlta.empresa, TRABAJO_ENVIAR_INVITACION, `envio:${nuevaId}`],
            ),
            1,
          );
          esperarFilas(
            await s.intentar(
              `insert into auditoria_plataforma (actor, accion, entidad, entidad_id, antes, despues)
             values ($1, 'ALTA_REENVIADA', 'invitacion', $2, '{}'::jsonb, '{}'::jsonb)`,
              [SOPORTE_DE_PRUEBA, nuevaId],
            ),
            1,
          );
          esperarFilas(
            await s.intentar(
              `insert into idempotencia_plataforma (admin_id, clave, operacion, huella, resultado)
             values ($1, $2, 'altas.reenviar_invitacion', $3, '{}'::jsonb)`,
              [SOPORTE_DE_PRUEBA, randomBytes(12).toString("hex"), "cd".repeat(32)],
            ),
            1,
          );
        });
      });

      it("deja constancia solo a su nombre: la auditoría con su id vale; con el id de un ADMIN, con 'sistema' o con otro texto, no", async () => {
        await comoPlat(soporte(), async (s) => {
          const auditar = (actor: string) =>
            s.intentar(
              "insert into auditoria_plataforma (actor, accion, entidad, entidad_id) values ($1, 'SOPORTE_EXPLICAR', 'empresa', 'x')",
              [actor],
            );
          esperarFilas(await auditar(SOPORTE_DE_PRUEBA), 1);
          esperarRechazo(await auditar(ADMIN_DE_PRUEBA));
          esperarRechazo(await auditar(OTRO_ADMIN));
          esperarRechazo(await auditar("sistema"));
          esperarRechazo(await auditar("admin-de-prueba"));
          esperarRechazo(await auditar(SOPORTE_DE_PRUEBA.toUpperCase()));
        });
      });
    });

    describe("el puerto de trabajos con el contexto de plataforma (INSERT ... ON CONFLICT DO NOTHING RETURNING)", () => {
      it("ADMIN y SOPORTE encolan con el adaptador real; repetir la clave vuelve como YA_ENCOLADO", async () => {
        for (const [actor, tipo] of [
          [{ tipo: "ADMIN", id: ADMIN_DE_PRUEBA }, "mantenimiento"],
          [{ tipo: "ADMIN", id: SOPORTE_DE_PRUEBA }, TRABAJO_ENVIAR_INVITACION],
          [{ tipo: "ADMIN", id: ADMIN_DE_PRUEBA }, TRABAJO_ENVIAR_INVITACION],
        ] as const) {
          const clave = nombreAlAzar("encolar");
          const encolar = () =>
            entorno.ejecutar({ contexto: comoPlataforma(actor) }, async ({ trabajos }) =>
              ok(
                await trabajos.encolar({
                  empresaId: enAlta.empresa,
                  tipo,
                  datos: { invitacionId: randomUUID() },
                  claveDeIdempotencia: clave,
                }),
              ),
            );
          expect(await encolar()).toEqual({ ok: true, valor: "ENCOLADO" });
          expect(await encolar()).toEqual({ ok: true, valor: "YA_ENCOLADO" });
        }
      });

      it("SOPORTE no encola otro tipo con el adaptador: la base lo rechaza", async () => {
        const r = await entorno.ejecutar(
          { contexto: comoPlataforma({ tipo: "ADMIN", id: SOPORTE_DE_PRUEBA }) },
          async ({ trabajos }) =>
            ok(
              await trabajos.encolar({
                empresaId: enAlta.empresa,
                tipo: "mantenimiento",
                datos: {},
                claveDeIdempotencia: nombreAlAzar("encolar"),
              }),
            ),
        );
        expect(r).toEqual({ ok: false, error: { tipo: "AccesoDenegado" } });
      });
    });

    describe("ADMIN por SQL directo (control positivo de todo lo que 0001 y 0002 le dieron)", () => {
      it("crea y cambia estructura, emite invitaciones de cualquier tipo, encola cualquier trabajo y audita en la plataforma y en la empresa", async () => {
        await comoPlat(tokenDe(ADMIN_DE_PRUEBA), async (s) => {
          const t = await s.intentar("insert into tenant (nombre) values ($1) returning id", [
            nombreAlAzar("t"),
          ]);
          expect(t.ok).toBe(true);
          const tenant = (t.ok ? t.rows[0]?.["id"] : null) as string;
          const e = await s.intentar(
            "insert into empresa (tenant_id, cuit, razon_social) values ($1, $2, $3) returning id",
            [tenant, cuitAlAzar(), nombreAlAzar("e")],
          );
          expect(e.ok).toBe(true);
          const empresa = (e.ok ? e.rows[0]?.["id"] : null) as string;
          esperarFilas(
            await s.intentar(
              "insert into sucursal (empresa_id, nombre) values ($1, 'Casa central')",
              [empresa],
            ),
            1,
          );
          const emailNuevo = emailAlAzar("p");
          esperarFilas(
            await s.intentar("insert into persona (email) values ($1)", [emailNuevo]),
            1,
          );
          esperarFilas(
            await s.intentar(
              "update tenant set estado = 'SUSPENDED', motivo_estado = 'x' where id = $1",
              [tenant],
            ),
            1,
          );
          esperarFilas(
            await s.intentar(
              "update tenant set estado = 'ACTIVE', motivo_estado = null where id = $1",
              [tenant],
            ),
            1,
          );
          esperarFilas(
            await s.intentar("update empresa set estado = 'ACTIVE' where id = $1", [empresa]),
            1,
          );
          esperarFilas(
            await s.intentar(
              "update empresa set estado = 'SUSPENDED', motivo_estado = 'x' where id = $1",
              [empresa],
            ),
            1,
          );
          esperarFilas(
            await s.intentar("update persona set activo_global = false where email = $1", [
              emailNuevo,
            ]),
            1,
          );
          esperarFilas(
            await s.intentar(
              "insert into trabajo (empresa_id, tipo, clave_idempotencia) values ($1, 'mantenimiento', $2)",
              [empresa, nombreAlAzar("k")],
            ),
            1,
          );
          esperarFilas(
            await s.intentar(
              "insert into auditoria_empresa (empresa_id, accion, entidad, entidad_id) values ($1, 'PERSONA_SUSPENDIDA', 'persona', 'x')",
              [empresa],
            ),
            1,
          );
          esperarRechazo(
            await s.intentar(
              "insert into auditoria_empresa (empresa_id, actor_persona_id, accion, entidad, entidad_id) values ($1, $2, 'X', 'persona', 'x')",
              [empresa, personaMiembro],
            ),
          );
        });
      });

      it("a nombre de otro administrador no escribe: ni auditoría ni claves de idempotencia", async () => {
        await comoPlat(tokenDe(ADMIN_DE_PRUEBA), async (s) => {
          esperarRechazo(
            await s.intentar(
              "insert into auditoria_plataforma (actor, accion, entidad, entidad_id) values ($1, 'X', 'x', 'x')",
              [OTRO_ADMIN],
            ),
          );
          esperarRechazo(
            await s.intentar(
              `insert into idempotencia_plataforma (admin_id, clave, operacion, huella, resultado)
             values ($1, $2, 'x.y', $3, '{}'::jsonb)`,
              [OTRO_ADMIN, randomBytes(12).toString("hex"), "ef".repeat(32)],
            ),
          );
        });
      });
    });

    describe("el administrador dado de baja y el desconocido", () => {
      it("un administrador con activo = false no escribe nada ni lee datos de negocio, aunque su token siga vigente", async () => {
        await comoPlat(tokenDe(ADMIN_DE_BAJA), async (s) => {
          expect(await s.contar("tenant")).toBe(0);
          expect(await s.contar("empresa")).toBe(0);
          expect(await s.contar("invitacion")).toBe(0);
          for (const [texto, params] of [
            ["insert into tenant (nombre) values ($1)", [nombreAlAzar("t")]],
            ["insert into persona (email) values ($1)", [emailAlAzar("p")]],
            [
              "insert into auditoria_plataforma (actor, accion, entidad, entidad_id) values ($1, 'X', 'x', 'x')",
              [ADMIN_DE_BAJA],
            ],
            [
              "insert into idempotencia_plataforma (admin_id, clave, operacion, huella, resultado) values ($1, $2, 'x.y', $3, '{}'::jsonb)",
              [ADMIN_DE_BAJA, randomBytes(12).toString("hex"), "ab".repeat(32)],
            ],
            [
              "insert into referencia_de_error (referencia, accion, motivo) values ('ZH-0000-0000', 'a.b', 'X')",
              [],
            ],
          ] as const) {
            esperarRechazo(await s.intentar(texto, [...params]), ["42501", "55000"]);
          }
          // Puede leer su propia fila (el caso de uso la necesita para responder SIN_PERMISO).
          const yo = await s.intentar("select id, activo from admin_plataforma where id = $1", [
            ADMIN_DE_BAJA,
          ]);
          expect(yo.ok && yo.rows).toEqual([{ id: ADMIN_DE_BAJA, activo: false }]);
        });
      });

      it("la baja y la reactivación toman efecto en la operación siguiente, con el mismo token", async () => {
        const efimero = randomUUID();
        await dueno.query(
          "insert into admin_plataforma (id, email, rol) values ($1, $2, 'ADMIN')",
          [efimero, emailAlAzar("efimero")],
        );
        const token = tokenDe(efimero);
        expect(await comoPlat(token, (s) => s.contar("tenant"))).toBeGreaterThan(0);
        await dueno.query("update admin_plataforma set activo = false where id = $1", [efimero]);
        expect(await comoPlat(token, (s) => s.contar("tenant"))).toBe(0);
        await dueno.query(
          "update admin_plataforma set activo = true, rol = 'SOPORTE' where id = $1",
          [efimero],
        );
        await comoPlat(token, async (s) => {
          expect(await s.contar("tenant")).toBeGreaterThan(0);
          // Ya no es ADMIN: bajó a SOPORTE y la base lo aplica en la operación siguiente.
          esperarRechazo(
            await s.intentar("insert into tenant (nombre) values ($1)", [nombreAlAzar("t")]),
          );
        });
      });

      it("un id que no es de ningún administrador no lee ni escribe datos de negocio", async () => {
        await comoPlat(tokenDe(DESCONOCIDO), async (s) => {
          for (const tabla of TABLAS_LEGIBLES.filter((t) => t !== "admin_plataforma")) {
            expect(await s.contar(tabla), tabla).toBe(0);
          }
          esperarRechazo(
            await s.intentar("insert into tenant (nombre) values ($1)", [nombreAlAzar("t")]),
            ["42501", "55000"],
          );
        });
      });
    });

    describe("el actor 'sistema' (el barrido de altas vencidas)", () => {
      const sistema = () => tokenDe("sistema");

      it("lee lo que administra, pero no tiene datos operativos", async () => {
        await comoPlat(sistema(), async (s) => {
          for (const tabla of TABLAS_LEGIBLES) {
            if (tabla === "idempotencia_plataforma") continue;
            expect(await s.contar(tabla), tabla).toBeGreaterThan(0);
          }
        });
      });

      it("cancela el alta que sigue en PROVISIONING y revoca sus invitaciones pendientes", async () => {
        await comoPlat(sistema(), async (s) => {
          esperarFilas(
            await s.intentar(
              `update empresa set estado = 'CANCELLED', motivo_estado = 'ALTA_VENCIDA' where id = $1 and estado = 'PROVISIONING'`,
              [enAlta.empresa],
            ),
            1,
          );
          esperarFilas(
            await s.intentar(
              `update invitacion set estado = 'REVOCADA', revocada_en = now(), motivo_revocacion = 'ALTA_CANCELADA'
             where id = $1 and estado = 'PENDIENTE'`,
              [altaPendiente.id],
            ),
            1,
          );
          esperarFilas(
            await s.intentar(
              `insert into auditoria_plataforma (actor, accion, entidad, entidad_id) values ('sistema', 'ALTA_VENCIDA', 'empresa', $1)`,
              [enAlta.empresa],
            ),
            1,
          );
        });
      });

      it("no puede nada más: ni activar un alta, ni suspender, ni cancelar una empresa activa, ni cambiar sus datos", async () => {
        await comoPlat(sistema(), async (s) => {
          esperarRechazo(
            await s.intentar(`update empresa set estado = 'ACTIVE' where id = $1`, [
              enAlta.empresa,
            ]),
          );
          esperarRechazo(
            await s.intentar(
              `update empresa set razon_social = razon_social || 'x' where id = $1`,
              [enAlta.empresa],
            ),
          );
          esperarFilas(
            await s.intentar(
              `update empresa set estado = 'SUSPENDED', motivo_estado = 'x' where id = $1`,
              [activa.empresa],
            ),
            0,
          );
          esperarFilas(
            await s.intentar(
              `update empresa set estado = 'CANCELLED', motivo_estado = 'x' where id = $1`,
              [activa.empresa],
            ),
            0,
          );
          esperarFilas(
            await s.intentar(`update tenant set estado = 'SUSPENDED', motivo_estado = 'x'`),
            0,
          );
          esperarFilas(await s.intentar(`update persona set activo_global = false`), 0);
          esperarFilas(await s.intentar(`update membresia_tenant set activo = false`), 0);
        });
      });

      it("solo revoca altas pendientes: una invitación de usuario (0 filas) y aceptar o dejarla PENDIENTE se rechazan", async () => {
        await comoPlat(sistema(), async (s) => {
          esperarFilas(
            await s.intentar(
              `update invitacion set estado = 'REVOCADA', revocada_en = now(), motivo_revocacion = 'x' where id = $1`,
              [usuarioPendiente.id],
            ),
            0,
          );
          esperarRechazo(
            await s.intentar(
              `update invitacion set estado = 'ACEPTADA', aceptada_por = $2, aceptada_en = now() - interval '1 day' where id = $1`,
              [altaPendiente.id, personaMiembro],
            ),
          );
          esperarRechazo(
            await s.intentar(`update invitacion set reemplazada_por = null where id = $1`, [
              altaPendiente.id,
            ]),
          );
        });
      });

      it("no crea nada: ni tenants, empresas, personas, sucursales, invitaciones, trabajos, claves de idempotencia ni auditoría de empresa", async () => {
        await comoPlat(sistema(), async (s) => {
          for (const [texto, params] of [
            ["insert into tenant (nombre) values ($1)", [nombreAlAzar("t")]],
            [
              "insert into empresa (tenant_id, cuit, razon_social) values ($1, $2, $3)",
              [activa.tenant, cuitAlAzar(), nombreAlAzar("e")],
            ],
            ["insert into persona (email) values ($1)", [emailAlAzar("p")]],
            ["insert into sucursal (empresa_id, nombre) values ($1, 'x')", [enAlta.empresa]],
            [
              "insert into trabajo (empresa_id, tipo, clave_idempotencia) values ($1, 'enviar_invitacion', $2)",
              [activa.empresa, nombreAlAzar("k")],
            ],
            [
              "insert into auditoria_empresa (empresa_id, accion, entidad, entidad_id) values ($1, 'X', 'x', 'x')",
              [activa.empresa],
            ],
            [
              "insert into idempotencia_plataforma (admin_id, clave, operacion, huella, resultado) values ($1, $2, 'x.y', $3, '{}'::jsonb)",
              [ADMIN_DE_PRUEBA, randomBytes(12).toString("hex"), "ab".repeat(32)],
            ],
            [
              "insert into invitacion (id, tenant_id, tipo, email, token_hash, emitida_en, vence_en) values ($1, $2, 'ALTA_GERENTE', $3, $4, now(), now() + interval '1 day')",
              [randomUUID(), enAlta.tenant, emailAlAzar("s"), tokenAlAzar().tokenHash],
            ],
          ] as const) {
            esperarRechazo(await s.intentar(texto, [...params]), ["42501", "55000"]);
          }
        });
      });

      it("su auditoría lleva 'sistema' como actor y nada más", async () => {
        await comoPlat(sistema(), async (s) => {
          const auditar = (actor: string) =>
            s.intentar(
              "insert into auditoria_plataforma (actor, accion, entidad, entidad_id) values ($1, 'X', 'x', 'x')",
              [actor],
            );
          esperarFilas(await auditar("sistema"), 1);
          esperarRechazo(await auditar(ADMIN_DE_PRUEBA));
          esperarRechazo(await auditar("SISTEMA"));
        });
      });
    });

    describe("idempotencia de plataforma", () => {
      const clave = () => randomBytes(12).toString("hex");
      const insertar = (s: Sesion, admin: string, k: string, operacion = "empresas.alta") =>
        s.intentar(
          `insert into idempotencia_plataforma (admin_id, clave, operacion, huella, resultado)
           values ($1, $2, $3, $4, '{"ok":true}'::jsonb)`,
          [admin, k, operacion, "ab".repeat(32)],
        );

      it("cada administrador ve y registra solo sus claves; la misma clave de dos administradores no choca", async () => {
        const k = clave();
        await dueno.query(
          `insert into idempotencia_plataforma (admin_id, clave, operacion, huella, resultado) values ($1, $2, 'x.y', $3, '{}'::jsonb)`,
          [OTRO_ADMIN, `ajena${k}`, "ab".repeat(32)],
        );
        await comoPlat(tokenDe(ADMIN_DE_PRUEBA), async (s) => {
          esperarFilas(await insertar(s, ADMIN_DE_PRUEBA, k), 1);
          esperarRechazo(await insertar(s, OTRO_ADMIN, clave()));
          const propias = await s.intentar("select admin_id, clave from idempotencia_plataforma");
          expect(propias.ok && propias.rows.every((f) => f["admin_id"] === ADMIN_DE_PRUEBA)).toBe(
            true,
          );
          const ajena = await s.intentar(
            "select 1 from idempotencia_plataforma where admin_id = $1",
            [OTRO_ADMIN],
          );
          esperarFilas(ajena, 0);
          // Misma clave del mismo administrador: choca con la clave primaria.
          const repetida = await insertar(s, ADMIN_DE_PRUEBA, k);
          expect(repetida.ok).toBe(false);
          expect(!repetida.ok && repetida.restriccion).toBe("idempotencia_plataforma_pkey");
        });
        await comoPlat(tokenDe(OTRO_ADMIN), async (s) => {
          esperarFilas(await insertar(s, OTRO_ADMIN, k), 1);
          const vistas = await s.intentar("select clave from idempotencia_plataforma");
          expect(vistas.ok && vistas.rows.map((f) => f["clave"]).sort()).toEqual(
            [`ajena${k}`, k].sort(),
          );
          esperarFilas(
            await s.intentar("select 1 from idempotencia_plataforma where admin_id = $1", [
              ADMIN_DE_PRUEBA,
            ]),
            0,
          );
        });
      });

      it("SOPORTE registra las suyas; 'sistema', un desconocido y un administrador dado de baja no", async () => {
        await comoPlat(tokenDe(SOPORTE_DE_PRUEBA), async (s) => {
          esperarFilas(
            await insertar(s, SOPORTE_DE_PRUEBA, clave(), "altas.revocar_invitacion"),
            1,
          );
        });
        await comoPlat(tokenDe("sistema"), async (s) => {
          esperarRechazo(await insertar(s, ADMIN_DE_PRUEBA, clave()));
        });
        await comoPlat(tokenDe(ADMIN_DE_BAJA), async (s) => {
          esperarRechazo(await insertar(s, ADMIN_DE_BAJA, clave()));
        });
        await comoPlat(tokenDe(DESCONOCIDO), async (s) => {
          esperarRechazo(await insertar(s, DESCONOCIDO, clave()), ["42501", "23503"]);
        });
      });

      it("las claves no se modifican, ni se borran ni se truncan: tampoco las del dueño de la base", async () => {
        const k = clave();
        await dueno.query(
          `insert into idempotencia_plataforma (admin_id, clave, operacion, huella, resultado) values ($1, $2, 'x.y', $3, '{}'::jsonb)`,
          [ADMIN_DE_PRUEBA, k, "ab".repeat(32)],
        );
        for (const texto of [
          "update idempotencia_plataforma set resultado = '{\"ok\":false}'::jsonb",
          "delete from idempotencia_plataforma",
          "truncate idempotencia_plataforma",
        ]) {
          await expect(dueno.query(texto), texto).rejects.toMatchObject({ code: "42501" });
        }
        await comoPlat(tokenDe(ADMIN_DE_PRUEBA), async (s) => {
          esperarRechazo(
            await s.intentar("update idempotencia_plataforma set resultado = '{}'::jsonb"),
          );
          esperarRechazo(await s.intentar("delete from idempotencia_plataforma"));
        });
      });

      it("dos escrituras simultáneas con la misma clave: una entra y la otra choca con la clave primaria", async () => {
        const k = clave();
        const abrir = async () => {
          const c = new pg.Client({ connectionString: base!.plataforma });
          await c.connect();
          await c.query("begin");
          await c.query("select set_config('app.ctx', $1, true)", [tokenDe(ADMIN_DE_PRUEBA)]);
          return c;
        };
        const c1 = await abrir();
        const c2 = await abrir();
        const texto = `insert into idempotencia_plataforma (admin_id, clave, operacion, huella, resultado)
                       values ($1, $2, 'empresas.alta', $3, '{}'::jsonb)`;
        try {
          await c1.query(texto, [ADMIN_DE_PRUEBA, k, "ab".repeat(32)]);
          const segunda = c2.query(texto, [ADMIN_DE_PRUEBA, k, "ab".repeat(32)]).then(
            () => "entró",
            (e: { code?: string; constraint?: string }) => `${e.code}:${e.constraint}`,
          );
          await new Promise((r) => setTimeout(r, 200));
          await c1.query("commit");
          expect(await segunda).toBe("23505:idempotencia_plataforma_pkey");
        } finally {
          await c1.query("rollback").catch(() => undefined);
          await c2.query("rollback").catch(() => undefined);
          await c1.end();
          await c2.end();
        }
      });

      it("las columnas se restringen: clave de 16 a 128 caracteres seguros, operación en minúsculas, huella sha256 en hexadecimal", async () => {
        const insertarComoDueno = (c: string, operacion: string, huella: string) =>
          dueno.query(
            `insert into idempotencia_plataforma (admin_id, clave, operacion, huella, resultado) values ($1, $2, $3, $4, '{}'::jsonb)`,
            [ADMIN_DE_PRUEBA, c, operacion, huella],
          );
        const huellaBuena = "ab".repeat(32);
        const casos: ReadonlyArray<readonly [string, () => Promise<unknown>, string]> = [
          [
            "clave corta",
            () => insertarComoDueno("a".repeat(15), "x.y", huellaBuena),
            "idempotencia_plataforma_clave_ck",
          ],
          [
            "clave larga",
            () => insertarComoDueno("a".repeat(129), "x.y", huellaBuena),
            "idempotencia_plataforma_clave_ck",
          ],
          [
            "clave con espacio",
            () => insertarComoDueno(`${"a".repeat(15)} b`, "x.y", huellaBuena),
            "idempotencia_plataforma_clave_ck",
          ],
          [
            "clave con salto de línea",
            () => insertarComoDueno(`${"a".repeat(16)}\n`, "x.y", huellaBuena),
            "idempotencia_plataforma_clave_ck",
          ],
          [
            "operación en mayúsculas",
            () => insertarComoDueno(clave() + "aaaa", "Empresas.alta", huellaBuena),
            "idempotencia_plataforma_operacion_ck",
          ],
          [
            "operación vacía",
            () => insertarComoDueno(clave() + "aaaa", "", huellaBuena),
            "idempotencia_plataforma_operacion_ck",
          ],
          [
            "huella corta",
            () => insertarComoDueno(clave() + "aaaa", "x.y", "ab".repeat(31)),
            "idempotencia_plataforma_huella_ck",
          ],
          [
            "huella en mayúsculas",
            () => insertarComoDueno(clave() + "aaaa", "x.y", "AB".repeat(32)),
            "idempotencia_plataforma_huella_ck",
          ],
          [
            "huella con un salto de línea",
            () => insertarComoDueno(clave() + "aaaa", "x.y", `${huellaBuena}\n`),
            "idempotencia_plataforma_huella_ck",
          ],
        ];
        for (const [nombre, hacer, restriccion] of casos) {
          await expect(hacer(), nombre).rejects.toMatchObject({
            code: "23514",
            constraint: restriccion,
          });
        }
        await expect(
          insertarComoDueno("a".repeat(16), "empresas.alta", huellaBuena),
        ).resolves.toBeDefined();
        await expect(
          insertarComoDueno("a".repeat(128), "x_y.z", huellaBuena),
        ).resolves.toBeDefined();
        await expect(
          dueno.query(
            `insert into idempotencia_plataforma (admin_id, clave, operacion, huella, resultado) values ($1, $2, 'x.y', $3, null)`,
            [ADMIN_DE_PRUEBA, clave() + "aaaa", huellaBuena],
          ),
        ).rejects.toMatchObject({ code: "23502" });
        await expect(
          dueno.query(
            `insert into idempotencia_plataforma (admin_id, clave, operacion, huella, resultado) values ($1, $2, 'x.y', $3, '{}'::jsonb)`,
            [randomUUID(), clave() + "aaaa", huellaBuena],
          ),
        ).rejects.toMatchObject({ code: "23503" });
      });
    });

    describe("la auditoría de plataforma", () => {
      it("el actor registrado tiene que ser el del contexto firmado, y solo mientras el actor es vigente", async () => {
        await comoPlat(tokenDe(ADMIN_DE_PRUEBA), async (s) => {
          const auditar = (actor: string) =>
            s.intentar(
              "insert into auditoria_plataforma (actor, accion, entidad, entidad_id) values ($1, 'X', 'x', 'x')",
              [actor],
            );
          esperarFilas(await auditar(ADMIN_DE_PRUEBA), 1);
          for (const otro of [
            SOPORTE_DE_PRUEBA,
            OTRO_ADMIN,
            "sistema",
            "admin-de-prueba",
            "",
            ADMIN_DE_PRUEBA.toUpperCase(),
            ` ${ADMIN_DE_PRUEBA}`,
          ]) {
            esperarRechazo(await auditar(otro), ["42501", "23514"]);
          }
        });
      });

      it("no se modifica ni se borra ni se trunca, ni con los permisos del dueño", async () => {
        for (const texto of [
          "update auditoria_plataforma set accion = 'x'",
          "delete from auditoria_plataforma",
          "truncate auditoria_plataforma",
        ]) {
          await expect(dueno.query(texto), texto).rejects.toMatchObject({ code: "42501" });
        }
      });
    });
  });

  // ===========================================================================================
  // 4. La referencia de error
  // ===========================================================================================
  describe("referencia de error", () => {
    const insertar = (
      s: Sesion,
      valores: { empresa?: string | null; persona?: string | null; referencia?: string } = {},
    ) =>
      s.intentar(
        `insert into referencia_de_error (referencia, accion, motivo, empresa_id, persona_id)
         values ($1, 'usuarios.invitar', 'SIN_PERMISO', $2, $3)`,
        [valores.referencia ?? "ZH-A1B2-C3D4", valores.empresa ?? null, valores.persona ?? null],
      );
    const tokenApp = (cambios: Partial<CargaDeContexto> = {}) =>
      firmarCarga(base!.clave, carga({ u: "zuluhub_app", a: null, ...cambios }));

    it("el contexto operativo registra solo de su empresa y de su persona (o del sistema)", async () => {
      await conSesion(base!.app, tokenApp({ e: activa.empresa, p: personaMiembro }), async (s) => {
        esperarFilas(await insertar(s, { empresa: activa.empresa, persona: personaMiembro }), 1);
        esperarRechazo(await insertar(s, { empresa: enAlta.empresa, persona: personaMiembro }));
        esperarRechazo(await insertar(s, { empresa: activa.empresa, persona: propietario }));
        esperarRechazo(await insertar(s, { empresa: activa.empresa, persona: null }));
        esperarRechazo(await insertar(s, { empresa: null, persona: personaMiembro }));
        esperarRechazo(await insertar(s, { empresa: null, persona: null }));
      });
      await conSesion(base!.app, tokenApp({ e: activa.empresa, p: null }), async (s) => {
        esperarFilas(await insertar(s, { empresa: activa.empresa, persona: null }), 1);
        esperarRechazo(await insertar(s, { empresa: activa.empresa, persona: personaMiembro }));
      });
    });

    it("lo registra aunque la empresa no opere (el motivo puede ser, justamente, que está suspendida)", async () => {
      const suspendida = await crearEmpresaActiva(entorno);
      await dueno.query(
        "update empresa set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
        [suspendida.empresa],
      );
      await conSesion(base!.app, tokenApp({ e: suspendida.empresa }), async (s) => {
        esperarFilas(await insertar(s, { empresa: suspendida.empresa }), 1);
      });
    });

    it("quien llega con una invitación registra sin empresa ni persona; con la empresa del contexto operativo no", async () => {
      const conInvitacion = tokenApp({ i: tokenAlAzar().tokenHash });
      await conSesion(base!.app, conInvitacion, async (s) => {
        esperarFilas(await insertar(s), 1);
        esperarRechazo(await insertar(s, { empresa: activa.empresa }));
        esperarRechazo(await insertar(s, { persona: personaMiembro }));
      });
      // Un contexto de aplicación sin empresa ni invitación no registra nada.
      await conSesion(base!.app, tokenApp(), async (s) => {
        esperarRechazo(await insertar(s));
      });
      // Y uno con empresa Y token de invitación solo vale como operativo.
      await conSesion(
        base!.app,
        tokenApp({ e: activa.empresa, i: tokenAlAzar().tokenHash }),
        async (s) => {
          esperarRechazo(await insertar(s));
          esperarFilas(await insertar(s, { empresa: activa.empresa }), 1);
        },
      );
    });

    it("el grupo registra sin empresa y de la persona del contexto", async () => {
      const token = firmarCarga(
        base!.clave,
        carga({ u: "zuluhub_grupo", t: activa.tenant, p: propietario, a: null }),
      );
      await conSesion(base!.grupo, token, async (s) => {
        esperarFilas(await insertar(s, { persona: propietario }), 1);
        esperarRechazo(await insertar(s, { persona: personaMiembro }));
        esperarRechazo(await insertar(s, { persona: propietario, empresa: activa.empresa }));
        esperarRechazo(await insertar(s));
      });
    });

    it("los trabajos y la autenticación no registran ni leen (42501); la aplicación y el grupo registran pero no leen", async () => {
      const token = firmarCarga(base!.clave, carga({ u: "zuluhub_trabajos", a: null }));
      await conSesion(base!.trabajos, token, async (s) => {
        esperarRechazo(await insertar(s));
        esperarRechazo(await s.intentar("select * from referencia_de_error"));
      });
      await conSesion(base!.autenticacion, null, async (s) => {
        esperarRechazo(await insertar(s));
        esperarRechazo(await s.intentar("select * from referencia_de_error"));
      });
      await conSesion(base!.app, tokenApp({ e: activa.empresa }), async (s) => {
        esperarRechazo(await s.intentar("select * from referencia_de_error"));
        esperarRechazo(await s.intentar("select count(*) from referencia_de_error"));
        // INSERT ... RETURNING exige poder leer la fila: no está permitido.
        esperarRechazo(
          await s.intentar(
            `insert into referencia_de_error (referencia, accion, motivo, empresa_id) values ('ZH-0000-0001', 'a.b', 'X', $1) returning id`,
            [activa.empresa],
          ),
        );
      });
    });

    it("la plataforma las busca (ADMIN, SOPORTE y sistema) y las registra; sin actor vigente no ve ninguna", async () => {
      for (const actor of [ADMIN_DE_PRUEBA, SOPORTE_DE_PRUEBA, "sistema"]) {
        await comoPlat(tokenDe(actor), async (s) => {
          const r = await s.intentar(
            "select referencia from referencia_de_error where referencia = 'ZH-ABCD-1234'",
          );
          esperarFilas(r, 1);
          esperarFilas(
            await insertar(s, { empresa: activa.empresa, referencia: "ZH-0000-0002" }),
            1,
          );
          esperarFilas(await insertar(s, { referencia: "ZH-0000-0003" }), 1);
        });
      }
      for (const actor of [ADMIN_DE_BAJA, DESCONOCIDO, null]) {
        await comoPlat(tokenDe(actor), async (s) => {
          expect(await s.contar("referencia_de_error")).toBe(0);
        });
      }
    });

    it("el formato lo imponen los CHECK: referencia ZH-XXXX-XXXX en hexadecimal mayúscula; acción y motivo tipados, sin texto libre", async () => {
      const intentarComoDueno = (referencia: string, accion: string, motivo: string) =>
        dueno.query(
          "insert into referencia_de_error (referencia, accion, motivo) values ($1, $2, $3)",
          [referencia, accion, motivo],
        );
      const mal: ReadonlyArray<readonly [string, string, string, string]> = [
        ["referencia en minúsculas", "zh-abcd-1234", "usuarios.invitar", "SIN_PERMISO"],
        [
          "referencia con hexadecimal en minúsculas",
          "ZH-abcd-1234",
          "usuarios.invitar",
          "SIN_PERMISO",
        ],
        ["referencia sin prefijo", "AB-ABCD-1234", "usuarios.invitar", "SIN_PERMISO"],
        ["referencia larga", "ZH-ABCDE-1234", "usuarios.invitar", "SIN_PERMISO"],
        ["referencia no hexadecimal", "ZH-ABCG-1234", "usuarios.invitar", "SIN_PERMISO"],
        ["referencia con salto de línea", "ZH-ABCD-1234\n", "usuarios.invitar", "SIN_PERMISO"],
        ["acción con mayúsculas", "ZH-ABCD-1234", "Usuarios.invitar", "SIN_PERMISO"],
        ["acción con espacio", "ZH-ABCD-1234", "usuarios invitar", "SIN_PERMISO"],
        ["acción vacía", "ZH-ABCD-1234", "", "SIN_PERMISO"],
        ["acción con punto al final", "ZH-ABCD-1234", "usuarios.", "SIN_PERMISO"],
        [
          "acción con un dato adentro",
          "ZH-ABCD-1234",
          "usuarios.invitar:juan@x.com",
          "SIN_PERMISO",
        ],
        ["acción larguísima", "ZH-ABCD-1234", `${"a".repeat(80)}.b`, "SIN_PERMISO"],
        ["motivo en minúsculas", "ZH-ABCD-1234", "usuarios.invitar", "sin_permiso"],
        ["motivo con espacio", "ZH-ABCD-1234", "usuarios.invitar", "SIN PERMISO"],
        [
          "motivo con texto libre",
          "ZH-ABCD-1234",
          "usuarios.invitar",
          "No tiene permiso para ver la venta 123",
        ],
        ["motivo vacío", "ZH-ABCD-1234", "usuarios.invitar", ""],
        ["motivo que empieza con número", "ZH-ABCD-1234", "usuarios.invitar", "1SIN"],
        ["motivo larguísimo", "ZH-ABCD-1234", "usuarios.invitar", "A".repeat(81)],
      ];
      for (const [nombre, referencia, accion, motivo] of mal) {
        await expect(intentarComoDueno(referencia, accion, motivo), nombre).rejects.toMatchObject({
          code: "23514",
        });
      }
      await expect(
        intentarComoDueno("ZH-0123-ABCD", "sucursales.crear", "MODULO_NO_ACTIVO"),
      ).resolves.toBeDefined();
      await expect(intentarComoDueno("ZH-FFFF-0000", "a", "A")).resolves.toBeDefined();
      await expect(intentarComoDueno("ZH-FFFF-0001", "a_b.c_d.e", "A1_B2")).resolves.toBeDefined();
      await expect(
        intentarComoDueno("ZH-FFFF-0002", "a".repeat(80), "A".repeat(80)),
      ).resolves.toBeDefined();
    });

    it("la misma referencia puede repetirse (32 bits no son únicos): se busca y puede devolver más de una fila", async () => {
      await dueno.query(
        "insert into referencia_de_error (referencia, accion, motivo) values ('ZH-9999-9999', 'a.b', 'X'), ('ZH-9999-9999', 'a.c', 'Y')",
      );
      await comoPlat(tokenDe(SOPORTE_DE_PRUEBA), async (s) => {
        esperarFilas(
          await s.intentar("select * from referencia_de_error where referencia = 'ZH-9999-9999'"),
          2,
        );
      });
    });

    it("es de solo inserción: no se modifica ni se borra ni se trunca, ni con los permisos del dueño", async () => {
      for (const texto of [
        "update referencia_de_error set motivo = 'X'",
        "delete from referencia_de_error",
        "truncate referencia_de_error",
      ]) {
        await expect(dueno.query(texto), texto).rejects.toMatchObject({ code: "42501" });
      }
      await comoPlat(tokenDe(ADMIN_DE_PRUEBA), async (s) => {
        esperarRechazo(await s.intentar("update referencia_de_error set motivo = 'X'"));
        esperarRechazo(await s.intentar("delete from referencia_de_error"));
      });
    });

    it("la empresa y la persona referidas tienen que existir (clave foránea)", async () => {
      await expect(
        dueno.query(
          "insert into referencia_de_error (referencia, accion, motivo, empresa_id) values ('ZH-1111-1111', 'a.b', 'X', $1)",
          [randomUUID()],
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await expect(
        dueno.query(
          "insert into referencia_de_error (referencia, accion, motivo, persona_id) values ('ZH-1111-1111', 'a.b', 'X', $1)",
          [randomUUID()],
        ),
      ).rejects.toMatchObject({ code: "23503" });
    });
  });

  // ===========================================================================================
  // 5. El quinto rol, con conexión real
  // ===========================================================================================
  describe("zuluhub_autenticacion con una conexión real", () => {
    it("se conecta pero no lee ninguna tabla de negocio: 42501 en todas (tampoco contexto_clave ni migracion)", async () => {
      const tablas = await filas<{ t: string }>(
        `select c.relname as t from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')`,
      );
      expect(tablas.length).toBeGreaterThan(15);
      await conSesion(base!.autenticacion, null, async (s) => {
        for (const { t } of tablas) {
          const r = await s.intentar(`select * from ${t}`);
          esperarRechazo(r);
          expect(r.ok ? "" : r.mensaje, t).toMatch(/permission denied/);
          esperarRechazo(await s.intentar(`insert into ${t} default values`));
        }
        for (const consulta of [
          "select contexto_firmado()",
          "select cuit_valido('20123456786')",
          "select empresa_operable(gen_random_uuid())",
          "create table public.puerta_trasera (id int)",
          "create temp table empresa (id int)",
          "create schema autenticacion",
        ]) {
          esperarRechazo(await s.intentar(consulta));
        }
      });
    });

    it("no llega a los datos ni con un token de contexto de otro rol", async () => {
      const token = firmarCarga(
        base!.clave,
        carga({ u: "zuluhub_autenticacion", a: ADMIN_DE_PRUEBA }),
      );
      await conSesion(base!.autenticacion, token, async (s) => {
        esperarRechazo(await s.intentar("select * from tenant"));
        esperarRechazo(await s.intentar("select contexto_firmado()"));
      });
    });
  });

  // ===========================================================================================
  // 6. admin_plataforma: restricciones de la tabla, el disparador de membresías y la baja
  // ===========================================================================================
  describe("admin_plataforma", () => {
    const alta = (email: string, rol = "ADMIN", activo = true) =>
      dueno.query<{ id: string }>(
        "insert into admin_plataforma (email, rol, activo) values ($1, $2, $3) returning id",
        [email, rol, activo],
      );

    it("el email se guarda normalizado y con forma de email; el rol es ADMIN o SOPORTE; el email es único", async () => {
      for (const email of [
        "Mayuscula@prueba.test",
        " espacio@prueba.test",
        "espacio@prueba.test ",
        "sin-arroba",
        "@sin-usuario",
        "usuario@",
        "",
      ]) {
        await expect(alta(email), JSON.stringify(email)).rejects.toMatchObject({
          code: "23514",
          constraint: "admin_plataforma_email_ck",
        });
      }
      for (const rol of ["OTRO", "admin", "", "ADMINISTRADOR"]) {
        await expect(alta(emailAlAzar("rol"), rol), rol).rejects.toMatchObject({
          code: "23514",
          constraint: "admin_plataforma_rol_ck",
        });
      }
      const email = emailAlAzar("unico");
      await alta(email, "SOPORTE");
      await expect(alta(email)).rejects.toMatchObject({
        code: "23505",
        constraint: "admin_plataforma_email_uk",
      });
      await expect(
        dueno.query("insert into admin_plataforma (email, rol) values ($1, null)", [emailAlAzar()]),
      ).rejects.toMatchObject({ code: "23502" });
    });

    it("la regla del email es la misma de persona_email_ck (un test del catálogo de identidad la compara con TypeScript)", async () => {
      const [a, b] = await Promise.all([
        filas<{ def: string }>(
          `select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'admin_plataforma_email_ck'`,
        ),
        filas<{ def: string }>(
          `select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'persona_email_ck'`,
        ),
      ]);
      expect(a[0]?.def).toBe(b[0]?.def);
    });

    it("lleva versión y fecha de actualización: cada UPDATE sube la versión", async () => {
      const email = emailAlAzar("version");
      const id = (await alta(email)).rows[0]?.id as string;
      const antes = (
        await dueno.query<{ version: number; actualizado_en: Date }>(
          "select version, actualizado_en from admin_plataforma where id = $1",
          [id],
        )
      ).rows[0];
      expect(antes?.version).toBe(1);
      await dueno.query("update admin_plataforma set rol = 'SOPORTE' where id = $1", [id]);
      await dueno.query("update admin_plataforma set activo = false where id = $1", [id]);
      const despues = (
        await dueno.query<{ version: number }>(
          "select version from admin_plataforma where id = $1",
          [id],
        )
      ).rows[0];
      expect(despues?.version).toBe(3);
    });

    it("un administrador no se borra ni se trunca: la baja es activo = false (ni el dueño de la base)", async () => {
      await expect(
        dueno.query("delete from admin_plataforma where id = $1", [OTRO_ADMIN]),
      ).rejects.toMatchObject({ code: "42501" });
      // TRUNCATE: la clave foránea de idempotencia_plataforma (0A000) o el disparador (42501) lo frenan.
      const truncado = await dueno.query("truncate admin_plataforma").then(
        () => "se truncó",
        (e: { code?: string }) => e.code,
      );
      expect(["0A000", "42501"]).toContain(truncado);
    });

    it("la plataforma no escribe admin_plataforma, con ningún actor (42501): ni para darse de alta, ni para cambiar su rol", async () => {
      for (const actor of [ADMIN_DE_PRUEBA, SOPORTE_DE_PRUEBA, "sistema"]) {
        await comoPlat(tokenDe(actor), async (s) => {
          esperarRechazo(
            await s.intentar("insert into admin_plataforma (email, rol) values ($1, 'ADMIN')", [
              emailAlAzar("x"),
            ]),
          );
          esperarRechazo(await s.intentar("update admin_plataforma set rol = 'ADMIN'"));
          esperarRechazo(await s.intentar("update admin_plataforma set activo = true"));
          esperarRechazo(await s.intentar("delete from admin_plataforma"));
        });
      }
    });

    it("la plataforma lee a los administradores (para decidir permisos y chequear emails) con cualquier actor firmado", async () => {
      await comoPlat(tokenDe(SOPORTE_DE_PRUEBA), async (s) => {
        const r = await s.intentar(
          "select id, email, rol, activo from admin_plataforma where email = $1",
          [EMAIL_DE_ADMIN_DE_PRUEBA],
        );
        expect(r.ok && r.rows).toEqual([
          { id: ADMIN_DE_PRUEBA, email: EMAIL_DE_ADMIN_DE_PRUEBA, rol: "ADMIN", activo: true },
        ]);
      });
    });

    describe("no puede tener ninguna membresía (decisión F5)", () => {
      const conPersona = async (email: string) => crearPersonaDeBase(dueno, email);

      it("no se da de alta con el email de alguien con membresía en una empresa, activa o no", async () => {
        const activo = emailAlAzar("miembro-activo");
        const p1 = await conPersona(activo);
        await crearMembresiaDeBase(dueno, activa.empresa, p1.id, "OPERADOR", true);
        await expect(alta(activo)).rejects.toMatchObject({
          code: "23514",
          constraint: "admin_plataforma_sin_membresia",
        });
        const apagado = emailAlAzar("miembro-apagado");
        const p2 = await conPersona(apagado);
        await crearMembresiaDeBase(dueno, activa.empresa, p2.id, "OPERADOR", false);
        await expect(alta(apagado)).rejects.toMatchObject({
          code: "23514",
          constraint: "admin_plataforma_sin_membresia",
        });
      });

      it("tampoco con el de un propietario de grupo (membresía de tenant)", async () => {
        const email = emailAlAzar("propietario");
        const p = await conPersona(email);
        await dueno.query(
          "insert into membresia_tenant (persona_id, tenant_id, rol) values ($1, $2, 'PROPIETARIO')",
          [p.id, activa.tenant],
        );
        await expect(alta(email)).rejects.toMatchObject({
          code: "23514",
          constraint: "admin_plataforma_sin_membresia",
        });
      });

      it("con el email de una persona sin membresías sí (y de un email que nadie usa)", async () => {
        const email = emailAlAzar("sin-membresia");
        await conPersona(email);
        await expect(alta(email)).resolves.toBeDefined();
        await expect(alta(emailAlAzar("nadie"))).resolves.toBeDefined();
      });

      it("el mismo chequeo vale al reactivarlo y al cambiarle el email; un administrador de baja puede coexistir con una membresía", async () => {
        const email = emailAlAzar("reactivar");
        const id = (await alta(email, "ADMIN", false)).rows[0]?.id as string;
        const p = await conPersona(email);
        await crearMembresiaDeBase(dueno, activa.empresa, p.id, "OPERADOR");
        // De baja, convive con la membresía; reactivarlo, no.
        await expect(
          dueno.query("update admin_plataforma set activo = true where id = $1", [id]),
        ).rejects.toMatchObject({ code: "23514", constraint: "admin_plataforma_sin_membresia" });
        await expect(
          dueno.query("update admin_plataforma set rol = 'SOPORTE' where id = $1", [id]),
        ).resolves.toBeDefined();
        // Cambiar el email a uno con membresía, estando activo, tampoco.
        const otro = await alta(emailAlAzar("activo"));
        await expect(
          dueno.query("update admin_plataforma set email = $2 where id = $1", [
            otro.rows[0]?.id,
            email,
          ]),
        ).rejects.toMatchObject({ code: "23514", constraint: "admin_plataforma_sin_membresia" });
      });

      it("los administradores sembrados de las pruebas no tienen membresías (control)", async () => {
        const { rows } = await dueno.query(
          `select 1 from persona p join membresia m on m.persona_id = p.id
           join admin_plataforma a on a.email = p.email
         where a.id = any($1)`,
          [[ADMIN_DE_PRUEBA, SOPORTE_DE_PRUEBA]],
        );
        expect(rows).toEqual([]);
      });
    });
  });

  // ===========================================================================================
  // 7. Compatibilidad hacia atrás
  // ===========================================================================================
  describe("0004 sobre una base con datos de 0001 a 0003", () => {
    it(
      "no cambia los datos existentes ni lo que la aplicación, el grupo y los trabajos ven y escriben",
      { timeout: 30_000 },
      async () => {
        if (base === null) return;
        const real = join(import.meta.dirname, "../../migraciones");
        const previas = await mkdtemp(join(tmpdir(), "zuluhub-mig-previas-"));
        for (const archivo of ["0001_base.sql", "0002_identidad.sql", "0003_trabajos.sql"]) {
          await copyFile(join(real, archivo), join(previas, archivo));
        }
        const aparte = await crearBaseAparte(base, { migrar: false });
        const cliente = new pg.Client({ connectionString: aparte.base.dueno });
        try {
          expect((await aplicarMigraciones(aparte.base.dueno, previas)).aplicadas).toHaveLength(3);
          await instalarClaveDeContexto(aparte.base.dueno, base.clave);
          await cliente.connect();
          const { rows: t } = await cliente.query<{ id: string }>(
            "insert into tenant (nombre) values ('previo') returning id",
          );
          const tenant = t[0]?.id as string;
          const { rows: e } = await cliente.query<{ id: string }>(
            "insert into empresa (tenant_id, cuit, razon_social, estado) values ($1, $2, 'previa', 'ACTIVE') returning id",
            [tenant, cuitAlAzar()],
          );
          const empresa = e[0]?.id as string;
          await cliente.query(
            "insert into sucursal (empresa_id, nombre) values ($1, 'Casa central')",
            [empresa],
          );
          const antes = (
            await cliente.query<{ n: number }>("select count(*)::int as n from empresa")
          ).rows[0];

          const r = await aplicarMigraciones(aparte.base.dueno, real);
          expect(r.aplicadas).toEqual(["0004_plataforma.sql"]);
          expect((await cliente.query("select count(*)::int as n from empresa")).rows[0]).toEqual(
            antes,
          );

          // La aplicación sigue viendo y escribiendo lo suyo con el mismo contexto de antes.
          const app = new pg.Client({ connectionString: aparte.base.app });
          await app.connect();
          try {
            await app.query("begin");
            await app.query("select set_config('app.ctx', $1, true)", [
              firmarCarga(base.clave, carga({ u: "zuluhub_app", e: empresa, a: null })),
            ]);
            expect((await app.query("select count(*)::int as n from sucursal")).rows[0]).toEqual({
              n: 1,
            });
            await app.query("insert into sucursal (empresa_id, nombre) values ($1, 'Norte')", [
              empresa,
            ]);
            await app.query("rollback");
          } finally {
            await app.end();
          }
        } finally {
          await cliente.end().catch(() => undefined);
          await rm(previas, { recursive: true, force: true });
          await aparte.destruir();
        }
      },
    );
  });
});
