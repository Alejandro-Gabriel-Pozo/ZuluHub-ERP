import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { describe, expect, inject, it } from "vitest";
import { ErrorDeMigracion, aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import { crearBaseAparte } from "./entorno";

const base = inject("baseDePruebas");
const CARPETA_REAL = join(import.meta.dirname, "../../migraciones");

async function carpetaTemporal(archivos: Record<string, string>): Promise<string> {
  const carpeta = await mkdtemp(join(tmpdir(), "zuluhub-mig-"));
  for (const [nombre, contenido] of Object.entries(archivos)) {
    await writeFile(join(carpeta, nombre), contenido);
  }
  return carpeta;
}

describe.skipIf(base === null)("migraciones", () => {
  it("sobre una base limpia crean todo, y correrlas de nuevo no cambia nada", async () => {
    if (base === null) return;
    const aparte = await crearBaseAparte(base, { migrar: false });
    try {
      const primera = await aplicarMigraciones(aparte.base.dueno, CARPETA_REAL);
      expect(primera.aplicadas).toEqual(["0001_base.sql", "0002_identidad.sql"]);
      const segunda = await aplicarMigraciones(aparte.base.dueno, CARPETA_REAL);
      expect(segunda).toEqual({
        aplicadas: [],
        yaAplicadas: ["0001_base.sql", "0002_identidad.sql"],
      });
    } finally {
      await aparte.destruir();
    }
  });

  it("los roles existen con los privilegios esperados después de migrar una base limpia", async () => {
    if (base === null) return;
    const aparte = await crearBaseAparte(base);
    const cliente = new pg.Client({ connectionString: aparte.base.dueno });
    await cliente.connect();
    try {
      const { rows } = await cliente.query<{
        rolname: string;
        rolbypassrls: boolean;
        rolsuper: boolean;
      }>(
        `select rolname, rolbypassrls, rolsuper from pg_roles where rolname like 'zuluhub\\_%' escape '\\' order by rolname`,
      );
      expect(rows.map((r) => r.rolname)).toEqual([
        "zuluhub_app",
        "zuluhub_grupo",
        "zuluhub_plataforma",
        "zuluhub_trabajos",
      ]);
      expect(rows.every((r) => !r.rolbypassrls && !r.rolsuper)).toBe(true);
      const { rows: puede } = await cliente.query<{ ok: boolean }>(
        "select has_any_column_privilege('zuluhub_app', 'public.sucursal', 'INSERT') as ok",
      );
      expect(puede[0]?.ok).toBe(true);
    } finally {
      await cliente.end();
      await aparte.destruir();
    }
  });

  it("una migración ya aplicada que se editó rompe: el historial no se reescribe", async () => {
    if (base === null) return;
    const aparte = await crearBaseAparte(base, { migrar: false });
    const carpeta = await carpetaTemporal({ "0001_uno.sql": "create table uno (id int);" });
    try {
      await aplicarMigraciones(aparte.base.dueno, carpeta);
      await writeFile(join(carpeta, "0001_uno.sql"), "create table uno (id int, extra int);");
      await expect(aplicarMigraciones(aparte.base.dueno, carpeta)).rejects.toThrow(
        ErrorDeMigracion,
      );
      await expect(aplicarMigraciones(aparte.base.dueno, carpeta)).rejects.toThrow(
        /ya se aplicó y fue editada/,
      );
    } finally {
      await rm(carpeta, { recursive: true, force: true });
      await aparte.destruir();
    }
  });

  it("una migración que falla se revierte entera y no queda registrada; las anteriores sí", async () => {
    if (base === null) return;
    const aparte = await crearBaseAparte(base, { migrar: false });
    const carpeta = await carpetaTemporal({
      "0001_ok.sql": "create table ok_1 (id int);",
      "0002_rota.sql": "create table rota_1 (id int); select 1/0;",
    });
    const cliente = new pg.Client({ connectionString: aparte.base.dueno });
    await cliente.connect();
    try {
      await expect(aplicarMigraciones(aparte.base.dueno, carpeta)).rejects.toMatchObject({
        code: "22012",
      });
      const tablas = await cliente.query<{ table_name: string }>(
        "select table_name from information_schema.tables where table_schema = 'public' order by 1",
      );
      expect(tablas.rows.map((t) => t.table_name)).toEqual(["migracion", "ok_1"]);
      const registro = await cliente.query<{ nombre: string }>("select nombre from migracion");
      expect(registro.rows.map((r) => r.nombre)).toEqual(["0001_ok.sql"]);
    } finally {
      await cliente.end();
      await rm(carpeta, { recursive: true, force: true });
      await aparte.destruir();
    }
  });

  it("dos migraciones con el mismo número se rechazan antes de tocar la base", async () => {
    if (base === null) return;
    const carpeta = await carpetaTemporal({ "0001_a.sql": "select 1;", "0001_b.sql": "select 2;" });
    try {
      await expect(aplicarMigraciones(base.dueno, carpeta)).rejects.toThrow(/mismo número/);
    } finally {
      await rm(carpeta, { recursive: true, force: true });
    }
  });

  it("dos ejecuciones simultáneas no se pisan: se aplica una sola vez", async () => {
    if (base === null) return;
    const aparte = await crearBaseAparte(base, { migrar: false });
    try {
      const [x, y] = await Promise.all([
        aplicarMigraciones(aparte.base.dueno, CARPETA_REAL),
        aplicarMigraciones(aparte.base.dueno, CARPETA_REAL),
      ]);
      // Cada migración se aplica una sola vez: entre las dos ejecuciones suman exactamente las dos.
      expect([...x.aplicadas, ...y.aplicadas].sort()).toEqual([
        "0001_base.sql",
        "0002_identidad.sql",
      ]);
    } finally {
      await aparte.destruir();
    }
  });

  it("rechaza una cadena de conexión con pooler, sin conectarse", async () => {
    const carpeta = await carpetaTemporal({ "0001_uno.sql": "select 1;" });
    try {
      const error: unknown = await aplicarMigraciones(
        "postgres://usuario@ep-ejemplo-pooler.sa-east-1.aws.neon.tech/base",
        carpeta,
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ErrorDeMigracion);
      expect((error as Error).message).toMatch(/pooler/);
      // El mensaje no filtra la cadena de conexión.
      expect((error as Error).message).not.toMatch(/usuario|neon\.tech/);
    } finally {
      await rm(carpeta, { recursive: true, force: true });
    }
  });

  it("rechaza una migración con control de transacción propio, antes de tocar la base", async () => {
    if (base === null) return;
    const aparte = await crearBaseAparte(base, { migrar: false });
    const carpeta = await carpetaTemporal({
      "0001_ok.sql": "create table ok_1 (id int);",
      "0002_con_commit.sql": "create table t2 (id int);\nCOMMIT;\ncreate table t3 (id int);",
    });
    const cliente = new pg.Client({ connectionString: aparte.base.dueno });
    await cliente.connect();
    try {
      await expect(aplicarMigraciones(aparte.base.dueno, carpeta)).rejects.toThrow(
        ErrorDeMigracion,
      );
      await expect(aplicarMigraciones(aparte.base.dueno, carpeta)).rejects.toThrow(
        /0002_con_commit\.sql.*COMMIT/,
      );
      // Ni siquiera la 0001, que estaba bien, se aplicó: se valida todo antes de conectarse.
      const { rows } = await cliente.query<{ n: number }>(
        "select count(*)::int as n from information_schema.tables where table_schema = 'public'",
      );
      expect(rows[0]?.n).toBe(0);
    } finally {
      await cliente.end();
      await rm(carpeta, { recursive: true, force: true });
      await aparte.destruir();
    }
  });

  it.each([
    ["BEGIN;", "BEGIN"],
    ["  begin work;", "BEGIN"],
    ["START TRANSACTION ISOLATION LEVEL SERIALIZABLE;", "START TRANSACTION"],
    ["select 1;\nROLLBACK;", "ROLLBACK"],
    ["select 1;\nEND;", "END"],
    ["select 1; abort", "ABORT"],
    ["select 1;\n  commit\n;", "COMMIT"],
  ])("detecta el control de transacción %j", async (contenido, control) => {
    const carpeta = await carpetaTemporal({ "0001_x.sql": contenido });
    try {
      await expect(aplicarMigraciones("postgres://usuario@localhost:1/x", carpeta)).rejects.toThrow(
        new RegExp(`propio ${control}`),
      );
    } finally {
      await rm(carpeta, { recursive: true, force: true });
    }
  });

  it("no confunde con control de transacción lo que está en comentarios, textos, funciones o savepoints", async () => {
    if (base === null) return;
    const aparte = await crearBaseAparte(base, { migrar: false });
    const carpeta = await carpetaTemporal({
      "0001_inocente.sql": [
        "-- una nota; COMMIT; y listo",
        "/* otra nota; ROLLBACK; /* anidada; */ END; */",
        "create table t (id int, nota text default 'x; COMMIT; y');",
        "create function f() returns int language plpgsql as $cuerpo$",
        "begin",
        "  return 1;",
        "end;",
        "$cuerpo$;",
        "do $$ begin perform 1; end $$;",
        "savepoint uno;",
        "rollback to savepoint uno;",
        "select case when true then 1 else 2 end;",
      ].join("\n"),
    });
    try {
      const r = await aplicarMigraciones(aparte.base.dueno, carpeta);
      expect(r.aplicadas).toEqual(["0001_inocente.sql"]);
    } finally {
      await rm(carpeta, { recursive: true, force: true });
      await aparte.destruir();
    }
  });

  it("el fin de línea CRLF no cuenta como edición: mismo contenido, mismo checksum", async () => {
    if (base === null) return;
    const aparte = await crearBaseAparte(base, { migrar: false });
    const carpeta = await carpetaTemporal({
      "0001_uno.sql": "create table uno (id int);\n-- fin\ncreate table dos (id int);\n",
    });
    try {
      await aplicarMigraciones(aparte.base.dueno, carpeta);
      await writeFile(
        join(carpeta, "0001_uno.sql"),
        "create table uno (id int);\r\n-- fin\r\ncreate table dos (id int);\r\n",
      );
      expect(await aplicarMigraciones(aparte.base.dueno, carpeta)).toEqual({
        aplicadas: [],
        yaAplicadas: ["0001_uno.sql"],
      });
      // Y al revés: una migración aplicada con CRLF tampoco rompe al volver a LF.
      await writeFile(
        join(carpeta, "0001_uno.sql"),
        "create table uno (id int);\n-- fin\n-- otro\n",
      );
      await expect(aplicarMigraciones(aparte.base.dueno, carpeta)).rejects.toThrow(
        /ya se aplicó y fue editada/,
      );
    } finally {
      await rm(carpeta, { recursive: true, force: true });
      await aparte.destruir();
    }
  });

  it("una migración registrada cuyo archivo ya no existe rompe con un error claro", async () => {
    if (base === null) return;
    const aparte = await crearBaseAparte(base, { migrar: false });
    const carpeta = await carpetaTemporal({
      "0001_uno.sql": "create table uno (id int);",
      "0002_dos.sql": "create table dos (id int);",
    });
    try {
      await aplicarMigraciones(aparte.base.dueno, carpeta);
      await rm(join(carpeta, "0002_dos.sql"));
      const error: unknown = await aplicarMigraciones(aparte.base.dueno, carpeta).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(ErrorDeMigracion);
      expect((error as Error).message).toMatch(/archivo ya no existe: 0002_dos\.sql/);
    } finally {
      await rm(carpeta, { recursive: true, force: true });
      await aparte.destruir();
    }
  });

  it("fija lock_timeout de 10 s y statement_timeout de 5 min en la sesión de migración", async () => {
    if (base === null) return;
    const aparte = await crearBaseAparte(base, { migrar: false });
    const carpeta = await carpetaTemporal({
      "0001_tiempos.sql": [
        "do $$ begin",
        "  if current_setting('lock_timeout') <> '10s' then",
        "    raise exception 'lock_timeout inesperado: %', current_setting('lock_timeout');",
        "  end if;",
        "  if current_setting('statement_timeout') <> '5min' then",
        "    raise exception 'statement_timeout inesperado: %', current_setting('statement_timeout');",
        "  end if;",
        "end $$;",
      ].join("\n"),
    });
    try {
      expect((await aplicarMigraciones(aparte.base.dueno, carpeta)).aplicadas).toEqual([
        "0001_tiempos.sql",
      ]);
    } finally {
      await rm(carpeta, { recursive: true, force: true });
      await aparte.destruir();
    }
  });

  it("una migración que necesita un bloqueo ajeno falla por lock_timeout en vez de hacer cola", async () => {
    if (base === null) return;
    const aparte = await crearBaseAparte(base, { migrar: false });
    const carpeta = await carpetaTemporal({ "0001_tabla.sql": "create table bloqueada (id int);" });
    const otraSesion = new pg.Client({ connectionString: aparte.base.dueno });
    try {
      await aplicarMigraciones(aparte.base.dueno, carpeta);
      await writeFile(
        join(carpeta, "0002_alter.sql"),
        "alter table bloqueada add column extra int;",
      );
      await otraSesion.connect();
      await otraSesion.query("BEGIN");
      await otraSesion.query("LOCK TABLE bloqueada IN ACCESS EXCLUSIVE MODE");
      const inicio = Date.now();
      await expect(
        aplicarMigraciones(aparte.base.dueno, carpeta, { esperaDeBloqueoEnMs: 300 }),
      ).rejects.toMatchObject({ code: "55P03" });
      expect(Date.now() - inicio).toBeLessThan(5000);
      await otraSesion.query("ROLLBACK");
      // Sin el bloqueo ajeno, la misma migración se aplica (no quedó registrada a medias).
      expect((await aplicarMigraciones(aparte.base.dueno, carpeta)).aplicadas).toEqual([
        "0002_alter.sql",
      ]);
    } finally {
      await otraSesion.end();
      await rm(carpeta, { recursive: true, force: true });
      await aparte.destruir();
    }
  });

  it("una sentencia que dura más que el máximo se corta por statement_timeout", async () => {
    if (base === null) return;
    const aparte = await crearBaseAparte(base, { migrar: false });
    const carpeta = await carpetaTemporal({ "0001_lenta.sql": "select pg_sleep(10);" });
    try {
      const inicio = Date.now();
      await expect(
        aplicarMigraciones(aparte.base.dueno, carpeta, { duracionMaximaEnMs: 200 }),
      ).rejects.toMatchObject({ code: "57014" });
      expect(Date.now() - inicio).toBeLessThan(5000);
    } finally {
      await rm(carpeta, { recursive: true, force: true });
      await aparte.destruir();
    }
  });

  it("los tiempos máximos deben ser enteros positivos", async () => {
    const carpeta = await carpetaTemporal({ "0001_uno.sql": "select 1;" });
    try {
      await expect(
        aplicarMigraciones("postgres://usuario@localhost:1/x", carpeta, { esperaDeBloqueoEnMs: 0 }),
      ).rejects.toBeInstanceOf(RangeError);
      await expect(
        aplicarMigraciones("postgres://usuario@localhost:1/x", carpeta, {
          duracionMaximaEnMs: Number.NaN,
        }),
      ).rejects.toBeInstanceOf(RangeError);
    } finally {
      await rm(carpeta, { recursive: true, force: true });
    }
  });

  it.each(["0001_base.sql", "0002_identidad.sql"])(
    "la migración %s no contiene contraseñas ni cadenas de conexión",
    async (archivo) => {
      const sql = await readFile(join(CARPETA_REAL, archivo), "utf8");
      expect(sql).not.toMatch(/PASSWORD\s+'/i);
      expect(sql).not.toMatch(/postgres(ql)?:\/\//i);
    },
  );

  it("0002 es compatible hacia atrás: no borra ni reescribe nada, y no agrega ninguna función SECURITY DEFINER", async () => {
    const sql = await readFile(join(CARPETA_REAL, "0002_identidad.sql"), "utf8");
    // Sin comentarios: lo que se ejecuta de verdad.
    const codigo = sql.replace(/--.*$/gm, "");
    expect(codigo).not.toMatch(/\b(DROP|TRUNCATE|DELETE\s+FROM)\b/i);
    expect(codigo).not.toMatch(/\bALTER\s+TABLE\s+\w+\s+(DROP|RENAME|ALTER\s+COLUMN)\b/i);
    expect(codigo).not.toMatch(/SECURITY\s+DEFINER/i);
    expect(codigo).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?ROLE|ALTER\s+ROLE/i);
  });
});
