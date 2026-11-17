import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { ERRORES_DE_CLIENTES_POR_RESTRICCION } from "../../src/modulos/clientes/persistencia/errores-por-restriccion";
import { ESTADOS_DE_PARTE, NATURALEZAS_DE_PARTE } from "../../src/modulos/clientes/dominio/estados";
import { TIPOS_DE_DOCUMENTO_DE_PARTE } from "../../src/modulos/clientes/dominio/documento";
import { CONDICIONES_DE_IVA } from "../../src/primitivas/identificacion-fiscal/condicion-iva";
import type { BaseDePruebas } from "./global";

/**
 * El esquema del directorio (0034) contra lo que el código dice de él: que TODA restricción de la base (y cada restricción que lanzan sus disparadores)
 * tenga su traducción a un error de negocio, que ninguna traducción apunte a algo que no existe, que toda única de una tabla de empresa incluya
 * `empresa_id`, que toda clave foránea entre tablas de empresa sea compuesta, y que las listas cerradas que el código repite (estados, naturalezas, tipos
 * de documento, condiciones de IVA) sean las de los CHECK de la base. Una regla, un lugar: si alguien cambia una sola punta, falla acá.
 */

const base = inject("baseDePruebas");
const TABLAS = ["rol_de_parte", "tipo_de_vinculo", "parte", "parte_rol", "parte_vinculo"];

describe.skipIf(base === null)("clientes: la persistencia contra el esquema real", () => {
  let c: pg.Client;
  beforeAll(async () => {
    c = new pg.Client({ connectionString: (base as BaseDePruebas).dueno });
    await c.connect();
  });
  afterAll(async () => {
    await c.end();
  });

  it("cada restricción de la base y cada una que lanza un disparador tiene su traducción, y no sobra ninguna", async () => {
    const { rows } = await c.query<{ nombre: string }>(
      `select conname as nombre from pg_constraint
        where connamespace = 'public'::regnamespace and contype not in ('n', 't') and conrelid::regclass::text = any($1)
       union
       select indexname from pg_indexes where schemaname = 'public' and tablename = any($1) and indexdef like 'CREATE UNIQUE%'`,
      [TABLAS],
    );
    const migracion = await readFile(
      join(import.meta.dirname, "../../migraciones", "0034_clientes.sql"),
      "utf8",
    );
    const deDisparadores = [...migracion.matchAll(/CONSTRAINT = '(\w+)'/g)].map(
      (m) => m[1] as string,
    );
    expect(deDisparadores.length).toBeGreaterThan(8);
    const existentes = new Set([...rows.map((r) => r.nombre), ...deDisparadores]);
    const traducidas = new Set(Object.keys(ERRORES_DE_CLIENTES_POR_RESTRICCION));
    expect(
      [...existentes].filter((n) => !traducidas.has(n)).sort(),
      "restricciones sin traducción declarada",
    ).toEqual([]);
    expect(
      [...traducidas].filter((n) => !existentes.has(n)).sort(),
      "traducciones de restricciones que no existen",
    ).toEqual([]);
  });

  it("toda única de una tabla de empresa incluye `empresa_id` (salvo la clave primaria por `id` y las dos tablas globales)", async () => {
    const { rows } = await c.query<{ indice: string; def: string }>(
      `select indexname as indice, indexdef as def from pg_indexes
        where schemaname = 'public' and tablename = any($1) and indexdef like 'CREATE UNIQUE%' and indexname not like '%_pkey'`,
      [["parte", "parte_rol", "parte_vinculo"]],
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.filter((r) => !r.def.includes("empresa_id")).map((r) => r.indice)).toEqual([]);
  });

  it("toda clave foránea entre tablas de empresa es compuesta con `empresa_id`", async () => {
    const { rows } = await c.query<{ nombre: string; def: string }>(
      `select conname as nombre, pg_get_constraintdef(oid) as def from pg_constraint
        where connamespace = 'public'::regnamespace and contype = 'f' and conrelid::regclass::text = any($1)`,
      [TABLAS],
    );
    const entreTablasDeEmpresa = rows.filter((r) => /REFERENCES parte\(/.test(r.def));
    expect(entreTablasDeEmpresa.length).toBe(3);
    expect(
      entreTablasDeEmpresa.filter((r) => !r.def.includes("empresa_id")).map((r) => r.nombre),
    ).toEqual([]);
  });

  it("las listas cerradas del código son las de los CHECK de la base", async () => {
    const check = async (nombre: string) =>
      (
        await c.query<{ def: string }>(
          "select pg_get_constraintdef(oid) as def from pg_constraint where conname = $1 and conrelid = 'parte'::regclass",
          [nombre],
        )
      ).rows[0]?.def ?? "";
    const valores = (def: string) => [...def.matchAll(/'([A-Z_0-9]+)'::text/g)].map((m) => m[1]);
    expect(valores(await check("parte_naturaleza_ck")).sort()).toEqual(
      [...NATURALEZAS_DE_PARTE].sort(),
    );
    expect(valores(await check("parte_estado_ck")).sort()).toEqual([...ESTADOS_DE_PARTE].sort());
    expect(valores(await check("parte_documento_tipo_ck")).sort()).toEqual(
      [...TIPOS_DE_DOCUMENTO_DE_PARTE].sort(),
    );
    expect(valores(await check("parte_condicion_iva_ck")).sort()).toEqual(
      [...CONDICIONES_DE_IVA].sort(),
    );
  });
});
