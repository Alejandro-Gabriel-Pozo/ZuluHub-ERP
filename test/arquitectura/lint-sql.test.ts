import { ESLint } from "eslint";
import { createRequire } from "node:module";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";

/**
 * Cada regla de lint del acceso a datos tiene violaciones inyectadas que la disparan y casos
 * permitidos que no. Se usa el parser de TypeScript sin tipos: las reglas son sintácticas.
 */

const require = createRequire(import.meta.url);
const { bloques } = require("../../arquitectura/lint-sql.cjs") as { bloques: unknown[] };

const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [
    { files: ["**/*.ts"], languageOptions: { parser: tseslint.parser } },
    ...(bloques as never[]),
  ],
});

async function mensajes(ruta: string, codigo: string): Promise<string[]> {
  const [resultado] = await eslint.lintText(codigo, { filePath: ruta });
  return (resultado?.messages ?? []).map((m) => `${m.ruleId ?? "?"}: ${m.message}`);
}

const ADAPTADOR = "src/adaptadores/postgres/x.ts";
const PERSISTENCIA = "src/modulos/empresas/persistencia/x.ts";

describe("lint del SQL: los valores viajan como parámetros", () => {
  it.each([
    ["sql.raw", "await sql.raw(`delete from ${tabla}`).execute(db);"],
    [
      "sql.raw con texto fijo (se pide el identificador escapado)",
      "await sql.raw('select 1').execute(db);",
    ],
    [
      "query() con valores interpolados",
      "await cliente.query(`select * from t where id = '${id}'`);",
    ],
    ["query() con texto concatenado", "await cliente.query('select * from t where id = ' + id);"],
    ["query() de un pool", "await pool.query(`update t set a = ${a}`);"],
  ])("se prohíbe en adaptadores y en persistencia: %s", async (_nombre, codigo) => {
    expect(await mensajes(ADAPTADOR, codigo)).not.toEqual([]);
    expect(await mensajes(PERSISTENCIA, codigo)).not.toEqual([]);
  });

  it.each([
    [
      "sql con valores como parámetros",
      "await sql`select set_config('a', ${valor}, true)`.execute(db);",
    ],
    [
      "sql.id y sql.table para identificadores",
      "await sql`select * from ${sql.table(tabla)}`.execute(db);",
    ],
    [
      "query() con texto fijo y parámetros",
      "await cliente.query('select * from t where id = $1', [id]);",
    ],
    ["query() con plantilla sin interpolación", "await cliente.query(`select 1`);"],
    [
      "query() con una variable ya armada (p. ej. el contenido de una migración)",
      "await cliente.query(sqlDeLaMigracion);",
    ],
    [
      "el constructor de consultas de Kysely",
      "await db.selectFrom('t').where('id', '=', id).execute();",
    ],
  ])("se permite: %s", async (_nombre, codigo) => {
    expect(await mensajes(ADAPTADOR, codigo)).toEqual([]);
    expect(await mensajes(PERSISTENCIA, codigo)).toEqual([]);
  });

  it("las pruebas quedan afuera, y también lo que no es acceso a datos", async () => {
    const peligroso = "await sql.raw(`delete from ${tabla}`).execute(db);";
    expect(await mensajes("test/integracion/x.test.ts", peligroso)).toEqual([]);
    expect(await mensajes("src/adaptadores/postgres/x.test.ts", peligroso)).toEqual([]);
    expect(await mensajes("src/modulos/empresas/dominio/x.ts", peligroso)).toEqual([]);
  });
});
