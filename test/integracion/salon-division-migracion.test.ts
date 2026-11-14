import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { describe, expect, inject, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import { crearBaseAparte } from "./entorno";
import type { BaseDePruebas } from "./global";

/**
 * Migración 0052 (tope de partes de la división, 14/11/2026) contra una base real: ampliar el rango no toca filas, su reversión vuelve al tope de 4 y se
 * puede repetir, y se FRENA con un error claro si hay una división con más de 4 partes (el rango viejo la dejaría inválida). Que el número de la base
 * coincida con la constante lo comprueba `salon-division-limites.test.ts`.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });
const CARPETA = join(import.meta.dirname, "../../migraciones");
const MIGRACION = "0052_tope_de_partes_de_la_division.sql";
const REVERSION = join(CARPETA, "reversiones/0052_revertir_tope_de_partes_de_la_division.sql");

const conCliente = async <T>(url: string, trabajo: (c: pg.Client) => Promise<T>): Promise<T> => {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await trabajo(c);
  } finally {
    await c.end();
  }
};
const topes = async (c: pg.Client): Promise<string[]> =>
  (
    await c.query<{ d: string }>(
      `select pg_get_constraintdef(oid) as d from pg_constraint
        where conname in ('division_partes_ck', 'parte_de_division_numero_ck') order by conname`,
    )
  ).rows.map((f) => f.d);

describe.skipIf(base === null)("migración 0052: el tope de partes de la división", () => {
  it("amplía a 12; la reversión vuelve a 4 y se repite; reaplicar deja 12", async () => {
    const aparte = await crearBaseAparte(base as BaseDePruebas);
    try {
      await conCliente(aparte.base.dueno, async (c) => {
        expect(await topes(c)).toEqual([
          expect.stringContaining("<= 12"),
          expect.stringContaining("<= 12"),
        ]);
        const sql = await readFile(REVERSION, "utf8");
        for (let vez = 0; vez < 2; vez++) {
          await c.query("begin");
          await c.query(sql);
          await c.query("commit");
          expect(await topes(c)).toEqual([
            expect.stringContaining("<= 4"),
            expect.stringContaining("<= 4"),
          ]);
          expect(
            (await c.query("select 1 from migracion where nombre = $1", [MIGRACION])).rowCount,
          ).toBe(0);
        }
      });
      expect((await aplicarMigraciones(aparte.base.dueno, CARPETA)).aplicadas).toEqual([MIGRACION]);
      await conCliente(aparte.base.dueno, async (c) => {
        expect(await topes(c)).toEqual([
          expect.stringContaining("<= 12"),
          expect.stringContaining("<= 12"),
        ]);
      });
    } finally {
      await aparte.destruir();
    }
  });

  it("la reversión se frena, sin cambiar nada, si hay una división con más de 4 partes", async () => {
    const aparte = await crearBaseAparte(base as BaseDePruebas);
    try {
      await conCliente(aparte.base.dueno, async (c) => {
        // Base de descarte: se sacan las claves foráneas y el disparador de «cuadran» para sembrar la fila sin armar toda la mesa.
        await c.query("begin");
        for (const [tabla, restriccion] of (
          await c.query<{ t: string; r: string }>(
            `select conrelid::regclass::text as t, conname as r from pg_constraint
              where contype = 'f' and conrelid in ('division_de_cuenta'::regclass, 'parte_de_division'::regclass)`,
          )
        ).rows.map((f) => [f.t, f.r] as const))
          await c.query(`alter table ${tabla} drop constraint ${restriccion}`);
        await c.query(
          "drop trigger if exists division_partes_de_la_division on division_de_cuenta",
        );
        await c.query("drop trigger if exists division_partes_de_la_parte on parte_de_division");
        const id = "00000000-0000-4000-8000-000000000001";
        await c.query(
          `insert into division_de_cuenta (id, empresa_id, sucursal_id, cuenta_madre_id, mesa_id, partes, dividida_por, dividida_en, huella)
           values ($1, $1, $1, $1, $1, 5, $1, now(), repeat('a', 64))`,
          [id],
        );
        await c.query("commit");

        const sql = await readFile(REVERSION, "utf8");
        await c.query("begin");
        await expect(c.query(sql)).rejects.toMatchObject({
          code: "55000",
          message: expect.stringContaining("1 divisiones con más de 4 partes") as unknown,
        });
        await c.query("rollback");
        expect(await topes(c)).toEqual([
          expect.stringContaining("<= 12"),
          expect.stringContaining("<= 12"),
        ]);
      });
    } finally {
      await aparte.destruir();
    }
  });
});
