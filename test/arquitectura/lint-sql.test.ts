import { ESLint } from "eslint";
import { createRequire } from "node:module";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";

/**
 * Cada regla de lint del acceso a datos tiene violaciones inyectadas que la disparan y casos
 * permitidos que no. Se usa el parser de TypeScript sin tipos: las reglas son sintácticas.
 */

const require = createRequire(import.meta.url);
const { bloques, crearBloques, ARCHIVOS_CON_UPSERT_REVISADO } =
  require("../../arquitectura/lint-sql.cjs") as {
    bloques: unknown[];
    crearBloques: (archivosConUpsertRevisado: readonly string[]) => unknown[];
    ARCHIVOS_CON_UPSERT_REVISADO: string[];
  };

const configuracion = (bloquesDeSql: unknown[]) =>
  new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      { files: ["**/*.ts"], languageOptions: { parser: tseslint.parser } },
      ...(bloquesDeSql as never[]),
    ],
  });

const eslint = configuracion(bloques);

async function mensajes(ruta: string, codigo: string, motor: ESLint = eslint): Promise<string[]> {
  const [resultado] = await motor.lintText(codigo, { filePath: ruta });
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

  describe("ON CONFLICT ... DO UPDATE solo en archivos revisados", () => {
    it.each([
      [
        "doUpdateSet de Kysely",
        "await db.insertInto('t').values(v).onConflict((oc) => oc.column('k').doUpdateSet({ a: 1 })).execute();",
      ],
      ["doUpdateSetIf de Kysely", "oc.column('k').doUpdateSetIf(cond, { a: 1 });"],
      [
        "texto SQL en un literal",
        "await cliente.query('insert into t values ($1) on conflict (k) do update set a = excluded.a', [x]);",
      ],
      [
        "texto SQL con DO  UPDATE en mayúsculas y espacios",
        "await cliente.query('INSERT INTO t VALUES ($1) ON CONFLICT (k) DO   UPDATE SET a = 1', [x]);",
      ],
      [
        "texto SQL en una plantilla",
        "await sql`insert into t values (${x}) on conflict (k) do update set a = excluded.a`.execute(db);",
      ],
    ])("se prohíbe: %s", async (_nombre, codigo) => {
      expect(await mensajes(ADAPTADOR, codigo)).not.toEqual([]);
      expect(await mensajes(PERSISTENCIA, codigo)).not.toEqual([]);
    });

    it.each([
      [
        "DO NOTHING con parámetros",
        "await cliente.query('insert into t values ($1) on conflict (k) do nothing returning *', [x]);",
      ],
      [
        "doNothing de Kysely",
        "await db.insertInto('t').values(v).onConflict((oc) => oc.column('k').doNothing()).execute();",
      ],
      [
        "una palabra parecida en otro texto",
        "const aviso = 'no hay que hacer un update del precio';",
      ],
    ])("se permite: %s", async (_nombre, codigo) => {
      expect(await mensajes(ADAPTADOR, codigo)).toEqual([]);
    });

    it("la lista de archivos revisados está vacía: cada alta requiere revisión explícita", () => {
      expect(ARCHIVOS_CON_UPSERT_REVISADO).toEqual([]);
    });

    it("un archivo de la lista revisada puede usar DO UPDATE, pero sigue sin poder inyectar SQL", async () => {
      const revisado = "src/adaptadores/postgres/importar-catalogo.ts";
      const motor = configuracion(crearBloques([revisado]));
      const upsert =
        "await db.insertInto('t').values(v).onConflict((oc) => oc.column('k').doUpdateSet({ a: 1 })).execute();";
      expect(await mensajes(revisado, upsert, motor)).toEqual([]);
      expect(await mensajes("src/adaptadores/postgres/otro.ts", upsert, motor)).not.toEqual([]);
      const inyeccion = "await cliente.query(`select * from t where id = '${id}'`);";
      expect(await mensajes(revisado, inyeccion, motor)).not.toEqual([]);
    });

    it("las pruebas quedan afuera de la regla de upsert", async () => {
      const upsert = "oc.column('k').doUpdateSet({ a: 1 });";
      expect(await mensajes("test/integracion/x.test.ts", upsert)).toEqual([]);
    });
  });
});
