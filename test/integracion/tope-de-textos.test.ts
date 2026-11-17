import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { CATALOGO_DE_TEXTOS } from "../../src/capacidades/vocabulario/catalogo";
import { crearBaseAparte } from "./entorno";
import type { BaseDePruebas } from "./global";

/**
 * 0041: el tope de textos por marca (2000, DEC-0200) con una base real: la restricción de la versión de marca usa la función ampliada, la regla de
 * cada texto sigue siendo la de 0007 (por tramos de 500), el catálogo del código cabe con margen, y la reversión deja el tope de 500.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });
const REVERSION = join(
  import.meta.dirname,
  "../../migraciones/reversiones/0041_revertir_tope_de_textos_por_marca.sql",
);
const TOPE = 2000;

describe.skipIf(base === null)("migración 0041: tope de textos por marca", () => {
  let aparte: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  beforeAll(async () => {
    aparte = await crearBaseAparte(base as BaseDePruebas);
    dueno = new pg.Client({ connectionString: aparte.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await aparte.destruir();
  });

  const con = (n: number, texto = "t") =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`a.k${i}`, texto]));
  const valida = async (vocabularios: readonly unknown[]) =>
    (
      await dueno.query<{ v: boolean }>(
        `select vocabulario_valido_ampliado(v::jsonb) as v from unnest($1::text[]) with ordinality as t(v, n) order by n`,
        [vocabularios.map((v) => JSON.stringify(v))],
      )
    ).rows.map((r) => r.v);

  it("el catálogo de textos del código cabe en el tope con margen (si no, hay que subirlo ANTES de sumar textos)", () => {
    const textos = Object.keys(CATALOGO_DE_TEXTOS).length;
    expect(textos, "textos del catálogo").toBeLessThanOrEqual(TOPE - 200);
  });

  it("acepta hasta 2000 claves y rechaza 2001; vacío vale; solo un objeto", async () => {
    expect(await valida([{}, con(500), con(501), con(1999), con(TOPE), con(TOPE + 1)])).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
    ]);
    const { rows } = await dueno.query<{ v: boolean }>(
      `select vocabulario_valido_ampliado(v) as v from unnest(array['[]', '"x"', '1', 'null']::jsonb[]) as v
       union all select vocabulario_valido_ampliado(null)`,
    );
    expect(rows.map((r) => r.v)).toEqual([false, false, false, false, false]);
  });

  it("la regla de cada clave y de cada texto sigue siendo la de 0007, en cualquier tramo", async () => {
    expect(
      await valida([
        { ...con(1200), "b.mala": "con <angulos>" },
        { ...con(1200), "Mala.clave": "x" },
        { ...con(1200), "b.larga": "x".repeat(201) },
        { ...con(1200), "b.numero": 5 },
        { ...con(1200), "b.ok": "bien" },
      ]),
    ).toEqual([false, false, false, false, true]);
  });

  it("la restricción de la versión de marca usa la función ampliada y solo pedernal_plataforma la ejecuta", async () => {
    const { rows } = await dueno.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'version_de_marca_vocabulario_ck'`,
    );
    expect(rows[0]?.def).toContain("vocabulario_valido_ampliado(vocabulario)");
    const { rows: p } = await dueno.query<{ rol: string; puede: boolean }>(
      `select r as rol, has_function_privilege(r, 'vocabulario_valido_ampliado(jsonb)', 'EXECUTE') as puede
         from unnest(array['pedernal_app','pedernal_grupo','pedernal_trabajos','pedernal_plataforma']) as r order by 1`,
    );
    expect(p.filter((x) => x.puede).map((x) => x.rol)).toEqual(["pedernal_plataforma"]);
  });

  it("la reversión deja el tope de 500 y se puede repetir", async () => {
    const otra = await crearBaseAparte(base as BaseDePruebas);
    const c = new pg.Client({ connectionString: otra.base.dueno });
    await c.connect();
    try {
      const sql = await readFile(REVERSION, "utf8");
      for (let i = 0; i < 2; i++) {
        await c.query("begin");
        await c.query(sql);
        await c.query("commit");
      }
      const def = await c.query<{ def: string }>(
        `select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'version_de_marca_vocabulario_ck'`,
      );
      expect(def.rows[0]?.def).toContain("vocabulario_valido(vocabulario)");
      const f = await c.query(
        `select 1 from pg_proc where proname = 'vocabulario_valido_ampliado'`,
      );
      expect(f.rowCount).toBe(0);
      const reg = await c.query(
        `select 1 from migracion where nombre = '0041_tope_de_textos_por_marca.sql'`,
      );
      expect(reg.rowCount).toBe(0);
    } finally {
      await c.end();
      await otra.destruir();
    }
  });
});
