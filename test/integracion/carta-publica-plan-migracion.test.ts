import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { describe, expect, inject, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import { crearBaseAparte } from "./entorno";
import type { BaseDePruebas } from "./global";

/**
 * Migración 0050 (el plan en la lectura pública de la carta, T6) contra una base real: exige sus requisitos, su reversión no cambia datos y se puede repetir, y
 * volver a aplicarla deja los mismos permisos. Lo que el rol público lee y lo que no, con filas reales, está en `carta-publica-plan.test.ts`.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });
const CARPETA = join(import.meta.dirname, "../../migraciones");
const MIGRACION = "0050_plan_en_la_lectura_publica_de_carta.sql";
const REVERSION = join(
  CARPETA,
  "reversiones/0050_revertir_plan_en_la_lectura_publica_de_carta.sql",
);
const TABLAS = ["modulo_de_empresa", "plan_de_tenant", "version_de_plan", "ajuste_de_perilla"];

const conCliente = async <T>(url: string, trabajo: (c: pg.Client) => Promise<T>): Promise<T> => {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await trabajo(c);
  } finally {
    await c.end();
  }
};
const permisos = (c: pg.Client) =>
  c.query<{ tabla: string; columnas: string }>(
    `select table_name as tabla, string_agg(column_name, ',' order by column_name) as columnas
       from information_schema.column_privileges
      where grantee = 'pedernal_publico' and privilege_type = 'SELECT' and table_schema = 'public'
        and table_name = any($1) group by table_name order by table_name`,
    [TABLAS],
  );
const politicas = (c: pg.Client) =>
  c.query<{ policyname: string }>(
    `select policyname from pg_policies where schemaname = 'public' and tablename = any($1) and roles = '{pedernal_publico}' order by policyname`,
    [TABLAS],
  );

describe.skipIf(base === null)("migración 0050: el plan en la lectura pública de la carta", () => {
  it("otorga exactamente cuatro tablas con sus columnas y una política por tabla; la reversión las quita sin tocar datos y se puede repetir; reaplicar las devuelve", async () => {
    const aparte = await crearBaseAparte(base as BaseDePruebas);
    try {
      await conCliente(aparte.base.dueno, async (c) => {
        const otorgado = await permisos(c);
        expect(otorgado.rows).toEqual([
          {
            tabla: "ajuste_de_perilla",
            columnas: "empresa_id,numero,perilla,tenant_id,valor,vigente_desde",
          },
          { tabla: "modulo_de_empresa", columnas: "activo,empresa_id,modulo" },
          {
            tabla: "plan_de_tenant",
            columnas: "numero,tenant_id,version_de_plan_id,vigente_desde",
          },
          { tabla: "version_de_plan", columnas: "id,modulos,numero,perillas,plan_id" },
        ]);
        expect((await politicas(c)).rows.map((p) => p.policyname)).toEqual([
          "ajuste_de_perilla_publico_de_carta",
          "modulo_de_empresa_publico_de_carta",
          "plan_de_tenant_publico_de_carta",
          "version_de_plan_publico_de_carta",
        ]);
        // Ni funciones nuevas con permisos del dueño: nada de SECURITY DEFINER en lo que trae 0050.
        const definer = await c.query(
          "select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and p.proname like '%carta%'",
        );
        expect(definer.rowCount).toBe(0);

        const antes = await c.query<{ n: string }>(
          "select (select count(*) from plan) + (select count(*) from tenant) as n",
        );
        const sql = await readFile(REVERSION, "utf8");
        for (let vez = 0; vez < 2; vez++) {
          await c.query("begin");
          await c.query(sql);
          await c.query("commit");
          expect((await permisos(c)).rows).toEqual([]);
          expect((await politicas(c)).rows).toEqual([]);
          expect(
            (await c.query("select 1 from migracion where nombre = $1", [MIGRACION])).rowCount,
          ).toBe(0);
        }
        const despues = await c.query<{ n: string }>(
          "select (select count(*) from plan) + (select count(*) from tenant) as n",
        );
        expect(despues.rows).toEqual(antes.rows);
      });
      const otra = await aplicarMigraciones(aparte.base.dueno, CARPETA);
      expect(otra.aplicadas).toEqual([MIGRACION]);
      await conCliente(aparte.base.dueno, async (c) => {
        expect((await permisos(c)).rows).toHaveLength(4);
        expect((await politicas(c)).rows).toHaveLength(4);
      });
    } finally {
      await aparte.destruir();
    }
  });

  it("exige 0044 antes: sin la política de empresa de la carta no se aplica", async () => {
    const aparte = await crearBaseAparte(base as BaseDePruebas);
    try {
      await conCliente(aparte.base.dueno, async (c) => {
        await c.query("begin");
        await c.query(await readFile(REVERSION, "utf8"));
        await c.query("drop policy empresa_publico_de_carta on empresa");
        await c.query("commit");
        await c
          .query("delete from migracion where nombre = $1", [MIGRACION])
          .catch(() => undefined);
      });
      await expect(aplicarMigraciones(aparte.base.dueno, CARPETA)).rejects.toThrow(/0044/);
    } finally {
      await aparte.destruir();
    }
  });
});
