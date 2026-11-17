import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  acepta,
  check,
  conAppDe,
  crearMundo,
  denegado,
  intentoDelDueno,
  sinConfirmar,
  type Mundo,
} from "./fiscal-apoyo";
import type { BaseDePruebas } from "./global";
import { CARPETA_DE_MIGRACIONES } from "./marcas-apoyo";

/**
 * La migración 0067 (compras N4, tolerancias y diferencias) contra una base real: las tres tablas con RLS forzada y privilegios por columna, los rangos de las tolerancias, que la
 * aplicación sí puede fijar las suyas y nadie borra, que las tolerancias aplicadas son de solo inserción y la reversión (frena con datos, con confirmación borra y restaura las
 * funciones de 0066, repetible). Las diferencias en sí (transiciones, inmutabilidad, que solo entran con su conciliación) las prueba `compras-n4-diferencias.test.ts` con conciliaciones reales.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const TABLAS = [
  "tolerancia_de_compras",
  "tolerancia_aplicada_de_conciliacion",
  "diferencia_de_compra",
] as const;
const REVERSION = join(
  CARPETA_DE_MIGRACIONES,
  "reversiones",
  "0067_revertir_compras_diferencias.sql",
);
const b = (): BaseDePruebas => {
  if (base === null) throw new Error("sin base de pruebas");
  return base;
};

describe.skipIf(base === null)(
  "0067 compras N4: tolerancias y diferencias contra una base real",
  () => {
    let dueno: pg.Client;
    beforeAll(async () => {
      dueno = new pg.Client({ connectionString: b().dueno });
      await dueno.connect();
    });
    afterAll(async () => {
      await dueno.end();
    });

    const conConfiguracion = async (): Promise<Mundo> => {
      const m = await crearMundo(dueno);
      await dueno.query(
        "insert into configuracion_de_compras (empresa_id, nivel) values ($1, 'TRES_VIAS') on conflict do nothing",
        [m.empresa],
      );
      return m;
    };

    it("las tres tablas tienen RLS forzada, las políticas esperadas y nadie recibe DELETE ni TRUNCATE", async () => {
      const tablas = (
        await dueno.query<{
          relname: string;
          relrowsecurity: boolean;
          relforcerowsecurity: boolean;
        }>(
          "select relname, relrowsecurity, relforcerowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname = any($1)",
          [[...TABLAS]],
        )
      ).rows;
      expect(tablas).toHaveLength(TABLAS.length);
      for (const t of tablas)
        expect([t.relrowsecurity, t.relforcerowsecurity], t.relname).toEqual([true, true]);
      const politicas = (
        await dueno.query<{ tablename: string; cmd: string }>(
          "select tablename, cmd from pg_policies where schemaname = 'public' and tablename = any($1)",
          [[...TABLAS]],
        )
      ).rows;
      const de = (t: string) =>
        politicas
          .filter((p) => p.tablename === t)
          .map((p) => p.cmd)
          .sort();
      expect(de("tolerancia_de_compras")).toEqual(["INSERT", "SELECT", "UPDATE"]);
      expect(de("diferencia_de_compra")).toEqual(["INSERT", "SELECT", "UPDATE"]);
      expect(de("tolerancia_aplicada_de_conciliacion")).toEqual(["INSERT", "SELECT"]);
      const privilegios = (
        await dueno.query<{ privilege_type: string }>(
          "select privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = any($1) and grantee = 'pedernal_app'",
          [[...TABLAS]],
        )
      ).rows;
      expect(privilegios.filter((p) => ["DELETE", "TRUNCATE"].includes(p.privilege_type))).toEqual(
        [],
      );
    });

    it("las tolerancias: la aplicación las crea y las cambia, la versión sube, los rangos se imponen y no se borran; cada empresa ve solo las suyas", async () => {
      const m = await conConfiguracion();
      const otra = await conConfiguracion();
      await conAppDe(b(), m, async (s) => {
        acepta(
          await s.intentar(
            "insert into tolerancia_de_compras (empresa_id, tolerancia_de_cantidad, tolerancia_de_importe) values ($1, 2.5, 100)",
            [m.empresa],
          ),
        );
        acepta(
          await s.intentar(
            "update tolerancia_de_compras set tolerancia_de_precio = 0, tolerancia_de_recepcion = 100 where empresa_id = $1",
            [m.empresa],
          ),
        );
        const r = await s.intentar(
          "select version, tolerancia_de_cantidad::text as c, tolerancia_de_precio::text as p, tolerancia_de_importe::text as i, tolerancia_de_recepcion::text as r from tolerancia_de_compras",
        );
        expect(r.ok && r.rows).toEqual([
          { version: 2, c: "2.5000", p: "0.0000", i: "100.00", r: "100.0000" },
        ]);
        for (const columna of [
          "tolerancia_de_cantidad = 100.0001",
          "tolerancia_de_cantidad = -1",
          "tolerancia_de_precio = 101",
          "tolerancia_de_recepcion = -0.0001",
          "tolerancia_de_importe = -0.01",
        ]) {
          check(
            await s.intentar(`update tolerancia_de_compras set ${columna} where empresa_id = $1`, [
              m.empresa,
            ]),
            columna.startsWith("tolerancia_de_importe")
              ? "tolerancia_importe_ck"
              : columna.startsWith("tolerancia_de_cantidad")
                ? "tolerancia_cantidad_ck"
                : columna.startsWith("tolerancia_de_precio")
                  ? "tolerancia_precio_ck"
                  : "tolerancia_recepcion_ck",
          );
        }
        denegado(await s.intentar("delete from tolerancia_de_compras"));
        denegado(await s.intentar("update tolerancia_de_compras set version = 9"));
        expect((await s.confirmar()).ok).toBe(true);
      });
      await conAppDe(b(), otra, async (s) => {
        const r = await s.intentar("select count(*)::int as n from tolerancia_de_compras");
        expect(r.ok && r.rows[0]).toEqual({ n: 0 });
        denegado(
          await s.intentar(
            "insert into tolerancia_de_compras (empresa_id, tolerancia_de_cantidad) values ($1, 1)",
            [m.empresa],
          ),
        );
      });
    });

    it("una empresa sin configuración de compras no tiene tolerancias (clave foránea)", async () => {
      const m = await crearMundo(dueno);
      await dueno.query("begin");
      try {
        const r = await intentoDelDueno(
          dueno,
          "insert into tolerancia_de_compras (empresa_id) values ($1)",
          [m.empresa],
        );
        expect(r.ok).toBe(false);
        expect(!r.ok && r.restriccion).toBe("tolerancia_de_compras_configuracion_fkey");
      } finally {
        await dueno.query("rollback");
      }
    });

    it("las tolerancias aplicadas y las diferencias solo entran con una conciliación hecha en la misma transacción", async () => {
      const m = await conConfiguracion();
      await conAppDe(b(), m, async (s) => {
        const r = await s.intentar(
          "insert into tolerancia_aplicada_de_conciliacion (empresa_id, conciliacion_id) values ($1, gen_random_uuid())",
          [m.empresa],
        );
        expect(r.ok).toBe(false);
        denegado(await s.intentar("delete from tolerancia_aplicada_de_conciliacion"));
        denegado(
          await s.intentar(
            "update tolerancia_aplicada_de_conciliacion set tolerancia_de_precio = 1",
          ),
        );
      });
    });

    describe("reversión", () => {
      const reversion = () => readFile(REVERSION, "utf8");
      it("frena si hay filas, con confirmación borra las tablas y restaura las funciones de 0066 sin tolerancia, y se puede repetir", async () => {
        const m = await conConfiguracion();
        await dueno.query(
          "insert into tolerancia_de_compras (empresa_id, tolerancia_de_recepcion) values ($1, 5)",
          [m.empresa],
        );
        const sql = await reversion();
        await sinConfirmar(dueno, async () => {
          const frena = await intentoDelDueno(dueno, sql);
          expect(frena.ok ? "" : frena.codigo).toBe("55000");
          await dueno.query("set local pedernal.confirmar_reversion = 'SI'");
          acepta(await intentoDelDueno(dueno, sql));
          acepta(await intentoDelDueno(dueno, sql));
          for (const t of TABLAS) {
            const existe = await dueno.query<{ t: string | null }>(
              "select to_regclass($1)::text as t",
              [`public.${t}`],
            );
            expect(existe.rows[0]?.t, t).toBeNull();
          }
          const funciones = await dueno.query<{ definicion: string }>(
            "select pg_get_functiondef(p.oid) as definicion from pg_proc p where p.proname in ('compras_vinculo_de_orden_valida', 'compras_recepcion_confirmada_suma_a_la_orden')",
          );
          expect(funciones.rows).toHaveLength(2);
          for (const f of funciones.rows)
            expect(f.definicion).not.toContain("tolerancia_de_recepcion");
          const orden = await dueno.query(
            "select 1 from pg_class where relname = 'orden_de_compra'",
          );
          expect(orden.rowCount).toBe(1);
        });
      });
    });
  },
);
