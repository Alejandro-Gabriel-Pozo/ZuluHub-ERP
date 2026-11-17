import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  COLUMNAS_DE_SALON,
  ERRORES_DE_SALON_POR_RESTRICCION,
} from "../../src/modulos/salon/publico";
import type { BaseDePruebas } from "./global";

/**
 * El esquema del salón (0038) contra lo que el código dice de él: las columnas de cada tabla, y que TODA restricción de la base (y cada restricción que
 * lanzan sus disparadores) tenga su traducción a un error de negocio, y que ninguna traducción apunte a algo que no existe. Además, toda única de una
 * tabla de empresa incluye `empresa_id` y toda clave foránea entre tablas de empresa es compuesta.
 */

const base = inject("baseDePruebas");
const TABLAS = Object.keys(COLUMNAS_DE_SALON);

describe.skipIf(base === null)("salón: la persistencia contra el esquema real", () => {
  let c: pg.Client;
  beforeAll(async () => {
    c = new pg.Client({ connectionString: (base as BaseDePruebas).dueno });
    await c.connect();
  });
  afterAll(async () => {
    await c.end();
  });

  it("las columnas de cada tabla, y su orden, son las que declara el código", async () => {
    for (const tabla of TABLAS) {
      const { rows } = await c.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position",
        [tabla],
      );
      expect(
        rows.map((r) => r.column_name),
        tabla,
      ).toEqual([...COLUMNAS_DE_SALON[tabla as keyof typeof COLUMNAS_DE_SALON]]);
    }
  });

  it("cada restricción del salón (y cada una que lanza un disparador suyo) tiene su traducción, y no sobra ninguna", async () => {
    const { rows } = await c.query<{ nombre: string }>(
      `select conname as nombre from pg_constraint
        where connamespace = 'public'::regnamespace and contype <> 'n' and conrelid::regclass::text = any($1)
       union
       select indexname from pg_indexes where schemaname = 'public' and tablename = any($1) and indexdef like 'CREATE UNIQUE%'`,
      [TABLAS],
    );
    const migracion = await readFile(
      join(import.meta.dirname, "../../migraciones/0038_salon.sql"),
      "utf8",
    );
    // Solo la sección del salón: lo que sigue (comandas) traduce lo suyo.
    const deSalon = migracion
      .split("-- SALÓN: la mesa y sus casillas")[1]
      ?.split("-- COMANDAS: contador y envíos")[0] as string;
    const deDisparadores = [...deSalon.matchAll(/CONSTRAINT = '(\w+)'/g)].map(
      (m) => m[1] as string,
    );
    expect(deDisparadores.length).toBeGreaterThan(3);
    const existentes = new Set([...rows.map((r) => r.nombre), ...deDisparadores]);
    const traducidas = new Set(Object.keys(ERRORES_DE_SALON_POR_RESTRICCION));
    expect(
      [...existentes].filter((n) => !traducidas.has(n)).sort(),
      "restricciones sin traducción declarada",
    ).toEqual([]);
    expect(
      [...traducidas].filter((n) => !existentes.has(n)).sort(),
      "traducciones de restricciones que no existen",
    ).toEqual([]);
  });

  it("toda única de una tabla de empresa incluye `empresa_id` (salvo las claves primarias)", async () => {
    const { rows } = await c.query<{ indice: string; def: string }>(
      `select indexname as indice, indexdef as def from pg_indexes
        where schemaname = 'public' and tablename = any($1) and indexdef like 'CREATE UNIQUE%' and indexname not like '%_pkey'`,
      [TABLAS],
    );
    expect(rows.length).toBeGreaterThan(3);
    expect(rows.filter((r) => !r.def.includes("empresa_id")).map((r) => r.indice)).toEqual([]);
  });

  it("toda clave foránea entre tablas de empresa es compuesta con `empresa_id` (una fila no puede apuntar a otra empresa)", async () => {
    const { rows } = await c.query<{ nombre: string; def: string }>(
      `select conname as nombre, pg_get_constraintdef(oid) as def from pg_constraint
        where connamespace = 'public'::regnamespace and contype = 'f' and conrelid::regclass::text = any($1)`,
      [TABLAS],
    );
    const entreTablasDeEmpresa = rows.filter((r) => !/REFERENCES (empresa|persona)\(/.test(r.def));
    expect(entreTablasDeEmpresa.length).toBeGreaterThan(8);
    expect(
      entreTablasDeEmpresa.filter((r) => !r.def.includes("empresa_id")).map((r) => r.nombre),
    ).toEqual([]);
  });
});
