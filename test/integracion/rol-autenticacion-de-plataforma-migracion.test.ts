import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearBaseAparte } from "./entorno";
import { CARPETA_DE_MIGRACIONES } from "./marcas-apoyo";

/**
 * La migración 0088 (rol propio de la consola para la librería de autenticación) contra una base real. Previene: que el rol nuevo
 * tenga más (o menos) privilegios que `pedernal_autenticacion` sobre las tablas de la librería, que nazca con login o clave, que toque
 * `public`, que la migración no sea repetible, o que pise una política del rol de la web.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const NUEVO = "pedernal_autenticacion_plataforma";
const WEB = "pedernal_autenticacion";
const MIGRACION = "0088_rol_autenticacion_de_plataforma.sql";
const PRIVILEGIOS_DE_TABLA = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
];

describe.skipIf(base === null)(
  "0088 rol de autenticación de la consola contra una base real",
  () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let dueno: pg.Client;
    let sql: string;

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(base);
      dueno = new pg.Client({ connectionString: propia.base.dueno });
      await dueno.connect();
      sql = await readFile(join(CARPETA_DE_MIGRACIONES, MIGRACION), "utf8");
    });
    afterAll(async () => {
      await dueno.end();
      await propia.destruir();
    });

    const tablas = async () =>
      (
        await dueno.query<{ tabla: string }>(
          "select c.relname as tabla from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'autenticacion' and c.relkind = 'r' order by 1",
        )
      ).rows.map((f) => f.tabla);
    const privilegiosDe = async (rol: string) => {
      const resultado: string[] = [];
      for (const tabla of await tablas()) {
        const objeto = `autenticacion.${pg.escapeIdentifier(tabla)}`;
        for (const p of PRIVILEGIOS_DE_TABLA) {
          const { rows } = await dueno.query<{ si: boolean }>(
            "select has_table_privilege($1, $2, $3) as si",
            [rol, objeto, p],
          );
          if (rows[0]?.si === true) resultado.push(`${tabla}:${p}`);
        }
        const { rows: columnas } = await dueno.query<{ columna: string }>(
          "select attname as columna from pg_attribute where attrelid = $1::regclass and attnum > 0 and not attisdropped order by attnum",
          [objeto],
        );
        for (const { columna } of columnas) {
          for (const p of ["UPDATE", "INSERT", "SELECT"]) {
            const { rows } = await dueno.query<{ si: boolean }>(
              "select has_column_privilege($1, $2, $3, $4) as si",
              [rol, objeto, columna, p],
            );
            if (rows[0]?.si === true) resultado.push(`${tabla}.${columna}:${p}`);
          }
        }
      }
      return resultado;
    };

    it("el rol nace sin login ni clave, sin poderes y con los mismos topes que el de la web", async () => {
      const { rows } = await dueno.query<{ rolname: string; topes: string[] | null }>(
        `select rolname, rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication, rolinherit,
              (select array_agg(c order by c) from pg_db_role_setting s, unnest(s.setconfig) c where s.setrole = r.oid and s.setdatabase = 0) as topes
         from pg_roles r where rolname = any($1) order by rolname`,
        [[NUEVO, WEB]],
      );
      expect(rows).toHaveLength(2);
      const nuevo = rows.find((r) => r.rolname === NUEVO);
      const web = rows.find((r) => r.rolname === WEB);
      expect(nuevo).toMatchObject({
        rolcanlogin: false,
        rolsuper: false,
        rolbypassrls: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolreplication: false,
        rolinherit: false,
      });
      expect(nuevo?.topes).toEqual(web?.topes);
      const { rows: miembros } = await dueno.query(
        "select 1 from pg_auth_members m join pg_roles r on r.oid = m.member where r.rolname = $1",
        [NUEVO],
      );
      expect(miembros).toHaveLength(0);
    });

    it("tiene exactamente los mismos privilegios que `pedernal_autenticacion` en todas las tablas y columnas de la librería", async () => {
      const nuevo = await privilegiosDe(NUEVO);
      expect(nuevo.length).toBeGreaterThan(20);
      expect(nuevo).toEqual(await privilegiosDe(WEB));
    });

    it("no tiene nada sobre las tablas de `public` (el USAGE del esquema es el que ya da PUBLIC, igual que a la web)", async () => {
      const { rows } = await dueno.query<{ igual: boolean; usos: number }>(
        `select has_schema_privilege($1, 'public', 'USAGE') = has_schema_privilege($2, 'public', 'USAGE') as igual,
              (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relkind in ('r', 'v', 'm')
                  and has_table_privilege($1, c.oid, 'SELECT, INSERT, UPDATE, DELETE')) as usos`,
        [NUEVO, WEB],
      );
      expect(rows[0]).toEqual({ igual: true, usos: 0 });
    });

    it("cada política de las tablas de la librería nombra a un solo rol, sin `FOR ALL`, y las del rol de la web siguen intactas", async () => {
      const { rows } = await dueno.query<{ roles: string[]; cmd: string; n: number }>(
        `select roles::text[] as roles, cmd, count(*)::int as n from pg_policies
        where schemaname = 'autenticacion' group by 1, 2 order by 1, 2`,
      );
      for (const fila of rows) {
        expect(fila.roles).toHaveLength(1);
        expect([NUEVO, WEB]).toContain(fila.roles[0]);
        expect(fila.cmd).not.toBe("ALL");
      }
      const porRol = (rol: string) =>
        rows.filter((f) => f.roles[0] === rol).map((f) => `${f.cmd}:${f.n}`);
      // Las de la web: las cuatro de cada tabla de 0010 (5 tablas) y las de 0015 (3 tablas con 3 comandos).
      expect(porRol(WEB)).toEqual(["DELETE:7", "INSERT:8", "SELECT:8", "UPDATE:6"]);
      // Las de la consola: solo los comandos concedidos (user y account sin DELETE; twoFactor sin DELETE; las dos de intentos sin UPDATE).
      expect(porRol(NUEVO)).toEqual(["DELETE:5", "INSERT:8", "SELECT:8", "UPDATE:6"]);
      const { rows: forzadas } = await dueno.query(
        "select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'autenticacion' and c.relkind = 'r' and not (c.relrowsecurity and c.relforcerowsecurity)",
      );
      expect(forzadas).toEqual([]);
    });

    it("repetirla no cambia nada (privilegios, políticas ni atributos del rol)", async () => {
      const antes = {
        privilegios: await privilegiosDe(NUEVO),
        politicas: (
          await dueno.query(
            "select tablename, policyname, cmd, roles::text from pg_policies where schemaname = 'autenticacion' order by 1, 2",
          )
        ).rows,
      };
      await dueno.query(sql);
      await dueno.query(sql);
      expect(await privilegiosDe(NUEVO)).toEqual(antes.privilegios);
      expect(
        (
          await dueno.query(
            "select tablename, policyname, cmd, roles::text from pg_policies where schemaname = 'autenticacion' order by 1, 2",
          )
        ).rows,
      ).toEqual(antes.politicas);
    });

    it("si falta lo que la migración necesita (la tabla del segundo factor), frena sin crear nada", async () => {
      const aparte = await crearBaseAparte(base!);
      const cliente = new pg.Client({ connectionString: aparte.base.dueno });
      await cliente.connect();
      try {
        await cliente.query('drop table autenticacion."twoFactor" cascade');
        await expect(cliente.query(sql)).rejects.toMatchObject({ code: "55000" });
      } finally {
        await cliente.end();
        await aparte.destruir();
      }
    });
  },
);
