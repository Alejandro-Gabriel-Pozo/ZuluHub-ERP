import { randomInt } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { cuitDesdeTexto } from "../../src/primitivas/identificacion-fiscal/cuit";
import type { EstadoDeEmpresa } from "../../src/contexto/estados";
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
  "empresa_transicion_invalida",
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

    it("los privilegios de tabla por rol son exactamente los esperados (los UPDATE, por columna, en el test siguiente)", async () => {
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
          "auditoria_empresa:INSERT",
          "auditoria_empresa:SELECT",
          "empresa:SELECT",
          "membresia_tenant:SELECT",
          "persona:SELECT",
          "sucursal:INSERT",
          "sucursal:SELECT",
          "tenant:SELECT",
          "trabajo:INSERT",
          "trabajo:SELECT",
        ].sort(),
      );
      expect(porRol("zuluhub_grupo")).toEqual(
        [
          "auditoria_acceso_grupo:INSERT",
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
          "auditoria_empresa:INSERT",
          "auditoria_plataforma:INSERT",
          "auditoria_plataforma:SELECT",
          "empresa:INSERT",
          "empresa:SELECT",
          "instalacion:SELECT",
          "membresia_tenant:INSERT",
          "membresia_tenant:SELECT",
          "persona:INSERT",
          "persona:SELECT",
          "sucursal:INSERT",
          "tenant:INSERT",
          "tenant:SELECT",
          "trabajo:INSERT",
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

    it("PUBLIC no tiene privilegios sobre las tablas", async () => {
      const publicos = await filas(
        `select 1 from information_schema.table_privileges where table_schema = 'public' and grantee = 'PUBLIC'`,
      );
      expect(publicos).toEqual([]);
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
