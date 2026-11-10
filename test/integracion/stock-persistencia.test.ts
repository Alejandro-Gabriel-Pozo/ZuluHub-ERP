import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { COLUMNAS_DE_CATALOGO } from "../../src/modulos/catalogo/publico";
import {
  COLUMNAS_DE_CATALOGO_QUE_LEE_STOCK,
  ESTADOS_DE_CONTEO,
  USOS_DE_DEPOSITO,
  COLUMNAS_DE_STOCK,
  DECIMALES_DE_CATALOGO_QUE_LEE_STOCK,
  ERRORES_DE_STOCK_POR_RESTRICCION,
} from "../../src/modulos/stock/publico";
import type { BaseDePruebas } from "./global";

/**
 * El esquema de stock (0030 y los costos de 0031) contra lo que el código dice de él: las columnas de cada tabla, y que TODA restricción de la base (y cada
 * restricción que lanzan sus disparadores) tenga su traducción a un error de negocio, y que ninguna traducción apunte a algo que no existe.
 * Además: toda única de una tabla de empresa incluye `empresa_id`, toda clave foránea entre tablas de empresa es compuesta, las columnas
 * del catálogo que lee stock (`tablas.ts`) existen en el catálogo y en la base con el tipo con que se leen, y las listas cerradas que el
 * código repite (usos del depósito, estados del conteo) son las de los CHECK de la base. Una regla, un lugar: si alguien cambia una sola
 * punta, falla acá.
 */

const base = inject("baseDePruebas");
const TABLAS = Object.keys(COLUMNAS_DE_STOCK);

describe.skipIf(base === null)("stock: la persistencia contra el esquema real", () => {
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
      ).toEqual([...COLUMNAS_DE_STOCK[tabla as keyof typeof COLUMNAS_DE_STOCK]]);
    }
  });

  it("cada restricción de la base y cada una que lanza un disparador tiene su traducción, y no sobra ninguna", async () => {
    const { rows } = await c.query<{ nombre: string }>(
      `select conname as nombre from pg_constraint
        where connamespace = 'public'::regnamespace and contype not in ('n', 't') and conrelid::regclass::text = any($1)
       union
       select indexname from pg_indexes where schemaname = 'public' and tablename = any($1) and indexdef like 'CREATE UNIQUE%'`,
      [TABLAS],
    );
    // Los disparadores de 0030 y los de 0031 (costos): las dos migraciones son de stock.
    const migraciones = await Promise.all(
      ["0030_stock.sql", "0031_stock_costos.sql"].map((archivo) =>
        readFile(join(import.meta.dirname, "../../migraciones", archivo), "utf8"),
      ),
    );
    const deDisparadores = migraciones.flatMap((texto) =>
      [...texto.matchAll(/CONSTRAINT = '(\w+)'/g)].map((m) => m[1] as string),
    );
    expect(deDisparadores.length).toBeGreaterThan(40);
    const existentes = new Set([...rows.map((r) => r.nombre), ...deDisparadores]);
    const traducidas = new Set(Object.keys(ERRORES_DE_STOCK_POR_RESTRICCION));
    expect(
      [...existentes].filter((n) => !traducidas.has(n)).sort(),
      "restricciones sin traducción declarada",
    ).toEqual([]);
    expect(
      [...traducidas].filter((n) => !existentes.has(n)).sort(),
      "traducciones de restricciones que no existen",
    ).toEqual([]);
  });

  it("toda única de una tabla de empresa incluye `empresa_id` (salvo la clave primaria por `id` y la tabla global de motivos)", async () => {
    const { rows } = await c.query<{ tabla: string; indice: string; def: string }>(
      `select tablename as tabla, indexname as indice, indexdef as def from pg_indexes
        where schemaname = 'public' and tablename = any($1) and indexdef like 'CREATE UNIQUE%' and indexname not like '%_pkey'`,
      [TABLAS.filter((t) => t !== "motivo_de_movimiento")],
    );
    expect(rows.length).toBeGreaterThan(12);
    expect(rows.filter((r) => !r.def.includes("empresa_id")).map((r) => r.indice)).toEqual([]);
  });

  it("toda clave foránea entre tablas de empresa es compuesta con `empresa_id` (una fila no puede apuntar a otra empresa)", async () => {
    const { rows } = await c.query<{ nombre: string; def: string }>(
      `select conname as nombre, pg_get_constraintdef(oid) as def from pg_constraint
        where connamespace = 'public'::regnamespace and contype = 'f' and conrelid::regclass::text = any($1)`,
      [TABLAS],
    );
    const entreTablasDeEmpresa = rows.filter(
      (r) => !/REFERENCES (empresa|persona|unidad_de_medida|motivo_de_movimiento)\(/.test(r.def),
    );
    expect(entreTablasDeEmpresa.length).toBeGreaterThan(15);
    expect(
      entreTablasDeEmpresa.filter((r) => !r.def.includes("empresa_id")).map((r) => r.nombre),
    ).toEqual([]);
  });

  it("las columnas del catálogo que lee stock existen en el catálogo (lo que declara de sí) y en la base real, y los decimales son `numeric`", async () => {
    for (const [tabla, columnas] of Object.entries(COLUMNAS_DE_CATALOGO_QUE_LEE_STOCK)) {
      const delCatalogo: readonly string[] =
        COLUMNAS_DE_CATALOGO[tabla as keyof typeof COLUMNAS_DE_CATALOGO];
      expect(delCatalogo, tabla).toBeDefined();
      for (const columna of columnas) {
        expect(delCatalogo, `${tabla}.${columna} en COLUMNAS_DE_CATALOGO`).toContain(columna);
      }
      const { rows } = await c.query<{ column_name: string; data_type: string }>(
        "select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = $1",
        [tabla],
      );
      const porNombre = new Map(rows.map((r) => [r.column_name, r.data_type]));
      for (const columna of columnas) {
        expect(porNombre.has(columna), `${tabla}.${columna} en la base`).toBe(true);
      }
    }
    expect(DECIMALES_DE_CATALOGO_QUE_LEE_STOCK.length).toBeGreaterThan(0);
    for (const [tabla, columna] of DECIMALES_DE_CATALOGO_QUE_LEE_STOCK) {
      const { rows } = await c.query<{ data_type: string }>(
        "select data_type from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = $2",
        [tabla, columna],
      );
      expect(rows[0]?.data_type, `${tabla}.${columna}`).toBe("numeric");
    }
  });

  /** Los valores entre comillas de un CHECK `col IN (...)` o `col = ANY (ARRAY[...])`: lo que la base PERMITE. */
  const permitidosDe = async (restriccion: string): Promise<string[]> => {
    const { rows } = await c.query<{ def: string }>(
      "select pg_get_constraintdef(oid) as def from pg_constraint where conname = $1 and connamespace = 'public'::regnamespace",
      [restriccion],
    );
    expect(rows).toHaveLength(1);
    return [...(rows[0]?.def ?? "").matchAll(/'([A-Z_]+)'/g)].map((m) => m[1] as string).sort();
  };

  it("los usos del depósito y los estados del conteo que repite el código son los de los CHECK de la base", async () => {
    expect([...USOS_DE_DEPOSITO].sort()).toEqual(await permitidosDe("deposito_uso_ck"));
    expect([...ESTADOS_DE_CONTEO].sort()).toEqual(await permitidosDe("conteo_fisico_estado_ck"));
  });
});
