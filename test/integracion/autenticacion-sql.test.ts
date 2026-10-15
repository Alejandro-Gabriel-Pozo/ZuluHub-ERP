import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { firmarCarga } from "../../src/adaptadores/postgres/contexto-firmado";
import type { Contexto } from "../../src/contexto/contexto";
import { empresaId, personaId } from "../../src/primitivas/identificadores/marca";
import {
  conInvitacion,
  conSesion,
  crearUsuarioDeBase,
  empresaConMiembro,
  personaConUsuario,
  uuidAlAzar,
  vincularDeBase,
} from "./autenticacion-apoyo";
import {
  comoEmpresa,
  comoInvitacion,
  comoSesion,
  crearEmpresaActiva,
  crearEntornoDePrueba,
} from "./entorno";
import {
  acepta,
  check,
  clave,
  denegado,
  filas,
  intentoDelDueno,
  sinConfirmar,
} from "./fiscal-apoyo";
import {
  crearInvitacionDeBase,
  crearPersonaDeBase,
  emailAlAzar,
  incluirEmpresa,
  tokenAlAzar,
} from "./fixtures-identidad";
import { crearMarca, marcaPrincipal } from "./marcas-apoyo";
import { SesionDePrueba } from "./sesiones";

/**
 * Autenticación (W3a): la migración 0010 contra una base real. Dos mitades:
 *
 *  1. Catálogo: el esquema `autenticacion` (tablas, columnas, restricciones, RLS, privilegios), el vínculo
 *     `persona.usuario_auth_id` y las funciones y políticas de la puerta `SESION`, tal cual deben quedar.
 *  2. Comportamiento con el rol real y el contexto firmado: la sesión lee SOLO lo suyo (aislamiento entre
 *     usuarios y entre marcas), no escribe nada, el vínculo solo lo fija la invitación, y el rol de la
 *     librería solo toca sus tablas.
 */

const base = inject("baseDePruebas");

const TABLAS_DE_AUTENTICACION = [
  "account",
  "rateLimit",
  "session",
  "user",
  "verification",
] as const;
const OTROS_ROLES = [
  "zuluhub_app",
  "zuluhub_grupo",
  "zuluhub_trabajos",
  "zuluhub_plataforma",
  "zuluhub_publico",
  "zuluhub_captacion",
] as const;

describe.skipIf(base === null)("autenticación: la migración 0010 contra una base real", () => {
  let dueno: pg.Client;

  beforeAll(async () => {
    if (base === null) return;
    dueno = new pg.Client({ connectionString: base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
  });

  const consulta = async <T extends Record<string, unknown>>(
    texto: string,
    parametros: unknown[] = [],
  ) => (await dueno.query<T>(texto, parametros)).rows;

  // =============================================================================================
  // 1. Catálogo
  // =============================================================================================
  describe("catálogo: el esquema de la librería", () => {
    it("el esquema `autenticacion` tiene exactamente las cinco tablas de la librería, y nada más", async () => {
      const objetos = await consulta<{ relname: string; relkind: string }>(
        `select c.relname, c.relkind from pg_class c
         where c.relnamespace = 'autenticacion'::regnamespace and c.relkind not in ('i', 'S', 'c')
         order by 1`,
      );
      expect(objetos).toEqual(
        TABLAS_DE_AUTENTICACION.map((relname) => ({ relname, relkind: "r" })),
      );
      // Las claves son uuid: ninguna secuencia ni identity (`generateId: "uuid"`).
      expect(
        await consulta(
          `select 1 from pg_class where relnamespace = 'autenticacion'::regnamespace and relkind = 'S'`,
        ),
      ).toEqual([]);
    });

    it("las columnas y sus tipos son los que declara Better Auth 1.7.7 (más `session.host`)", async () => {
      const filasDeColumnas = await consulta<{ t: string; c: string; tipo: string; nulo: string }>(
        `select table_name as t, column_name as c, data_type as tipo, is_nullable as nulo
         from information_schema.columns where table_schema = 'autenticacion'
         order by table_name, ordinal_position`,
      );
      const porTabla = (t: string) =>
        filasDeColumnas.filter((f) => f.t === t).map((f) => `${f.c}:${f.tipo}:${f.nulo}`);
      expect(porTabla("user")).toEqual([
        "id:uuid:NO",
        "name:text:NO",
        "email:text:NO",
        "emailVerified:boolean:NO",
        "image:text:YES",
        "createdAt:timestamp with time zone:NO",
        "updatedAt:timestamp with time zone:NO",
      ]);
      expect(porTabla("session")).toEqual([
        "id:uuid:NO",
        "expiresAt:timestamp with time zone:NO",
        "token:text:NO",
        "createdAt:timestamp with time zone:NO",
        "updatedAt:timestamp with time zone:NO",
        "ipAddress:text:YES",
        "userAgent:text:YES",
        "userId:uuid:NO",
        "host:text:NO",
      ]);
      expect(porTabla("account")).toEqual([
        "id:uuid:NO",
        "accountId:text:NO",
        "providerId:text:NO",
        "userId:uuid:NO",
        "accessToken:text:YES",
        "refreshToken:text:YES",
        "idToken:text:YES",
        "accessTokenExpiresAt:timestamp with time zone:YES",
        "refreshTokenExpiresAt:timestamp with time zone:YES",
        "scope:text:YES",
        "password:text:YES",
        "createdAt:timestamp with time zone:NO",
        "updatedAt:timestamp with time zone:NO",
      ]);
      expect(porTabla("verification")).toEqual([
        "id:uuid:NO",
        "identifier:text:NO",
        "value:text:NO",
        "expiresAt:timestamp with time zone:NO",
        "createdAt:timestamp with time zone:NO",
        "updatedAt:timestamp with time zone:NO",
      ]);
      expect(porTabla("rateLimit")).toEqual([
        "id:uuid:NO",
        "key:text:NO",
        "count:integer:NO",
        "lastRequest:bigint:NO",
      ]);
    });

    it("las restricciones tienen los nombres que el registro de contratos declara", async () => {
      const restricciones = await consulta<{ nombre: string }>(
        `select format('%s.%s:%s', conrelid::regclass, conname, contype) as nombre from pg_constraint
         where connamespace = 'autenticacion'::regnamespace and contype <> 'n' order by 1`,
      );
      expect(restricciones.map((r) => r.nombre)).toEqual(
        [
          'autenticacion."rateLimit".rate_limit_key_uk:u',
          'autenticacion."rateLimit".rate_limit_pkey:p',
          'autenticacion."user".user_email_uk:u',
          'autenticacion."user".user_pkey:p',
          "autenticacion.account.account_pkey:p",
          "autenticacion.account.account_proveedor_sub_uq:u",
          "autenticacion.account.account_user_id_fkey:f",
          "autenticacion.session.session_host_ck:c",
          "autenticacion.session.session_pkey:p",
          "autenticacion.session.session_token_uk:u",
          "autenticacion.session.session_user_id_fkey:f",
          "autenticacion.verification.verification_pkey:p",
        ].sort(),
      );
    });

    it("RLS activa y forzada en las cinco tablas, con una política por comando solo para el rol de la librería", async () => {
      const tablas = await consulta<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `select relname, relrowsecurity, relforcerowsecurity from pg_class
         where relnamespace = 'autenticacion'::regnamespace and relkind = 'r' order by 1`,
      );
      expect(tablas).toHaveLength(5);
      for (const t of tablas) {
        expect(t.relrowsecurity, `${t.relname}: RLS activo`).toBe(true);
        expect(t.relforcerowsecurity, `${t.relname}: RLS forzado`).toBe(true);
      }
      const politicas = await consulta<{ p: string }>(
        `select format('%s:%s:%s:%s:%s', tablename, policyname, cmd, permissive, array_to_string(roles, '+')) as p
         from pg_policies where schemaname = 'autenticacion' order by 1`,
      );
      const esperadas = TABLAS_DE_AUTENTICACION.flatMap((t) =>
        [
          ["rol_autenticacion_alta", "INSERT"],
          ["rol_autenticacion_borrar", "DELETE"],
          ["rol_autenticacion_cambiar", "UPDATE"],
          ["rol_autenticacion_leer", "SELECT"],
        ].map(([nombre, cmd]) => `${t}:${nombre}:${cmd}:PERMISSIVE:zuluhub_autenticacion`),
      );
      expect(politicas.map((p) => p.p)).toEqual(esperadas.sort());
    });

    it("`session.host` es obligatorio y se guarda normalizado (sin él una cookie de una marca valdría en otra)", async () => {
      await sinConfirmar(dueno, async () => {
        const usuario = await crearUsuarioDeBase(dueno);
        const insertar = (host: string | null) =>
          intentoDelDueno(
            dueno,
            `insert into autenticacion.session ("expiresAt", token, "userId", host)
             values (now() + interval '1 hour', $1, $2, $3)`,
            [uuidAlAzar(), usuario.id, host],
          );
        const sinHost = await insertar(null);
        expect(sinHost.ok).toBe(false);
        if (!sinHost.ok) expect(sinHost.codigo).toBe("23502");
        for (const mal of ["", " app.zuluhub.test", "App.ZuluHub.test", "app.zuluhub.test "]) {
          check(await insertar(mal), "session_host_ck");
        }
        acepta(await insertar("app.zuluhub.test"));
      });
    });

    it("una cuenta de proveedor (providerId + accountId) es de un solo usuario", async () => {
      await sinConfirmar(dueno, async () => {
        const a = await crearUsuarioDeBase(dueno);
        const b = await crearUsuarioDeBase(dueno);
        const cuenta = (usuario: string, sub: string) =>
          intentoDelDueno(
            dueno,
            `insert into autenticacion.account ("accountId", "providerId", "userId") values ($1, 'google', $2)`,
            [sub, usuario],
          );
        const sub = uuidAlAzar();
        acepta(await cuenta(a.id, sub));
        clave(await cuenta(b.id, sub), "account_proveedor_sub_uq");
        // El mismo `sub` de otro proveedor sí es otra cuenta.
        acepta(
          await intentoDelDueno(
            dueno,
            `insert into autenticacion.account ("accountId", "providerId", "userId") values ($1, 'otro', $2)`,
            [sub, b.id],
          ),
        );
      });
    });

    it("el email del usuario es único y borrar un usuario borra sus sesiones y cuentas (ON DELETE CASCADE)", async () => {
      await sinConfirmar(dueno, async () => {
        const u = await crearUsuarioDeBase(dueno);
        clave(
          await intentoDelDueno(
            dueno,
            `insert into autenticacion."user" (name, email) values ('otro', $1)`,
            [u.email],
          ),
          "user_email_uk",
        );
        await dueno.query(
          `insert into autenticacion.session ("expiresAt", token, "userId", host)
           values (now() + interval '1 hour', $1, $2, 'app.zuluhub.test')`,
          [uuidAlAzar(), u.id],
        );
        await dueno.query(
          `insert into autenticacion.account ("accountId", "providerId", "userId") values ('x', 'google', $1)`,
          [u.id],
        );
        await dueno.query(`delete from autenticacion."user" where id = $1`, [u.id]);
        expect(
          await consulta(`select 1 from autenticacion.session where "userId" = $1`, [u.id]),
        ).toEqual([]);
        expect(
          await consulta(`select 1 from autenticacion.account where "userId" = $1`, [u.id]),
        ).toEqual([]);
      });
    });
  });

  describe("catálogo: privilegios", () => {
    it("el rol de la librería tiene USAGE (sin CREATE) en su esquema, SELECT/INSERT/UPDATE en sus cinco tablas y DELETE solo donde se usa (0013: no en `user` ni `account`), y NADA más", async () => {
      const esquema = await consulta<{ usage: boolean; create: boolean }>(
        `select has_schema_privilege('zuluhub_autenticacion', 'autenticacion', 'USAGE') as usage,
                has_schema_privilege('zuluhub_autenticacion', 'autenticacion', 'CREATE') as "create"`,
      );
      expect(esquema).toEqual([{ usage: true, create: false }]);
      const privilegios = await consulta<{ t: string; p: string }>(
        `select table_name as t, privilege_type as p from information_schema.table_privileges
         where table_schema = 'autenticacion' and grantee = 'zuluhub_autenticacion' order by 1, 2`,
      );
      // 0013 le quitó DELETE sobre `user` y `account` (no hay camino que borre un usuario o una cuenta).
      const CON_DELETE = ["rateLimit", "session", "verification"];
      expect(privilegios).toEqual(
        TABLAS_DE_AUTENTICACION.flatMap((t) =>
          (CON_DELETE.includes(t)
            ? ["DELETE", "INSERT", "SELECT", "UPDATE"]
            : ["INSERT", "SELECT", "UPDATE"]
          ).map((p) => ({ t, p })),
        ).sort((a, b) => (a.t === b.t ? a.p.localeCompare(b.p) : a.t < b.t ? -1 : 1)),
      );
      // Ningún TRUNCATE/REFERENCES/TRIGGER en ningún esquema (lo de `public` lo cubre `plataforma-sql`).
      expect(
        await consulta(
          `select 1 from information_schema.table_privileges
           where grantee = 'zuluhub_autenticacion' and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')`,
        ),
      ).toEqual([]);
    });

    it("ningún otro rol ni PUBLIC tocan el esquema `autenticacion`: ni USAGE ni privilegios en sus tablas", async () => {
      for (const rol of OTROS_ROLES) {
        const { rows } = await dueno.query<{ usage: boolean; create: boolean }>(
          `select has_schema_privilege($1, 'autenticacion', 'USAGE') as usage,
                  has_schema_privilege($1, 'autenticacion', 'CREATE') as "create"`,
          [rol],
        );
        expect(rows[0], rol).toEqual({ usage: false, create: false });
        for (const tabla of TABLAS_DE_AUTENTICACION) {
          const { rows: t } = await dueno.query<{ puede: boolean }>(
            `select (has_table_privilege($1, format('autenticacion.%I', $2::text), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                     or has_any_column_privilege($1, format('autenticacion.%I', $2::text), 'SELECT,INSERT,UPDATE,REFERENCES')) as puede`,
            [rol, tabla],
          );
          expect(t[0]?.puede, `${rol} sobre autenticacion.${tabla}`).toBe(false);
        }
      }
      expect(
        await consulta(
          `select 1 from pg_namespace n, aclexplode(n.nspacl) a
           where n.nspname = 'autenticacion' and a.grantee = 0`,
        ),
      ).toEqual([]);
      expect(
        await consulta(
          `select 1 from pg_class c, aclexplode(c.relacl) a
           where c.relnamespace = 'autenticacion'::regnamespace and a.grantee = 0`,
        ),
      ).toEqual([]);
    });

    it("el rol de la librería no puede tocar NINGUNA tabla de negocio ni crear nada (42501), con lo que `public` no es de su alcance", async () => {
      const cliente = new pg.Client({ connectionString: base?.autenticacion });
      await cliente.connect();
      try {
        const tablas = await consulta<{ relname: string }>(
          `select relname from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'p') order by 1`,
        );
        expect(tablas.length).toBeGreaterThan(30);
        for (const { relname } of tablas) {
          const [primera] = await consulta<{ column_name: string }>(
            `select column_name from information_schema.columns
             where table_schema = 'public' and table_name = $1 and is_identity = 'NO' and is_generated = 'NEVER'
             order by ordinal_position limit 1`,
            [relname],
          );
          const columna = primera?.column_name as string;
          for (const texto of [
            `select 1 from public.${relname} limit 1`,
            `delete from public.${relname}`,
            `update public.${relname} set ${columna} = ${columna}`,
          ]) {
            const r = await cliente.query(texto).then(
              () => null,
              (e: { code?: string }) => e.code ?? "?",
            );
            expect(r, texto).toBe("42501");
          }
        }
        for (const texto of [
          "create table autenticacion.intrusa (id int)",
          "create table public.intrusa (id int)",
          "create schema intruso",
          "create function autenticacion.f() returns int language sql as 'select 1'",
          "drop table autenticacion.session",
          "alter table autenticacion.session add column x int",
          "truncate autenticacion.session",
        ]) {
          const r = await cliente.query(texto).then(
            () => null,
            (e: { code?: string }) => e.code ?? "?",
          );
          expect(r, texto).toBe("42501");
        }
        // Y con sus propias tablas, sí: lo que la librería necesita.
        await cliente.query("begin");
        await cliente.query(
          `insert into autenticacion."rateLimit" (key, count, "lastRequest") values ($1, 1, 1)`,
          [uuidAlAzar()],
        );
        const leidas = await cliente.query<{ n: number }>(
          `select count(*)::int as n from autenticacion."rateLimit"`,
        );
        expect(leidas.rows[0]?.n).toBeGreaterThan(0);
        await cliente.query("rollback");
      } finally {
        await cliente.end();
      }
    });

    it("las funciones nuevas corren con los permisos de quien consulta y solo las ejecuta la aplicación", async () => {
      const funciones = await consulta<{
        nombre: string;
        secdef: boolean;
        config: string[] | null;
      }>(
        `select p.oid::regprocedure::text as nombre, p.prosecdef as secdef, p.proconfig as config
         from pg_proc p where p.pronamespace = 'public'::regnamespace
           and p.proname in ('app_usuario_auth', 'app_persona_de_sesion', 'persona_validar_vinculo')
         order by 1`,
      );
      expect(funciones.map((f) => f.nombre)).toEqual([
        "app_persona_de_sesion()",
        "app_usuario_auth()",
        "persona_validar_vinculo()",
      ]);
      for (const f of funciones) {
        expect(f.secdef, `${f.nombre} no es SECURITY DEFINER`).toBe(false);
        expect(f.config, f.nombre).toContain("search_path=pg_catalog, public, pg_temp");
      }
      for (const funcion of ["app_usuario_auth()", "app_persona_de_sesion()"]) {
        for (const rol of [...OTROS_ROLES, "zuluhub_autenticacion"]) {
          const { rows } = await dueno.query<{ puede: boolean }>(
            `select has_function_privilege($1, $2::regprocedure, 'EXECUTE') as puede`,
            [rol, `public.${funcion}`],
          );
          expect(rows[0]?.puede, `${rol} ejecuta ${funcion}`).toBe(rol === "zuluhub_app");
        }
      }
    });

    it("`contexto_firmado()` sigue siendo la ÚNICA SECURITY DEFINER (el claim `s` viaja en su mismo payload)", async () => {
      const definer = await consulta<{ proname: string }>(
        `select proname from pg_proc where pronamespace = 'public'::regnamespace and prosecdef`,
      );
      expect(definer).toEqual([{ proname: "contexto_firmado" }]);
      expect(
        await consulta(
          `select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'autenticacion' and p.prosecdef`,
        ),
      ).toEqual([]);
    });
  });

  describe("catálogo: el vínculo persona <-> usuario", () => {
    it("`persona.usuario_auth_id` es un uuid nulo, único, sin clave foránea, con su disparador", async () => {
      const columna = await consulta<{
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }>(
        `select data_type, is_nullable, column_default from information_schema.columns
         where table_schema = 'public' and table_name = 'persona' and column_name = 'usuario_auth_id'`,
      );
      expect(columna).toEqual([{ data_type: "uuid", is_nullable: "YES", column_default: null }]);
      const restricciones = await consulta<{ conname: string; contype: string }>(
        `select conname, contype from pg_constraint
         where conrelid = 'public.persona'::regclass and conname like '%usuario_auth%'`,
      );
      expect(restricciones).toEqual([{ conname: "persona_usuario_auth_id_uk", contype: "u" }]);
      const disparador = await consulta<{ def: string }>(
        `select pg_get_triggerdef(oid) as def from pg_trigger
         where tgrelid = 'public.persona'::regclass and tgname = 'persona_vinculo_inmutable'`,
      );
      expect(disparador[0]?.def).toContain("BEFORE UPDATE OF usuario_auth_id ON public.persona");
    });

    it("el vínculo se fija una vez y no cambia ni se quita, ni siquiera por SQL del dueño; un usuario es de una sola persona", async () => {
      await sinConfirmar(dueno, async () => {
        const a = await crearPersonaDeBase(dueno);
        const b = await crearPersonaDeBase(dueno);
        const u1 = await crearUsuarioDeBase(dueno);
        const u2 = await crearUsuarioDeBase(dueno);
        acepta(
          await intentoDelDueno(dueno, "update persona set usuario_auth_id = $2 where id = $1", [
            a.id,
            u1.id,
          ]),
        );
        // Repetir el mismo valor no cambia nada: se deja pasar.
        acepta(
          await intentoDelDueno(dueno, "update persona set usuario_auth_id = $2 where id = $1", [
            a.id,
            u1.id,
          ]),
        );
        check(
          await intentoDelDueno(dueno, "update persona set usuario_auth_id = $2 where id = $1", [
            a.id,
            u2.id,
          ]),
          "persona_usuario_auth_inmutable",
        );
        check(
          await intentoDelDueno(dueno, "update persona set usuario_auth_id = null where id = $1", [
            a.id,
          ]),
          "persona_usuario_auth_inmutable",
        );
        clave(
          await intentoDelDueno(dueno, "update persona set usuario_auth_id = $2 where id = $1", [
            b.id,
            u1.id,
          ]),
          "persona_usuario_auth_id_uk",
        );
        // Muchas personas sin usuario conviven (la única no cuenta los nulos).
        const c = await crearPersonaDeBase(dueno);
        const d = await crearPersonaDeBase(dueno);
        expect([c.id, d.id]).toHaveLength(2);
      });
    });

    it("no se puede dar de alta una persona con un `s` falso: el rol de la aplicación solo inserta `email`", async () => {
      const columnas = await consulta<{
        grantee: string;
        column_name: string;
        privilege_type: string;
      }>(
        `select grantee, column_name, privilege_type from information_schema.column_privileges
         where table_schema = 'public' and table_name = 'persona' and column_name = 'usuario_auth_id'
           and grantee like 'zuluhub\\_%' escape '\\' order by 1, 3`,
      );
      expect(columnas).toEqual(
        [
          // SELECT por el SELECT de la tabla entera (0001, y el rol de respaldo); UPDATE solo para la aplicación (0010).
          ...["zuluhub_app", "zuluhub_grupo", "zuluhub_plataforma", "zuluhub_respaldo"].map(
            (grantee) => ({
              grantee,
              column_name: "usuario_auth_id",
              privilege_type: "SELECT",
            }),
          ),
          { grantee: "zuluhub_app", column_name: "usuario_auth_id", privilege_type: "UPDATE" },
        ].sort((x, y) =>
          x.grantee === y.grantee
            ? x.privilege_type.localeCompare(y.privilege_type)
            : x.grantee < y.grantee
              ? -1
              : 1,
        ),
      );
    });
  });

  // =============================================================================================
  // 2. La puerta SESION
  // =============================================================================================
  describe("la puerta SESION: lee lo suyo y nada más", () => {
    // Un escenario con varios usuarios y dos marcas.
    type Escenario = Awaited<ReturnType<typeof armar>>;
    let e: Escenario;

    async function armar() {
      const principal = await marcaPrincipal(dueno);
      const otraMarca = await crearMarca(dueno);
      // A: dos empresas de la marca principal (una con membresía apagada) y una de otra marca.
      const a = await personaConUsuario(dueno);
      const a1 = await empresaConMiembro(dueno, a, { marca: principal });
      const a2 = await empresaConMiembro(dueno, a, { marca: principal, activo: false });
      const a3 = await empresaConMiembro(dueno, a, { marca: otraMarca, rol: "GERENTE" });
      // B: otra persona con su empresa.
      const b = await personaConUsuario(dueno);
      const b1 = await empresaConMiembro(dueno, b, { marca: principal });
      // El compañero de A en a1 (para que `persona_miembros_app` tenga a quién mostrarle al operativo).
      const colega = await personaConUsuario(dueno);
      await dueno.query(
        "insert into membresia (empresa_id, persona_id, rol) values ($1, $2, 'ADMINISTRADOR')",
        [a1.empresa, colega.persona],
      );
      // C: persona suspendida globalmente (con membresía activa).
      const c = await personaConUsuario(dueno, { activaGlobal: false });
      const c1 = await empresaConMiembro(dueno, c, { marca: principal });
      // D: persona SIN usuario vinculado, con membresía.
      const d = await crearPersonaDeBase(dueno);
      const d1 = await empresaConMiembro(dueno, { persona: d.id }, { marca: principal });
      // E: un usuario sin persona.
      const usuarioSolo = await crearUsuarioDeBase(dueno);
      return { principal, otraMarca, a, a1, a2, a3, b, b1, colega, c, c1, d, d1, usuarioSolo };
    }

    beforeAll(async () => {
      if (base === null) return;
      e = await armar();
    });

    const ids = (r: { rows: Record<string, unknown>[] }, columna: string) =>
      r.rows.map((f) => String(f[columna])).sort();

    it("la sesión de A ve su persona, sus membresías ACTIVAS, sus empresas y sus tenants, y nada de B", async () => {
      await conSesion(base!, e.a.usuario, async (s) => {
        const persona = await s.intentar("select id, email, usuario_auth_id from persona");
        acepta(persona);
        if (persona.ok) {
          expect(persona.rows).toEqual([
            { id: e.a.persona, email: e.a.email, usuario_auth_id: e.a.usuario },
          ]);
        }
        const membresias = await s.intentar(
          "select empresa_id, persona_id, rol, activo from membresia",
        );
        acepta(membresias);
        if (membresias.ok) {
          // a1 (operador activo) y a3 (gerente activo); NO a2 (apagada) ni la de nadie más.
          expect(ids(membresias, "empresa_id")).toEqual([e.a1.empresa, e.a3.empresa].sort());
          expect(
            membresias.rows.every((f) => f["persona_id"] === e.a.persona && f["activo"] === true),
          ).toBe(true);
        }
        const empresas = await s.intentar("select id from empresa");
        acepta(empresas);
        if (empresas.ok) expect(ids(empresas, "id")).toEqual([e.a1.empresa, e.a3.empresa].sort());
        const tenants = await s.intentar("select id, marca_id from tenant");
        acepta(tenants);
        if (tenants.ok) expect(ids(tenants, "id")).toEqual([e.a1.tenant, e.a3.tenant].sort());
      });
    });

    it("cada usuario ve lo suyo: la sesión de B no ve nada de A, y viceversa", async () => {
      await conSesion(base!, e.b.usuario, async (s) => {
        const r = await s.intentar(
          `select (select count(*) from persona)::int as personas, (select count(*) from membresia)::int as membresias,
                  (select count(*) from empresa)::int as empresas, (select count(*) from tenant)::int as tenants`,
        );
        acepta(r);
        if (r.ok) expect(r.rows).toEqual([{ personas: 1, membresias: 1, empresas: 1, tenants: 1 }]);
        const empresa = await s.intentar("select id from empresa");
        if (empresa.ok) expect(ids(empresa, "id")).toEqual([e.b1.empresa]);
        // Consultas dirigidas a lo ajeno: cero filas, no error (la política filtra, no avisa).
        filas(await s.intentar("select 1 from persona where id = $1", [e.a.persona]), 0);
        filas(await s.intentar("select 1 from membresia where persona_id = $1", [e.a.persona]), 0);
        filas(await s.intentar("select 1 from empresa where id = $1", [e.a1.empresa]), 0);
        filas(await s.intentar("select 1 from tenant where id = $1", [e.a1.tenant]), 0);
      });
    });

    it("una persona suspendida globalmente no ve nada con su sesión (ni su persona ni sus empresas)", async () => {
      await conSesion(base!, e.c.usuario, async (s) => {
        for (const tabla of ["persona", "membresia", "empresa", "tenant"]) {
          filas(await s.intentar(`select 1 from ${tabla}`), 0);
        }
      });
    });

    it("un usuario sin persona vinculada no ve nada; tampoco la persona sin usuario ve algo por su email", async () => {
      await conSesion(base!, e.usuarioSolo.id, async (s) => {
        for (const tabla of ["persona", "membresia", "empresa", "tenant"]) {
          filas(await s.intentar(`select 1 from ${tabla}`), 0);
        }
      });
      // La persona D tiene el email de... nadie: no hay forma de llegar a ella sin un vínculo.
      const sinVinculo = await crearUsuarioDeBase(dueno, `${e.d.email}.otro`);
      await conSesion(base!, sinVinculo.id, async (s) => {
        filas(await s.intentar("select 1 from persona where id = $1", [e.d.id]), 0);
        filas(await s.intentar("select 1 from membresia where persona_id = $1", [e.d.id]), 0);
      });
    });

    it("la lectura sigue al vínculo: un usuario que se vincula después empieza a ver sus empresas", async () => {
      const usuario = await crearUsuarioDeBase(dueno);
      const persona = await crearPersonaDeBase(dueno);
      const empresa = await empresaConMiembro(dueno, { persona: persona.id });
      await conSesion(base!, usuario.id, async (s) => {
        filas(await s.intentar("select 1 from empresa"), 0);
      });
      await vincularDeBase(dueno, persona.id, usuario.id);
      await conSesion(base!, usuario.id, async (s) => {
        const r = await s.intentar("select id from empresa");
        acepta(r);
        if (r.ok) expect(ids(r, "id")).toEqual([empresa.empresa]);
      });
    });

    it("la sesión no ve NINGUNA otra tabla: solo persona, membresía, empresa y tenant difieren de un contexto sin datos", async () => {
      const tablas = await consulta<{ relname: string }>(
        `select c.relname from pg_class c
         where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
           and has_table_privilege('zuluhub_app', c.oid, 'SELECT') order by 1`,
      );
      expect(tablas.length).toBeGreaterThan(20);
      const vacio = await crearUsuarioDeBase(dueno);
      const cuenta = async (usuario: string, tabla: string): Promise<number> =>
        conSesion(base!, usuario as typeof e.a.usuario, async (s) => {
          const r = await s.intentar(`select count(*)::int as n from ${tabla}`);
          if (!r.ok) throw new Error(`${tabla}: ${r.codigo} ${r.mensaje}`);
          return Number(r.rows[0]?.["n"]);
        });
      const conDatos: string[] = [];
      for (const { relname } of tablas) {
        const propia = await cuenta(e.a.usuario, relname);
        const ajena = await cuenta(vacio.id, relname);
        if (propia !== ajena) conDatos.push(relname);
      }
      expect(conDatos.sort()).toEqual(["empresa", "membresia", "persona", "tenant"]);
    });

    it("la sesión NO escribe nada: ni insertar, ni actualizar, ni borrar en las cuatro tablas que lee", async () => {
      await conSesion(base!, e.a.usuario, async (s) => {
        // Sin privilegio de columna o sin política: nunca una fila afectada.
        denegado(await s.intentar("insert into persona (email) values ('intruso@prueba.test')"));
        denegado(
          await s.intentar("update persona set activo_global = false where id = $1", [e.a.persona]),
        );
        denegado(await s.intentar("delete from persona where id = $1", [e.a.persona]));
        denegado(
          await s.intentar(
            "insert into membresia (empresa_id, persona_id, rol) values ($1, $2, 'GERENTE')",
            [e.b1.empresa, e.a.persona],
          ),
        );
        denegado(await s.intentar("delete from membresia where persona_id = $1", [e.a.persona]));
        denegado(await s.intentar("delete from empresa where id = $1", [e.a1.empresa]));
        denegado(await s.intentar("delete from tenant where id = $1", [e.a1.tenant]));
        denegado(await s.intentar("update tenant set nombre = 'x' where id = $1", [e.a1.tenant]));
        denegado(
          await s.intentar(
            "insert into empresa (tenant_id, cuit, razon_social) values ($1, '20000000001', 'x')",
            [e.a1.tenant],
          ),
        );
        // Con privilegio de columna (la aplicación opera con el contexto OPERATIVO), la política no deja pasar nada.
        filas(
          await s.intentar("update membresia set activo = false where persona_id = $1", [
            e.a.persona,
          ]),
          0,
        );
        filas(
          await s.intentar(
            "update empresa set estado = 'SUSPENDED', motivo_estado = 'x' where id = $1",
            [e.a1.empresa],
          ),
          0,
        );
        filas(
          await s.intentar("update persona set usuario_auth_id = $2 where id = $1", [
            e.a.persona,
            e.b.usuario,
          ]),
          0,
        );
      });
      // Y nada cambió.
      const { rows } = await dueno.query(
        "select (select activo_global from persona where id = $1) as activo, (select usuario_auth_id from persona where id = $1) as usuario, (select count(*)::int from membresia where persona_id = $1 and activo) as activas",
        [e.a.persona],
      );
      expect(rows[0]).toEqual({ activo: true, usuario: e.a.usuario, activas: 2 });
    });

    it("el contexto OPERATIVO no gana nada con esto: una empresa ve solo lo suyo, no las demás de sus miembros", async () => {
      // Un miembro de a1 (el colega) tiene empresas en otros lados; el contexto operativo de a1 ve solo a1.
      const otra = await empresaConMiembro(dueno, e.colega);
      const s = await SesionDePrueba.abrir(
        base!,
        "zuluhub_app",
        comoEmpresa(empresaId(e.a1.empresa), personaId(e.a.persona)),
      );
      try {
        const empresas = await s.intentar("select id from empresa");
        if (empresas.ok) expect(ids(empresas, "id")).toEqual([e.a1.empresa]);
        const membresias = await s.intentar("select empresa_id from membresia");
        if (membresias.ok)
          expect(new Set(ids(membresias, "empresa_id"))).toEqual(new Set([e.a1.empresa]));
        filas(await s.intentar("select 1 from membresia where empresa_id = $1", [otra.empresa]), 0);
        const personas = await s.intentar("select id from persona");
        // Lo de siempre (0002): la propia y los miembros de la empresa del contexto: A y el colega.
        if (personas.ok)
          expect(ids(personas, "id")).toEqual([e.a.persona, e.colega.persona].sort());
      } finally {
        await s.cerrar();
      }
    });

    it("sin `s`, con un `s` que no es uuid o de un usuario inexistente: cero filas y NINGÚN error", async () => {
      const firmados: [string, string | null][] = [
        ["sin s", null],
        ["s que no es uuid", "no-es-un-uuid"],
        ["s vacío", ""],
        ["s en mayúsculas", "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"],
        ["usuario inexistente", uuidAlAzar()],
      ];
      for (const [nombre, s] of firmados) {
        const token = firmarCarga(base!.clave, {
          u: "zuluhub_app",
          e: null,
          t: null,
          p: null,
          i: null,
          x: Math.floor(Date.now() / 1000) + 300,
          a: null,
          s,
        });
        const sesion = await SesionDePrueba.abrirConToken(base!, "zuluhub_app", token);
        try {
          for (const tabla of ["persona", "membresia", "empresa", "tenant"]) {
            filas(await sesion.intentar(`select 1 from ${tabla}`), 0);
          }
          const f = await sesion.intentar(
            "select app_usuario_auth() as u, app_persona_de_sesion() as p",
          );
          acepta(f);
          if (f.ok && nombre !== "usuario inexistente")
            expect(f.rows).toEqual([{ u: null, p: null }]);
        } finally {
          await sesion.cerrar();
        }
      }
    });

    it("`app_usuario_auth()` y `app_persona_de_sesion()` devuelven el usuario y la persona del contexto firmado", async () => {
      await conSesion(base!, e.a.usuario, async (s) => {
        const r = await s.intentar(
          "select app_usuario_auth()::text as u, app_persona_de_sesion()::text as p",
        );
        acepta(r);
        if (r.ok) expect(r.rows).toEqual([{ u: e.a.usuario, p: e.a.persona }]);
      });
      // Con el contexto OPERATIVO no hay usuario: el claim `s` nunca se hereda de otra puerta.
      const s = await SesionDePrueba.abrir(
        base!,
        "zuluhub_app",
        comoEmpresa(empresaId(e.a1.empresa), personaId(e.a.persona)),
      );
      try {
        const r = await s.intentar("select app_usuario_auth() as u, app_persona_de_sesion() as p");
        acepta(r);
        if (r.ok) expect(r.rows).toEqual([{ u: null, p: null }]);
      } finally {
        await s.cerrar();
      }
    });

    it("un token de SESION firmado para otro rol no sirve: el de la aplicación no abre una sesión del rol de grupo", async () => {
      const token = firmarCarga(base!.clave, {
        u: "zuluhub_app",
        e: null,
        t: null,
        p: null,
        i: null,
        x: Math.floor(Date.now() / 1000) + 300,
        a: null,
        s: e.a.usuario,
      });
      const sesion = await SesionDePrueba.abrirConToken(base!, "zuluhub_grupo", token);
      try {
        filas(await sesion.intentar("select 1 from persona"), 0);
        filas(await sesion.intentar("select 1 from empresa"), 0);
      } finally {
        await sesion.cerrar();
      }
    });
  });

  // =============================================================================================
  // 3. Sin recursión de políticas
  // =============================================================================================
  describe("las políticas no se llaman en círculo", () => {
    it("recorrer TODAS las tablas legibles con CADA tipo de contexto no da ningún error (ni recursión de políticas ni pila agotada)", async () => {
      const principal = await marcaPrincipal(dueno);
      const a = await personaConUsuario(dueno);
      const mundo = await empresaConMiembro(dueno, a, { marca: principal });
      const hash = tokenAlAzar().tokenHash;
      const contextos: [string, Contexto | null][] = [
        ["SESION", comoSesion(a.usuario)],
        ["INVITACION con usuario", comoInvitacion(hash, a.usuario)],
        ["INVITACION sin usuario", comoInvitacion(hash)],
        ["OPERATIVO con persona", comoEmpresa(empresaId(mundo.empresa), personaId(a.persona))],
        ["OPERATIVO del sistema", comoEmpresa(empresaId(mundo.empresa), null)],
      ];
      const tablas = await consulta<{ relname: string }>(
        `select c.relname from pg_class c
         where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
           and has_table_privilege('zuluhub_app', c.oid, 'SELECT') order by 1`,
      );
      expect(tablas.length).toBeGreaterThan(20);
      // El círculo de políticas (membresía -> persona -> membresía) se corta porque la lectura de miembros filtra
      // primero por empresa: es una dependencia del plan de ejecución. Se recorre con tres planes distintos.
      const planes: [string, string[]][] = [
        ["plan por defecto", []],
        [
          "solo barridos secuenciales",
          [
            "set local enable_indexscan = off",
            "set local enable_bitmapscan = off",
            "set local enable_indexonlyscan = off",
          ],
        ],
        ["solo índices", ["set local enable_seqscan = off"]],
      ];
      for (const [nombre, contexto] of contextos) {
        for (const [plan, ajustes] of planes) {
          const s = await SesionDePrueba.abrir(base!, "zuluhub_app", contexto);
          try {
            for (const ajuste of ajustes) acepta(await s.intentar(ajuste));
            for (const { relname } of tablas) {
              const r = await s.intentar(`select count(*) from ${relname}`);
              expect(
                r.ok,
                `${nombre} (${plan}): ${relname}: ${r.ok ? "" : `${r.codigo} ${r.mensaje}`}`,
              ).toBe(true);
            }
          } finally {
            await s.cerrar();
          }
        }
      }
      // Y el conjunto de tablas que se recorrió incluye las cuatro con política de sesión.
      const nombres = tablas.map((t) => t.relname);
      for (const t of ["persona", "membresia", "empresa", "tenant"]) expect(nombres).toContain(t);
    });
  });

  // =============================================================================================
  // 4. Vincular: solo la invitación, solo la persona de su email, solo hacia el usuario firmado
  // =============================================================================================
  describe("vincular a la persona con el usuario: solo con una invitación", () => {
    type Preparado = Awaited<ReturnType<typeof preparar>>;
    async function preparar() {
      const mundo = await crearEmpresaActivaPorDueno();
      const invitada = await crearPersonaDeBase(dueno);
      const otra = await crearPersonaDeBase(dueno);
      const { tokenHash } = tokenAlAzar();
      const inv = await crearInvitacionDeBase(dueno, {
        tenant: mundo.tenant,
        email: invitada.email,
        tokenHash,
      });
      await incluirEmpresa(dueno, inv, mundo.empresa);
      const usuario = await crearUsuarioDeBase(dueno, invitada.email);
      const otroUsuario = await crearUsuarioDeBase(dueno);
      return { mundo, invitada, otra, inv, tokenHash, usuario, otroUsuario };
    }
    async function crearEmpresaActivaPorDueno() {
      const entorno = crearEntornoDePrueba(base!);
      try {
        return await crearEmpresaActiva(entorno);
      } finally {
        await entorno.cerrar();
      }
    }

    const vincular = (s: SesionDePrueba, persona: string, usuario: string) =>
      s.intentar("update persona set usuario_auth_id = $2 where id = $1", [persona, usuario]);

    it("el invitado que ya ingresó vincula a la persona del email de su invitación con SU usuario", async () => {
      const p: Preparado = await preparar();
      await conInvitacion(base!, p.tokenHash, p.usuario.id, async (s) => {
        filas(await vincular(s, p.invitada.id, p.usuario.id), 1);
        const r = await s.intentar("select usuario_auth_id from persona where id = $1", [
          p.invitada.id,
        ]);
        if (r.ok) expect(r.rows).toEqual([{ usuario_auth_id: p.usuario.id }]);
      });
    });

    it("no vincula a OTRA persona (de otro email) ni hacia OTRO usuario, aunque el token sea válido", async () => {
      const p = await preparar();
      await conInvitacion(base!, p.tokenHash, p.usuario.id, async (s) => {
        // Otra persona: la política ni la deja ver, y la actualización toca 0 filas.
        filas(await vincular(s, p.otra.id, p.usuario.id), 0);
        // Hacia otro usuario: el WITH CHECK nombra al usuario firmado en `s`.
        denegado(await vincular(s, p.invitada.id, p.otroUsuario.id));
      });
      const { rows } = await dueno.query(
        "select id, usuario_auth_id from persona where id = any($1) order by id",
        [[p.invitada.id, p.otra.id]],
      );
      expect(
        rows.every((f: { usuario_auth_id: string | null }) => f.usuario_auth_id === null),
      ).toBe(true);
    });

    it("sin usuario en el contexto (el invitado todavía no ingresó) no vincula nada", async () => {
      const p = await preparar();
      await conInvitacion(base!, p.tokenHash, null, async (s) => {
        filas(await vincular(s, p.invitada.id, p.usuario.id), 0);
      });
      const { rows } = await dueno.query("select usuario_auth_id from persona where id = $1", [
        p.invitada.id,
      ]);
      expect(rows).toEqual([{ usuario_auth_id: null }]);
    });

    it("una persona ya vinculada no se vuelve a vincular (la política exige el vínculo nulo)", async () => {
      const p = await preparar();
      await vincularDeBase(dueno, p.invitada.id, p.usuario.id);
      await conInvitacion(base!, p.tokenHash, p.otroUsuario.id, async (s) => {
        filas(await vincular(s, p.invitada.id, p.otroUsuario.id), 0);
      });
    });

    it("una persona suspendida globalmente no se vincula", async () => {
      const p = await preparar();
      await dueno.query("update persona set activo_global = false where id = $1", [p.invitada.id]);
      await conInvitacion(base!, p.tokenHash, p.usuario.id, async (s) => {
        filas(await vincular(s, p.invitada.id, p.usuario.id), 0);
      });
    });

    it("ninguna otra puerta vincula: ni la sesión, ni el contexto operativo, ni grupo, ni plataforma", async () => {
      const p = await preparar();
      await conSesion(base!, p.usuario.id, async (s) => {
        filas(await vincular(s, p.invitada.id, p.usuario.id), 0);
      });
      const operativo = await SesionDePrueba.abrir(
        base!,
        "zuluhub_app",
        comoEmpresa(empresaId(p.mundo.empresa), personaId(p.invitada.id)),
      );
      try {
        filas(await vincular(operativo, p.invitada.id, p.usuario.id), 0);
      } finally {
        await operativo.cerrar();
      }
      // Los demás roles ni siquiera tienen el privilegio de columna.
      for (const rol of [
        "zuluhub_grupo",
        "zuluhub_trabajos",
        "zuluhub_plataforma",
        "zuluhub_autenticacion",
      ] as const) {
        const cliente = new pg.Client({
          connectionString: {
            zuluhub_grupo: base!.grupo,
            zuluhub_trabajos: base!.trabajos,
            zuluhub_plataforma: base!.plataforma,
            zuluhub_autenticacion: base!.autenticacion,
          }[rol],
        });
        await cliente.connect();
        try {
          const r = await cliente
            .query("update persona set usuario_auth_id = $2 where id = $1", [
              p.invitada.id,
              p.usuario.id,
            ])
            .then(
              () => "ok",
              (error: { code?: string }) => error.code ?? "?",
            );
          expect(r, rol).toBe("42501");
        } finally {
          await cliente.end();
        }
      }
      const { rows } = await dueno.query("select usuario_auth_id from persona where id = $1", [
        p.invitada.id,
      ]);
      expect(rows).toEqual([{ usuario_auth_id: null }]);
    });

    it("la persona solo se ve para vincular si el token es de su email: con el token de otro email, la base no la muestra", async () => {
      const p = await preparar();
      const otraInvitacion = tokenAlAzar();
      const inv2 = await crearInvitacionDeBase(dueno, {
        tenant: p.mundo.tenant,
        email: emailAlAzar("ajeno"),
        tokenHash: otraInvitacion.tokenHash,
      });
      await incluirEmpresa(dueno, inv2, p.mundo.empresa);
      await conInvitacion(base!, otraInvitacion.tokenHash, p.usuario.id, async (s) => {
        filas(await s.intentar("select 1 from persona where id = $1", [p.invitada.id]), 0);
        filas(await vincular(s, p.invitada.id, p.usuario.id), 0);
      });
    });
  });
});
