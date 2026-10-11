import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { cuitDesdeTexto } from "../../src/primitivas/identificacion-fiscal/cuit";
import type { EstadoDeEmpresa } from "../../src/contexto/estados";
import { crearBaseAparte, cuitAlAzar } from "./entorno";
import {
  COLUMNAS_DE_EMPRESAS,
  ERRORES_DE_EMPRESAS_POR_RESTRICCION,
  TRANSICIONES_DE_EMPRESA,
} from "../../src/modulos/empresas/publico";
import {
  COLUMNAS_DE_TENANT,
  ERRORES_DE_TENANT_POR_RESTRICCION,
} from "../../src/modulos/tenants/publico";

const base = inject("baseDePruebas");

const ROLES = ["zuluhub_app", "zuluhub_grupo", "zuluhub_trabajos", "zuluhub_plataforma"] as const;
const TABLAS_DE_NEGOCIO = [
  "instalacion",
  "tenant",
  "empresa",
  "sucursal",
  "persona",
  "membresia_tenant",
  "auditoria_empresa",
  "auditoria_plataforma",
  "auditoria_acceso_grupo",
  "trabajo",
] as const;
const TABLAS_DE_AUDITORIA = ["auditoria_empresa", "auditoria_plataforma", "auditoria_acceso_grupo"];

/** Restricciones que no están en el catálogo porque las lanzan los disparadores con nombre propio. */
const RESTRICCIONES_DE_DISPARADORES = [
  "empresa_tenant_inmutable",
  "empresa_tenant_no_activo",
  "empresa_transicion_invalida",
  "empresa_zona_horaria_ck",
  "tenant_instalacion_single",
];

describe.skipIf(base === null)("meta-tests sobre el catálogo de la base", () => {
  let dueno: pg.Client;

  beforeAll(async () => {
    if (base === null) return;
    dueno = new pg.Client({ connectionString: base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
  });

  const filas = async <T extends Record<string, unknown>>(
    texto: string,
    parametros: unknown[] = [],
  ) => (await dueno.query<T>(texto, parametros)).rows;

  describe("aislamiento", () => {
    it("toda tabla de negocio tiene RLS activo y forzado", async () => {
      const tablas = await filas<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `select c.relname, c.relrowsecurity, c.relforcerowsecurity
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'migracion'`,
      );
      expect(tablas.map((t) => t.relname).sort()).toEqual([...TABLAS_DE_NEGOCIO].sort());
      for (const tabla of tablas) {
        expect(tabla.relrowsecurity, `${tabla.relname}: RLS activo`).toBe(true);
        expect(tabla.relforcerowsecurity, `${tabla.relname}: RLS forzado`).toBe(true);
      }
    });

    it("toda tabla con empresa_id tiene una clave foránea a empresa(id)", async () => {
      const sinClave = await filas<{ tabla: string }>(
        `select c.table_name as tabla
         from information_schema.columns c
         where c.table_schema = 'public' and c.column_name = 'empresa_id'
           and not exists (
             select 1 from pg_constraint k
             where k.conrelid = format('public.%I', c.table_name)::regclass
               and k.contype = 'f' and k.confrelid = 'public.empresa'::regclass
           )`,
      );
      expect(sinClave).toEqual([]);
    });

    it("toda tabla de negocio tiene al menos una política por rol que puede tocarla", async () => {
      const sinPoliticas = await filas<{ tabla: string; rol: string }>(
        `select p.table_name as tabla, p.grantee as rol
         from information_schema.table_privileges p
         where p.table_schema = 'public' and p.grantee = any($1)
           and p.privilege_type in ('SELECT', 'INSERT', 'UPDATE')
           and not exists (
             select 1 from pg_policies pol
             where pol.schemaname = 'public' and pol.tablename = p.table_name and p.grantee = any(pol.roles::text[])
           )
         group by 1, 2`,
        [[...ROLES]],
      );
      expect(sinPoliticas).toEqual([]);
    });
  });

  describe("roles de base", () => {
    it("los cuatro roles existen y ninguno es superusuario, dueño ni evade RLS", async () => {
      const roles = await filas<Record<string, unknown>>(
        `select rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication, rolinherit
         from pg_roles where rolname = any($1) order by rolname`,
        [[...ROLES]],
      );
      expect(roles.map((r) => r["rolname"])).toEqual([...ROLES].sort());
      for (const rol of roles) {
        expect(rol, String(rol["rolname"])).toMatchObject({
          rolsuper: false,
          rolbypassrls: false,
          rolcreaterole: false,
          rolcreatedb: false,
          rolreplication: false,
          rolinherit: false,
        });
      }
      const duenos = await filas<{ tablename: string; tableowner: string }>(
        `select tablename, tableowner from pg_tables where schemaname = 'public' and tableowner = any($1)`,
        [[...ROLES]],
      );
      expect(duenos).toEqual([]);
      const pertenencias = await filas(
        `select 1 from pg_auth_members m join pg_roles r on r.oid = m.member where r.rolname = any($1)`,
        [[...ROLES]],
      );
      expect(pertenencias).toEqual([]);
    });

    it("ningún rol puede borrar, truncar, referenciar ni crear disparadores en ninguna tabla", async () => {
      const prohibidos = await filas<{
        grantee: string;
        table_name: string;
        privilege_type: string;
      }>(
        `select grantee, table_name, privilege_type from information_schema.table_privileges
         where table_schema = 'public' and grantee = any($1)
           and privilege_type in ('DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')`,
        [[...ROLES]],
      );
      expect(prohibidos).toEqual([]);
    });

    it("las tablas de auditoría no tienen UPDATE para nadie", async () => {
      const permitidos = await filas(
        `select grantee, table_name from information_schema.table_privileges
         where table_schema = 'public' and table_name = any($1) and grantee = any($2)
           and privilege_type = 'UPDATE'`,
        [TABLAS_DE_AUDITORIA, [...ROLES]],
      );
      expect(permitidos).toEqual([]);
    });

    it("los privilegios de tabla por rol son exactamente los esperados (INSERT y UPDATE van por columna, en los tests siguientes)", async () => {
      const privilegios = await filas<{
        grantee: string;
        table_name: string;
        privilege_type: string;
      }>(
        `select grantee, table_name, privilege_type from information_schema.table_privileges
         where table_schema = 'public' and grantee = any($1) order by 1, 2, 3`,
        [[...ROLES]],
      );
      const porRol = (rol: string) =>
        privilegios
          .filter((p) => p.grantee === rol)
          .map((p) => `${p.table_name}:${p.privilege_type}`);
      expect(porRol("zuluhub_app")).toEqual(
        [
          "auditoria_empresa:SELECT",
          "empresa:SELECT",
          "membresia_tenant:SELECT",
          "persona:SELECT",
          "sucursal:SELECT",
          "tenant:SELECT",
          "trabajo:SELECT",
        ].sort(),
      );
      expect(porRol("zuluhub_grupo")).toEqual(
        [
          "empresa:SELECT",
          "membresia_tenant:SELECT",
          "persona:SELECT",
          "sucursal:SELECT",
          "tenant:SELECT",
        ].sort(),
      );
      expect(porRol("zuluhub_trabajos")).toEqual(["trabajo:SELECT"]);
      expect(porRol("zuluhub_plataforma")).toEqual(
        [
          "auditoria_plataforma:SELECT",
          "empresa:SELECT",
          "instalacion:SELECT",
          "membresia_tenant:SELECT",
          "persona:SELECT",
          "tenant:SELECT",
          "trabajo:SELECT",
        ].sort(),
      );
    });

    it("los UPDATE son por columna: nadie puede cambiar tenant_id, empresa_id, id ni los contadores", async () => {
      const columnas = await filas<{ grantee: string; table_name: string; column_name: string }>(
        `select grantee, table_name, column_name from information_schema.column_privileges
         where table_schema = 'public' and grantee = any($1) and privilege_type = 'UPDATE'
         order by 1, 2, 3`,
        [[...ROLES]],
      );
      const permitidas = columnas.map((c) => `${c.grantee}:${c.table_name}.${c.column_name}`);
      expect(permitidas).toEqual(
        [
          "zuluhub_app:sucursal.activa",
          "zuluhub_app:sucursal.nombre",
          "zuluhub_plataforma:empresa.cuit",
          "zuluhub_plataforma:empresa.estado",
          "zuluhub_plataforma:empresa.motivo_estado",
          "zuluhub_plataforma:empresa.razon_social",
          "zuluhub_plataforma:empresa.zona_horaria",
          "zuluhub_plataforma:membresia_tenant.activo",
          "zuluhub_plataforma:persona.activo_global",
          "zuluhub_plataforma:tenant.estado",
          "zuluhub_plataforma:tenant.motivo_estado",
          "zuluhub_plataforma:tenant.nombre",
          "zuluhub_trabajos:trabajo.estado",
          "zuluhub_trabajos:trabajo.intentos",
          "zuluhub_trabajos:trabajo.proximo_intento",
          "zuluhub_trabajos:trabajo.tomado_hasta",
          "zuluhub_trabajos:trabajo.ultimo_error",
        ].sort(),
      );
    });

    it("los INSERT son por columna, con la lista exacta por rol: nadie da de alta una fila con creado_en, version, estado ni intentos a mano", async () => {
      const columnas = await filas<{ grantee: string; table_name: string; column_name: string }>(
        `select grantee, table_name, column_name from information_schema.column_privileges
         where table_schema = 'public' and grantee = any($1) and privilege_type = 'INSERT'
         order by 1, 2, 3`,
        [[...ROLES]],
      );
      const porRol = (rol: string) =>
        columnas
          .filter((c) => c.grantee === rol)
          .map((c) => `${c.table_name}.${c.column_name}`)
          .sort();
      const auditoriaDeEmpresa = [
        "empresa_id",
        "actor_persona_id",
        "accion",
        "entidad",
        "entidad_id",
        "antes",
        "despues",
      ].map((c) => `auditoria_empresa.${c}`);
      expect(porRol("zuluhub_app")).toEqual(
        [
          ...auditoriaDeEmpresa,
          "sucursal.empresa_id",
          "sucursal.nombre",
          "trabajo.empresa_id",
          "trabajo.tipo",
          "trabajo.datos",
          "trabajo.clave_idempotencia",
        ].sort(),
      );
      expect(porRol("zuluhub_grupo")).toEqual(
        ["tenant_id", "persona_id", "empresa_id"].map((c) => `auditoria_acceso_grupo.${c}`).sort(),
      );
      expect(porRol("zuluhub_trabajos")).toEqual([]);
      expect(porRol("zuluhub_plataforma")).toEqual(
        [
          ...auditoriaDeEmpresa,
          ...["actor", "accion", "entidad", "entidad_id", "antes", "despues"].map(
            (c) => `auditoria_plataforma.${c}`,
          ),
          ...["tenant_id", "cuit", "razon_social", "zona_horaria"].map((c) => `empresa.${c}`),
          ...["persona_id", "tenant_id", "rol", "activo"].map((c) => `membresia_tenant.${c}`),
          "persona.email",
          "sucursal.empresa_id",
          "sucursal.nombre",
          "tenant.nombre",
          "trabajo.empresa_id",
          "trabajo.tipo",
          "trabajo.datos",
          "trabajo.clave_idempotencia",
        ].sort(),
      );
    });

    it("PUBLIC no tiene privilegios sobre las tablas", async () => {
      const publicos = await filas(
        `select 1 from information_schema.table_privileges where table_schema = 'public' and grantee = 'PUBLIC'`,
      );
      expect(publicos).toEqual([]);
    });
  });

  describe("endurecimiento del esquema", () => {
    const MIGRACION = readFileSync(
      join(import.meta.dirname, "../../migraciones/0001_base.sql"),
      "utf8",
    );
    const SEARCH_PATH_FIJO = "search_path=pg_catalog, public, pg_temp";

    it("toda función del esquema public fija su search_path (con pg_temp al final)", async () => {
      const funciones = await filas<{ firma: string; proconfig: string[] | null }>(
        `select p.oid::regprocedure::text as firma, p.proconfig
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
         order by 1`,
      );
      expect(funciones.length, "hay funciones que revisar").toBeGreaterThan(10);
      const sinFijar = funciones
        .filter((f) => !(f.proconfig ?? []).includes(SEARCH_PATH_FIJO))
        .map((f) => f.firma);
      expect(sinFijar, "funciones sin search_path fijo").toEqual([]);
    });

    it("ninguna función del esquema public es ejecutable por PUBLIC", async () => {
      const abiertas = await filas<{ firma: string }>(
        `select p.oid::regprocedure::text as firma
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and (
             p.proacl is null
             or exists (
               select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'
             )
           )
         order by 1`,
      );
      expect(abiertas, "funciones con EXECUTE para PUBLIC").toEqual([]);
    });

    it("las funciones que se creen después también nacen cerradas (privilegios por defecto)", async () => {
      if (base === null) return;
      const aparte = await crearBaseAparte(base);
      const cliente = new pg.Client({ connectionString: aparte.base.dueno });
      await cliente.connect();
      try {
        await cliente.query(
          "create function funcion_futura() returns int language sql as 'select 1'",
        );
        const { rows } = await cliente.query<{ abierta: boolean }>(
          `select (p.proacl is null or exists (
                     select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'
                   )) as abierta
           from pg_proc p where p.proname = 'funcion_futura'`,
        );
        expect(rows).toEqual([{ abierta: false }]);
      } finally {
        await cliente.end();
        await aparte.destruir();
      }
    });

    const vistasSinSecurityInvoker = async (cliente: pg.Client) =>
      (
        await cliente.query<{ relname: string; relkind: string }>(
          `select c.relname, c.relkind
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('v', 'm', 'p')
             and not ('security_invoker=true' = any (coalesce(c.reloptions, '{}')))
           order by 1`,
        )
      ).rows;

    it("no hay vistas, vistas materializadas ni tablas particionadas sin security_invoker", async () => {
      expect(await vistasSinSecurityInvoker(dueno)).toEqual([]);
    });

    it("el chequeo de vistas muerde: detecta las que no tienen security_invoker y acepta la que lo tiene", async () => {
      if (base === null) return;
      const aparte = await crearBaseAparte(base);
      const cliente = new pg.Client({ connectionString: aparte.base.dueno });
      await cliente.connect();
      try {
        await cliente.query("create view vista_abierta as select id from tenant");
        await cliente.query(
          "create view vista_cerrada with (security_invoker = true) as select id from tenant",
        );
        await cliente.query(
          "create materialized view vista_materializada as select id from tenant",
        );
        expect(await vistasSinSecurityInvoker(cliente)).toEqual([
          { relname: "vista_abierta", relkind: "v" },
          { relname: "vista_materializada", relkind: "m" },
        ]);
      } finally {
        await cliente.end();
        await aparte.destruir();
      }
    });

    it("toda política de alta o cambio de la aplicación sobre sucursal, trabajo y auditoria_empresa exige empresa_operable", async () => {
      const sinEmpresaOperable = await filas<{ tablename: string; policyname: string }>(
        `select tablename, policyname from pg_policies
         where schemaname = 'public' and 'zuluhub_app' = any (roles)
           and tablename in ('sucursal', 'trabajo', 'auditoria_empresa')
           and cmd in ('INSERT', 'UPDATE', 'ALL')
           and coalesce(with_check, qual, '') not like '%empresa_operable(%'
         order by 1, 2`,
      );
      expect(sinEmpresaOperable, "políticas sin empresa_operable").toEqual([]);
      // Y existen todas las que tienen que existir (el test anterior no pasa por vacío).
      const existentes = await filas<{ tablename: string; cmd: string }>(
        `select tablename, cmd from pg_policies
         where schemaname = 'public' and 'zuluhub_app' = any (roles)
           and tablename in ('sucursal', 'trabajo', 'auditoria_empresa')
           and cmd in ('INSERT', 'UPDATE', 'ALL')
         order by 1, 2`,
      );
      expect(existentes).toEqual([
        { tablename: "auditoria_empresa", cmd: "INSERT" },
        { tablename: "sucursal", cmd: "INSERT" },
        { tablename: "sucursal", cmd: "UPDATE" },
        { tablename: "trabajo", cmd: "INSERT" },
      ]);
    });

    it("la auditoría de la aplicación exige que el actor sea la persona del contexto", async () => {
      const { rows } = await dueno.query<{ with_check: string }>(
        `select with_check from pg_policies
         where schemaname = 'public' and policyname = 'auditoria_empresa_app_alta'`,
      );
      expect(rows[0]?.with_check).toMatch(
        /NOT \(actor_persona_id IS DISTINCT FROM app_persona_id\(\)\)/,
      );
    });

    it("la zona horaria se valida con un disparador y no con un CHECK que cambiaría con tzdata", async () => {
      const { rows } = await dueno.query<{ conname: string }>(
        `select conname from pg_constraint where conrelid = 'public.empresa'::regclass and contype = 'c'`,
      );
      expect(rows.map((r) => r.conname)).not.toContain("empresa_zona_horaria_ck");
    });

    it("ningún rol limitado tiene TEMP sobre la base, ni PUBLIC", async () => {
      const { rows } = await dueno.query<{ rol: string; temp: boolean }>(
        `select r as rol, has_database_privilege(r, current_database(), 'TEMP') as temp
         from unnest($1::text[]) as r order by 1`,
        [[...ROLES]],
      );
      expect(rows).toEqual([...ROLES].sort().map((rol) => ({ rol, temp: false })));
      const { rows: publico } = await dueno.query(
        `select 1 from pg_database d, aclexplode(d.datacl) a
         where d.datname = current_database() and a.grantee = 0 and a.privilege_type = 'TEMPORARY'`,
      );
      expect(publico).toEqual([]);
    });

    it("cada rol tiene fijados statement_timeout, idle_in_transaction_session_timeout y lock_timeout", async () => {
      const { rows } = await dueno.query<{ rolname: string; setconfig: string[] }>(
        `select r.rolname, s.setconfig
         from pg_db_role_setting s join pg_roles r on r.oid = s.setrole
         where s.setdatabase = 0 and r.rolname = any($1) order by 1`,
        [[...ROLES]],
      );
      expect(rows.map((r) => r.rolname)).toEqual([...ROLES].sort());
      for (const fila of rows) {
        expect([...fila.setconfig].sort(), fila.rolname).toEqual([
          "idle_in_transaction_session_timeout=60s",
          "lock_timeout=15s",
          "statement_timeout=30s",
        ]);
      }
    });

    describe("la migración frena a un rol que es miembro de otro", () => {
      // El primer bloque DO del archivo crea y revisa los roles. Se corre en una transacción que
      // se deshace: ni la pertenencia de prueba ni nada de lo que haga queda en el servidor.
      const bloqueDeRoles = /^DO \$\$[\s\S]*?^\$\$;/m.exec(MIGRACION)?.[0] ?? "";

      it("el bloque de roles se localiza y, sin pertenencias ajenas, corre sin errores", async () => {
        expect(bloqueDeRoles).toContain("CREATE ROLE");
        await dueno.query("begin");
        try {
          await expect(dueno.query(bloqueDeRoles)).resolves.toBeDefined();
        } finally {
          await dueno.query("rollback");
        }
      });

      it("falla con un mensaje claro si uno de los cuatro roles es miembro de otro rol", async () => {
        await dueno.query("begin");
        try {
          await dueno.query("grant pg_monitor to zuluhub_app");
          await expect(dueno.query(bloqueDeRoles)).rejects.toThrow(
            /zuluhub_app es miembro de pg_monitor/,
          );
        } finally {
          await dueno.query("rollback");
        }
      });
    });

    describe("las funciones no se dejan suplantar con tablas temporales", () => {
      // Lo que prueban estos tests no depende de REVOKE TEMPORARY: el dueño de la base (que sí
      // puede crear temporales) arma tablas falsas y las funciones deben ignorarlas. Se hace todo
      // en una transacción que se deshace.
      const enTransaccion = async (cuerpo: () => Promise<void>) => {
        await dueno.query("begin");
        try {
          await cuerpo();
        } finally {
          await dueno.query("rollback");
        }
      };
      const escalar = async <T>(texto: string, parametros: unknown[] = []) =>
        (await dueno.query<{ v: T }>(`select ${texto} as v`, parametros)).rows[0]?.v;

      /** Un tenant suspendido con una empresa ACTIVE, y copias temporales "falsas" donde todo opera. */
      const armarSuplantacion = async () => {
        const { rows: t } = await dueno.query<{ id: string }>(
          "insert into public.tenant (nombre) values ('suplantacion') returning id",
        );
        const tenant = t[0]?.id as string;
        const { rows: e } = await dueno.query<{ id: string }>(
          `insert into public.empresa (tenant_id, cuit, razon_social, estado)
           values ($1, '30500010912', 'suplantacion', 'ACTIVE') returning id`,
          [tenant],
        );
        const empresa = e[0]?.id as string;
        const { rows: o } = await dueno.query<{ id: string }>(
          `insert into public.empresa (tenant_id, cuit, razon_social, estado)
           values ($1, $2, 'suplantacion 2', 'ACTIVE') returning id`,
          [tenant, cuitAlAzar()],
        );
        const otraEmpresa = o[0]?.id as string;
        await dueno.query(
          "update public.tenant set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
          [tenant],
        );
        const { rows: p } = await dueno.query<{ id: string }>(
          "insert into public.persona (email) values ('suplantacion@prueba.test') returning id",
        );
        const persona = p[0]?.id as string;
        // Las copias falsas: el tenant figura ACTIVE (y `empresa` cuelga de él, así que parece
        // operable), `otraEmpresa` cuelga de un tenant inventado, y la persona es propietaria.
        await dueno.query("create temp table tenant as select * from public.tenant");
        await dueno.query("update pg_temp.tenant set estado = 'ACTIVE', motivo_estado = null");
        await dueno.query("create temp table empresa as select * from public.empresa");
        await dueno.query(
          "update pg_temp.empresa set tenant_id = gen_random_uuid() where id = $1",
          [otraEmpresa],
        );
        await dueno.query("create temp table persona as select * from public.persona");
        await dueno.query(
          "create temp table membresia_tenant (like public.membresia_tenant including defaults)",
        );
        await dueno.query(
          "insert into pg_temp.membresia_tenant (persona_id, tenant_id, rol, activo) values ($1, $2, 'PROPIETARIO', true)",
          [persona, tenant],
        );
        await dueno.query("select set_config('app.persona_id', $1, true)", [persona]);
        return { tenant, empresa, otraEmpresa, persona };
      };

      it("empresa_operable, tenant_activo, tenant_de_empresa y es_propietario_activo miran las tablas reales", async () => {
        await enTransaccion(async () => {
          const { tenant, empresa, otraEmpresa } = await armarSuplantacion();
          expect(await escalar<boolean>("public.empresa_operable($1)", [empresa])).toBe(false);
          expect(await escalar<boolean>("public.tenant_activo($1)", [tenant])).toBe(false);
          expect(await escalar<string>("public.tenant_de_empresa($1)", [otraEmpresa])).toBe(tenant);
          expect(await escalar<boolean>("public.es_propietario_activo($1)", [tenant])).toBe(false);
        });
      });

      it("los disparadores de alta de tenant y de empresa tampoco leen tablas temporales", async () => {
        await enTransaccion(async () => {
          const { tenant } = await armarSuplantacion();
          // Instalación SINGLE de verdad, con un "MULTI" falso en una temporal.
          await dueno.query("create temp table instalacion as select * from public.instalacion");
          await dueno.query("update public.instalacion set modo = 'SINGLE'");
          await dueno.query("savepoint s1");
          await expect(
            dueno.query("insert into public.tenant (nombre) values ('segundo')"),
          ).rejects.toMatchObject({ code: "23514", constraint: "tenant_instalacion_single" });
          await dueno.query("rollback to savepoint s1");
          // El tenant real está suspendido (el falso, ACTIVE): la empresa nueva se rechaza igual.
          await dueno.query("update public.instalacion set modo = 'MULTI'");
          await expect(
            dueno.query(
              `insert into public.empresa (tenant_id, cuit, razon_social) values ($1, $2, 'nueva')`,
              [tenant, cuitAlAzar()],
            ),
          ).rejects.toMatchObject({ code: "23514", constraint: "empresa_tenant_no_activo" });
        });
      });
    });

    it("sin la fila de instalación el alta de tenant falla cerrado, no asume MULTI", async () => {
      await dueno.query("begin");
      try {
        await dueno.query("delete from public.instalacion");
        await expect(
          dueno.query("insert into public.tenant (nombre) values ('sin instalacion')"),
        ).rejects.toThrow(/falta su fila/);
      } finally {
        await dueno.query("rollback");
      }
    });

    it("los nombres no aceptan espacios en blanco al inicio ni al final (tampoco tabulaciones ni saltos)", async () => {
      for (const nombre of [" a", "a ", "\ta", "a\n", "", " "]) {
        await dueno.query("begin");
        try {
          await expect(
            dueno.query("insert into public.tenant (nombre) values ($1)", [nombre]),
            JSON.stringify(nombre),
          ).rejects.toMatchObject({ code: "23514", constraint: "tenant_nombre_ck" });
        } finally {
          await dueno.query("rollback");
        }
      }
      await dueno.query("begin");
      try {
        await dueno.query("insert into public.tenant (nombre) values ('Grupo Uno  Sur')");
      } finally {
        await dueno.query("rollback");
      }
    });

    it("lo mismo vale para la razón social de la empresa y el nombre de la sucursal", async () => {
      await dueno.query("begin");
      try {
        const { rows } = await dueno.query<{ id: string }>(
          "insert into public.tenant (nombre) values ('espacios') returning id",
        );
        const tenant = rows[0]?.id as string;
        const alta = (razonSocial: string) =>
          dueno.query(
            "insert into public.empresa (tenant_id, cuit, razon_social) values ($1, '30500010912', $2)",
            [tenant, razonSocial],
          );
        for (const razonSocial of [
          " Mi Empresa",
          "Mi Empresa ",
          "\tMi Empresa",
          "Mi Empresa\n",
          "",
        ]) {
          await dueno.query("savepoint s");
          await expect(alta(razonSocial), JSON.stringify(razonSocial)).rejects.toMatchObject({
            code: "23514",
            constraint: "empresa_razon_social_ck",
          });
          await dueno.query("rollback to savepoint s");
        }
        await alta("Mi Empresa");
        const { rows: e } = await dueno.query<{ id: string }>(
          "select id from public.empresa where tenant_id = $1",
          [tenant],
        );
        for (const nombre of [" Central", "Central ", "\tCentral", "Central\n", ""]) {
          await dueno.query("savepoint s");
          await expect(
            dueno.query("insert into public.sucursal (empresa_id, nombre) values ($1, $2)", [
              e[0]?.id,
              nombre,
            ]),
            JSON.stringify(nombre),
          ).rejects.toMatchObject({ code: "23514", constraint: "sucursal_nombre_ck" });
          await dueno.query("rollback to savepoint s");
        }
      } finally {
        await dueno.query("rollback");
      }
    });

    it("la zona horaria se valida al dar de alta y al cambiarla, con el nombre de restricción que el módulo traduce", async () => {
      await dueno.query("begin");
      try {
        const { rows } = await dueno.query<{ id: string }>(
          "insert into public.tenant (nombre) values ('zonas') returning id",
        );
        const tenant = rows[0]?.id as string;
        const alta = (zona: string | null) =>
          dueno.query(
            "insert into public.empresa (tenant_id, cuit, razon_social, zona_horaria) values ($1, '30500010912', 'zonas', $2)",
            [tenant, zona],
          );
        await dueno.query("savepoint s");
        await expect(alta("Marte/Olympus")).rejects.toMatchObject({
          code: "23514",
          constraint: "empresa_zona_horaria_ck",
        });
        await dueno.query("rollback to savepoint s");
        // Un NULL lo rechaza NOT NULL, no el disparador.
        await expect(alta(null)).rejects.toMatchObject({ code: "23502" });
        await dueno.query("rollback to savepoint s");
        await alta("America/Argentina/Cordoba");
        await dueno.query("savepoint s");
        await expect(
          dueno.query(
            "update public.empresa set zona_horaria = 'Marte/Olympus' where tenant_id = $1",
            [tenant],
          ),
        ).rejects.toMatchObject({ code: "23514", constraint: "empresa_zona_horaria_ck" });
        await dueno.query("rollback to savepoint s");
        await dueno.query("update public.empresa set zona_horaria = 'UTC' where tenant_id = $1", [
          tenant,
        ]);
      } finally {
        await dueno.query("rollback");
      }
    });
  });

  describe("restricciones y tipos", () => {
    it("toda restricción de las tablas de un módulo tiene su traducción declarada, y no sobra ninguna", async () => {
      const restricciones = await filas<{ nombre: string }>(
        `select conname as nombre from pg_constraint
         where conrelid = any(array['public.tenant','public.empresa','public.sucursal']::regclass[])
           and contype in ('p', 'u', 'c', 'f', 'x')
         union
         select indexname as nombre from pg_indexes
         where schemaname = 'public' and tablename in ('tenant', 'empresa', 'sucursal')
           and indexdef like 'CREATE UNIQUE INDEX%' and indexname not like '%pkey' and indexname not like '%_key'`,
      );
      const declaradas = new Set([
        ...Object.keys(ERRORES_DE_TENANT_POR_RESTRICCION),
        ...Object.keys(ERRORES_DE_EMPRESAS_POR_RESTRICCION),
      ]);
      const existentes = new Set(restricciones.map((r) => r.nombre));
      const sinTraduccion = [...existentes].filter((n) => !declaradas.has(n)).sort();
      expect(sinTraduccion, "restricciones sin traducción declarada").toEqual([]);
      const sobrantes = [...declaradas].filter(
        (n) => !existentes.has(n) && !RESTRICCIONES_DE_DISPARADORES.includes(n),
      );
      expect(sobrantes, "traducciones de restricciones que no existen").toEqual([]);
    });

    it("las columnas de cada tabla coinciden con los tipos del módulo", async () => {
      const columnasDe = async (tabla: string) =>
        (
          await filas<{ column_name: string }>(
            `select column_name from information_schema.columns
             where table_schema = 'public' and table_name = $1 order by ordinal_position`,
            [tabla],
          )
        ).map((c) => c.column_name);
      expect(await columnasDe("tenant")).toEqual([...COLUMNAS_DE_TENANT]);
      expect(await columnasDe("empresa")).toEqual([...COLUMNAS_DE_EMPRESAS.empresa]);
      expect(await columnasDe("sucursal")).toEqual([...COLUMNAS_DE_EMPRESAS.sucursal]);
    });

    it("el CUIT se valida igual en SQL y en TypeScript (miles de casos al azar)", async () => {
      const candidatos = new Set<string>([
        "20123456786",
        "33693450239",
        "20123456787",
        "0000000000" + "0",
        "00000000060",
        "2012345678",
        "abcdefghijk",
        "",
      ]);
      while (candidatos.size < 3000) {
        let texto = "";
        const largo = randomInt(0, 10) === 0 ? randomInt(1, 14) : 11;
        for (let i = 0; i < largo; i++) texto += String(randomInt(0, 10));
        candidatos.add(texto);
      }
      // Entre los aleatorios casi ninguno es válido: se agregan válidos construidos a propósito.
      for (let i = 0; i < 500; i++) {
        let diez = "";
        for (let j = 0; j < 10; j++) diez += String(randomInt(0, 10));
        for (let d = 0; d <= 9; d++) candidatos.add(`${diez}${d}`);
      }
      const lista = [...candidatos];
      const { rows } = await dueno.query<{ texto: string; valido: boolean }>(
        `select t as texto, cuit_valido(t) as valido from unnest($1::text[]) as t`,
        [lista],
      );
      expect(rows).toHaveLength(lista.length);
      const distintos = rows.filter(
        (r) => r.valido !== (/^\d{11}$/.test(r.texto) && cuitDesdeTexto(r.texto).ok),
      );
      expect(distintos).toEqual([]);
      expect(rows.some((r) => r.valido)).toBe(true);
      expect(rows.some((r) => !r.valido)).toBe(true);
    });
  });

  describe("máquina de estados de la empresa", () => {
    const ESTADOS: readonly EstadoDeEmpresa[] = [
      "PROVISIONING",
      "ACTIVE",
      "SUSPENDED",
      "CANCELLED",
      "DELETING",
    ];

    it("la base permite exactamente las transiciones que el dominio permite", async () => {
      await dueno.query("begin");
      try {
        const { rows: t } = await dueno.query<{ id: string }>(
          "insert into tenant (nombre) values ('transiciones') returning id",
        );
        const tenant = t[0]?.id;
        let cuit = 30000000000;
        for (const desde of ESTADOS) {
          for (const hacia of ESTADOS) {
            if (desde === hacia) continue;
            const digitos = String(cuit++);
            const valido = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
              .map((d) => `${digitos.slice(0, 10)}${d}`)
              .find((c) => cuitDesdeTexto(c).ok);
            if (valido === undefined) continue;
            await dueno.query("savepoint s");
            const motivo = (e: string) =>
              e === "SUSPENDED" || e === "CANCELLED" ? "motivo" : null;
            const { rows } = await dueno.query<{ id: string }>(
              `insert into empresa (tenant_id, cuit, razon_social, estado, motivo_estado)
               values ($1, $2, 'transicion', $3, $4) returning id`,
              [tenant, valido, desde, motivo(desde)],
            );
            let permitida = true;
            try {
              await dueno.query(
                "update empresa set estado = $2, motivo_estado = $3 where id = $1",
                [rows[0]?.id, hacia, motivo(hacia)],
              );
            } catch (error) {
              expect(error).toMatchObject({
                code: "23514",
                constraint: "empresa_transicion_invalida",
              });
              permitida = false;
            }
            await dueno.query("rollback to savepoint s");
            expect(permitida, `${desde} → ${hacia}`).toBe(
              TRANSICIONES_DE_EMPRESA[desde].includes(hacia),
            );
          }
        }
      } finally {
        await dueno.query("rollback");
      }
    });
  });
});
