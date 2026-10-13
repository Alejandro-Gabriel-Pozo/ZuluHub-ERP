import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
      expect(primera.aplicadas).toEqual([
        "0001_base.sql",
        "0002_identidad.sql",
        "0003_trabajos.sql",
        "0004_plataforma.sql",
        "0005_administracion.sql",
        "0006_fiscal.sql",
        "0007_marcas_y_planes.sql",
        "0008_captacion.sql",
        "0009_facturacion.sql",
      ]);
      const segunda = await aplicarMigraciones(aparte.base.dueno, CARPETA_REAL);
      expect(segunda).toEqual({
        aplicadas: [],
        yaAplicadas: [
          "0001_base.sql",
          "0002_identidad.sql",
          "0003_trabajos.sql",
          "0004_plataforma.sql",
          "0005_administracion.sql",
          "0006_fiscal.sql",
          "0007_marcas_y_planes.sql",
          "0008_captacion.sql",
          "0009_facturacion.sql",
        ],
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
        "zuluhub_autenticacion",
        "zuluhub_captacion",
        "zuluhub_grupo",
        "zuluhub_plataforma",
        "zuluhub_publico",
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
        "0003_trabajos.sql",
        "0004_plataforma.sql",
        "0005_administracion.sql",
        "0006_fiscal.sql",
        "0007_marcas_y_planes.sql",
        "0008_captacion.sql",
        "0009_facturacion.sql",
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

  it.each([
    "0001_base.sql",
    "0002_identidad.sql",
    "0003_trabajos.sql",
    "0004_plataforma.sql",
    "0005_administracion.sql",
    "0006_fiscal.sql",
    "0007_marcas_y_planes.sql",
    "0008_captacion.sql",
    "0009_facturacion.sql",
  ])("la migración %s no contiene contraseñas ni cadenas de conexión", async (archivo) => {
    const sql = await readFile(join(CARPETA_REAL, archivo), "utf8");
    expect(sql).not.toMatch(/PASSWORD\s+'/i);
    expect(sql).not.toMatch(/postgres(ql)?:\/\//i);
  });

  it("0002 es compatible hacia atrás: no borra ni reescribe nada, y no agrega ninguna función SECURITY DEFINER", async () => {
    const sql = await readFile(join(CARPETA_REAL, "0002_identidad.sql"), "utf8");
    // Sin comentarios: lo que se ejecuta de verdad.
    const codigo = sql.replace(/--.*$/gm, "");
    expect(codigo).not.toMatch(/\b(DROP|TRUNCATE|DELETE\s+FROM)\b/i);
    expect(codigo).not.toMatch(/\bALTER\s+TABLE\s+\w+\s+(DROP|RENAME|ALTER\s+COLUMN)\b/i);
    expect(codigo).not.toMatch(/SECURITY\s+DEFINER/i);
    expect(codigo).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?ROLE|ALTER\s+ROLE/i);
  });

  it("0004 es aditiva: no borra ni reescribe nada, no agrega SECURITY DEFINER, restringe a la plataforma solo con políticas RESTRICTIVE y su único rol nuevo nace NOLOGIN", async () => {
    const sql = await readFile(join(CARPETA_REAL, "0004_plataforma.sql"), "utf8");
    const codigo = sql.replace(/--.*$/gm, "");
    // El disparador "BEFORE TRUNCATE" frena el TRUNCATE: no es uno.
    const sinDisparadoresDeTruncate = codigo.replace(/BEFORE\s+TRUNCATE/gi, "");
    expect(sinDisparadoresDeTruncate).not.toMatch(/\b(DROP|TRUNCATE|DELETE\s+FROM)\b/i);
    expect(codigo).not.toMatch(/\bALTER\s+TABLE\s+\w+\s+(DROP|RENAME|ALTER\s+COLUMN|ADD)\b/i);
    expect(codigo).not.toMatch(/\b(ALTER|DROP)\s+POLICY\b/i);
    expect(codigo).not.toMatch(/SECURITY\s+DEFINER/i);
    // Nadie recibe DELETE, TRUNCATE ni permisos sobre lo que no corresponde.
    for (const concesion of codigo.match(/\bGRANT\b[^;]*;/gi) ?? []) {
      expect(concesion).not.toMatch(/\b(DELETE|TRUNCATE|ALL)\b/i);
    }
    // Roles: se crea uno solo, sin LOGIN (ni contraseña), y no se toca ninguno de los existentes.
    expect(codigo.match(/CREATE\s+ROLE/gi)).toHaveLength(1);
    expect(codigo).toMatch(/CREATE ROLE %I NOLOGIN NOSUPERUSER NOBYPASSRLS/);
    expect(codigo).not.toMatch(/(?<!NO)LOGIN/);
    expect(codigo).not.toMatch(/PASSWORD/i);
    // Toda política sobre una tabla de 0001 o 0002 es RESTRICTIVE (se suma con AND y solo puede quitar),
    // salvo la lectura de las 4 columnas de membresia que da el GRANT por columna.
    const nuevas = ["admin_plataforma", "idempotencia_plataforma", "referencia_de_error"];
    const politicas = [
      ...codigo.matchAll(/CREATE\s+POLICY\s+(\w+)\s+ON\s+(\w+)\s+(AS\s+RESTRICTIVE\s+)?/gi),
    ];
    expect(politicas.length).toBeGreaterThan(30);
    for (const [, nombre, tabla, restrictiva] of politicas) {
      if (nuevas.includes(tabla as string)) continue;
      if (nombre === "membresia_plataforma_leer") continue;
      // Las que no son del rol de plataforma son de la referencia de error (tabla nueva).
      expect(restrictiva, `${nombre} sobre ${tabla} tiene que ser RESTRICTIVE`).toBeTruthy();
    }
    // Las restrictivas apuntan solo al rol de plataforma: no cambian nada para los demás.
    for (const restrictiva of codigo.match(/AS\s+RESTRICTIVE[^;]*;/gi) ?? []) {
      expect(restrictiva).toMatch(/TO\s+zuluhub_plataforma\b/);
      expect(restrictiva).not.toMatch(/zuluhub_(app|grupo|trabajos|autenticacion)/);
    }
    // No referencia nada de 0003 (ni de migraciones posteriores).
    expect(codigo).not.toMatch(/trabajo_validar_cambio|trabajo_ultimo_error_ck|trabajo_cambio/);
    // Toda tabla nueva activa y fuerza RLS.
    for (const tabla of nuevas) {
      expect(codigo).toMatch(new RegExp(`ALTER TABLE ${tabla} ENABLE ROW LEVEL SECURITY`));
      expect(codigo).toMatch(new RegExp(`ALTER TABLE ${tabla} FORCE ROW LEVEL SECURITY`));
    }
  });

  it("0005 es aditiva: no borra ni reescribe nada, no agrega SECURITY DEFINER ni roles, nadie recibe DELETE y toda función fija su search_path", async () => {
    const sql = await readFile(join(CARPETA_REAL, "0005_administracion.sql"), "utf8");
    const codigo = sql.replace(/--.*$/gm, "");
    expect(codigo).not.toMatch(/\b(DROP|TRUNCATE|DELETE\s+FROM)\b/i);
    expect(codigo).not.toMatch(/\bALTER\s+TABLE\s+\w+\s+(DROP|RENAME|ALTER\s+COLUMN)\b/i);
    expect(codigo).not.toMatch(/\b(ALTER|DROP)\s+POLICY\b/i);
    expect(codigo).not.toMatch(/SECURITY\s+DEFINER/i);
    // Ninguna concesión de DELETE, TRUNCATE ni ALL, y ninguna función se otorga (las de disparador no).
    for (const concesion of codigo.match(/\bGRANT\b[^;]*;/gi) ?? []) {
      expect(concesion).not.toMatch(/\b(DELETE|TRUNCATE|ALL|EXECUTE)\b/i);
    }
    // Roles: no crea ni toca ninguno, y no hay LOGIN ni contraseñas.
    expect(codigo).not.toMatch(
      /CREATE\s+(OR\s+REPLACE\s+)?ROLE|ALTER\s+ROLE|(?<!NO)LOGIN|PASSWORD/i,
    );
    // Solo agrega: las tablas viejas únicamente reciben restricciones (ADD CONSTRAINT), nada más.
    for (const alter of codigo.match(/\bALTER\s+TABLE\s+\w+\s+\w+(\s+\w+)?/gi) ?? []) {
      expect(alter).toMatch(/ALTER\s+TABLE\s+(\w+\s+(ADD\s+CONSTRAINT|ENABLE\s+ROW|FORCE\s+ROW))/i);
    }
    // Toda función nueva fija el search_path (con pg_temp al final) y califica con `public.`.
    const funciones = codigo.match(/CREATE\s+FUNCTION[\s\S]*?\$\$;/gi) ?? [];
    expect(funciones).toHaveLength(6);
    for (const funcion of funciones) {
      expect(funcion).toMatch(/SET\s+search_path\s*=\s*pg_catalog,\s*public,\s*pg_temp/);
      expect(funcion).not.toMatch(/(?<!DISTINCT\s)\b(FROM|JOIN)\s+(?!public\.)(?!pg_)\w+/);
    }
    // Toda tabla nueva activa y fuerza RLS.
    for (const tabla of codigo.match(/CREATE\s+TABLE\s+(\w+)/gi) ?? []) {
      const nombre = tabla.split(/\s+/)[2] as string;
      expect(codigo).toMatch(new RegExp(`ALTER TABLE ${nombre} ENABLE ROW LEVEL SECURITY`));
      expect(codigo).toMatch(new RegExp(`ALTER TABLE ${nombre} FORCE ROW LEVEL SECURITY`));
    }
    // Las políticas de las tablas de 0001 y 0002 que agrega son solo de la aplicación (membresía y
    // asignación); las de la plataforma sobre la tabla nueva incluyen sus restrictivas del actor.
    const politicas = [
      ...codigo.matchAll(
        /CREATE\s+POLICY\s+(\w+)\s+ON\s+(\w+)\s+(AS\s+RESTRICTIVE\s+)?FOR\s+(\w+)\s+TO\s+(\w+)/gi,
      ),
    ];
    expect(politicas.length).toBe(13);
    for (const [, nombre, tabla, , , rol] of politicas) {
      if (tabla === "traspaso_gerencia") continue;
      expect(rol, `${nombre} sobre ${tabla}`).toBe("zuluhub_app");
    }
    // Las restrictivas son solo de la plataforma.
    for (const restrictiva of codigo.match(/AS\s+RESTRICTIVE[^;]*;/gi) ?? []) {
      expect(restrictiva).toMatch(/TO\s+zuluhub_plataforma\b/);
      expect(restrictiva).not.toMatch(/zuluhub_(app|grupo|trabajos|autenticacion)/);
    }
    // Depende de 0004 (lo dice) y no referencia nada de 0003 ni de las migraciones siguientes.
    expect(sql).toMatch(/necesita 0004_plataforma/);
    expect(codigo).not.toMatch(/trabajo_validar_cambio|trabajo_ultimo_error_ck|trabajo_cambio/);
  });

  it("0006 es aditiva: no borra ni reescribe nada, no agrega SECURITY DEFINER ni roles, nadie recibe DELETE, toda función fija su search_path y no crea las tablas de la facturación", async () => {
    const sql = await readFile(join(CARPETA_REAL, "0006_fiscal.sql"), "utf8");
    const codigo = sql.replace(/--.*$/gm, "");
    // El disparador "BEFORE TRUNCATE" frena el TRUNCATE: no es uno.
    const sinDisparadoresDeTruncate = codigo.replace(/BEFORE\s+TRUNCATE/gi, "");
    expect(sinDisparadoresDeTruncate).not.toMatch(/\b(DROP|TRUNCATE|DELETE\s+FROM)\b/i);
    // Las tablas viejas no se alteran: ni siquiera se les agrega una restricción (0006 solo suma
    // disparadores sobre `empresa`). Lo único que se altera son las tablas nuevas, para activar RLS.
    const tablasNuevas = (codigo.match(/CREATE\s+TABLE\s+\w+/gi) ?? []).map(
      (t) => t.split(/\s+/)[2] as string,
    );
    expect(tablasNuevas.sort()).toEqual([
      "datos_fiscales",
      "domicilio",
      "emisor",
      "provincia",
      "punto_de_venta",
      "regla_emisor",
      "serie_comprobante",
    ]);
    for (const alter of codigo.match(/\bALTER\s+TABLE\s+\w+\s+\w+(\s+\w+)?/gi) ?? []) {
      expect(alter).toMatch(/ALTER\s+TABLE\s+(\w+)\s+(ENABLE\s+ROW|FORCE\s+ROW)/i);
      expect(tablasNuevas).toContain(alter.split(/\s+/)[2] as string);
    }
    expect(codigo).not.toMatch(/\b(ALTER|DROP)\s+POLICY\b/i);
    expect(codigo).not.toMatch(/SECURITY\s+DEFINER/i);
    for (const concesion of codigo.match(/\bGRANT\b[^;]*;/gi) ?? []) {
      expect(concesion).not.toMatch(/\b(DELETE|TRUNCATE|ALL|EXECUTE)\b/i);
    }
    expect(codigo).not.toMatch(
      /CREATE\s+(OR\s+REPLACE\s+)?ROLE|ALTER\s+ROLE|(?<!NO)LOGIN|PASSWORD/i,
    );
    // Toda función nueva fija el search_path (con pg_temp al final) y califica con `public.`.
    const funciones = codigo.match(/CREATE\s+FUNCTION[\s\S]*?\$\$;/gi) ?? [];
    expect(funciones).toHaveLength(9);
    for (const funcion of funciones) {
      expect(funcion).toMatch(/SET\s+search_path\s*=\s*pg_catalog,\s*public,\s*pg_temp/);
      expect(funcion).not.toMatch(/(?<!DISTINCT\s)\b(FROM|JOIN)\s+(?!public\.)(?!pg_)\w+/);
    }
    // Toda tabla nueva activa y fuerza RLS.
    for (const nombre of tablasNuevas) {
      expect(codigo).toMatch(new RegExp(`ALTER TABLE ${nombre} ENABLE ROW LEVEL SECURITY`));
      expect(codigo).toMatch(new RegExp(`ALTER TABLE ${nombre} FORCE ROW LEVEL SECURITY`));
    }
    // Las restrictivas son solo de la plataforma.
    for (const restrictiva of codigo.match(/AS\s+RESTRICTIVE[^;]*;/gi) ?? []) {
      expect(restrictiva).toMatch(/TO\s+zuluhub_plataforma\b/);
      expect(restrictiva).not.toMatch(/zuluhub_(app|grupo|trabajos|autenticacion)/);
    }
    // Ninguna política `FOR ALL`: cada comando tiene la suya.
    expect(codigo).not.toMatch(/CREATE\s+POLICY[^;]*\bFOR\s+ALL\b/i);
    // Depende de 0004 (lo dice) y no referencia nada de 0003 ni de 0005.
    expect(sql).toMatch(/necesita 0004_plataforma/);
    expect(codigo).not.toMatch(/trabajo_validar_cambio|trabajo_ultimo_error_ck|trabajo_cambio/);
    expect(codigo).not.toMatch(/traspaso_gerencia|sucursal_nombre_ci|membresia_validar_cambio/);
    // El relleno es lo único que escribe datos: una inserción del emisor principal de cada empresa.
    const inserciones = [...codigo.matchAll(/INSERT\s+INTO\s+(?:public\.)?(\w+)/gi)].map((i) =>
      (i[1] as string).toLowerCase(),
    );
    // `provincia` (el catálogo sembrado), el relleno y el disparador de las empresas nuevas.
    expect(inserciones.sort()).toEqual(["emisor", "emisor", "provincia"]);
    expect(codigo).not.toMatch(/\bUPDATE\s+(?!OF\b)\w+\s+SET\b/i);
  });

  it("la reversión de 0006 vive fuera de la carpeta que aplica el ejecutor, así que nunca se corre sola", async () => {
    const aplicables = (await readdir(CARPETA_REAL)).filter((n) =>
      /^\d{4}_[a-z0-9_]+\.sql$/.test(n),
    );
    expect(aplicables).not.toContain("0006_revertir_fiscal.sql");
    expect(aplicables.filter((n) => n.startsWith("0006"))).toEqual(["0006_fiscal.sql"]);
    const reversion = await readFile(
      join(CARPETA_REAL, "reversiones", "0006_revertir_fiscal.sql"),
      "utf8",
    );
    expect(reversion).toMatch(/DESTRUCTIVA/);
    expect(reversion).not.toMatch(/PASSWORD\s+'/i);
    expect(reversion.replace(/--.*$/gm, "")).not.toMatch(/\bCASCADE\b/i);
  });

  it("0007 es aditiva: no borra ni reescribe datos, no agrega SECURITY DEFINER, crea solo el rol público (NOLOGIN), nadie recibe DELETE, toda función fija su search_path y exige 0004", async () => {
    const sql = await readFile(join(CARPETA_REAL, "0007_marcas_y_planes.sql"), "utf8");
    const codigo = sql.replace(/--.*$/gm, "");
    // El disparador "BEFORE TRUNCATE" frena el TRUNCATE (no es uno) y `DROP DEFAULT` es el único DROP: quita
    // el valor por defecto con que se rellenó `tenant.marca_id`, no borra nada.
    const sinPermitidos = codigo
      .replace(/BEFORE\s+TRUNCATE/gi, "")
      .replace(/ALTER\s+COLUMN\s+marca_id\s+DROP\s+DEFAULT/gi, "");
    expect(sinPermitidos).not.toMatch(/\b(DROP|TRUNCATE|DELETE\s+FROM)\b/i);
    expect(codigo.match(/DROP\s+DEFAULT/gi)).toHaveLength(1);
    // Tablas nuevas: las nueve, y nada más.
    const tablasNuevas = (codigo.match(/CREATE\s+TABLE\s+\w+/gi) ?? []).map(
      (t) => t.split(/\s+/)[2] as string,
    );
    expect(tablasNuevas.sort()).toEqual([
      "ajuste_de_perilla",
      "dominio",
      "marca",
      "modulo_de_empresa",
      "nivel_de_control",
      "plan",
      "plan_de_tenant",
      "version_de_marca",
      "version_de_plan",
    ]);
    // Las tablas viejas solo reciben lo declarado: dos columnas con valor por defecto, una única, y la
    // columna de la marca del tenant (dentro de un bloque DO). Lo demás que se altera es RLS de las nuevas.
    const alteraciones = (
      codigo.match(/\bALTER\s+TABLE\s+(?:public\.)?\w+\s+\w+(\s+\w+)?/gi) ?? []
    ).filter((a) => !/ENABLE\s+ROW|FORCE\s+ROW/i.test(a));
    expect(alteraciones.map((a) => a.replace(/\s+/g, " ")).sort()).toEqual([
      "ALTER TABLE auditoria_acceso_grupo ADD COLUMN",
      "ALTER TABLE public.tenant ADD COLUMN",
      "ALTER TABLE public.tenant ALTER COLUMN",
      "ALTER TABLE referencia_de_error ADD CONSTRAINT",
      "ALTER TABLE sucursal ADD COLUMN",
    ]);
    for (const nombre of tablasNuevas) {
      expect(codigo).toMatch(new RegExp(`ALTER TABLE ${nombre} ENABLE ROW LEVEL SECURITY`));
      expect(codigo).toMatch(new RegExp(`ALTER TABLE ${nombre} FORCE ROW LEVEL SECURITY`));
    }
    // La única política que se cambia es la de alta del acceso de grupo (intentos fallidos).
    expect(codigo.match(/\bALTER\s+POLICY\s+\w+/gi)).toEqual([
      "ALTER POLICY auditoria_acceso_grupo_alta",
    ]);
    expect(codigo).not.toMatch(/\bDROP\s+POLICY\b/i);
    expect(codigo).not.toMatch(/SECURITY\s+DEFINER/i);
    for (const concesion of codigo.match(/\bGRANT\b[^;]*;/gi) ?? []) {
      expect(concesion).not.toMatch(/\b(DELETE|TRUNCATE|ALL)\b/i);
      // EXECUTE: solo las funciones de validación y solo para la plataforma.
      if (/\bEXECUTE\b/i.test(concesion)) expect(concesion).toMatch(/TO\s+zuluhub_plataforma;$/);
    }
    // El único rol que crea es el público, sin login ni contraseña.
    expect(codigo.match(/CREATE\s+ROLE/gi)).toHaveLength(1);
    expect(codigo).toMatch(/'CREATE ROLE %I NOLOGIN NOSUPERUSER NOBYPASSRLS/);
    expect(codigo).not.toMatch(/(?<!NO)LOGIN|PASSWORD/i);
    // Toda función nueva fija el search_path (con pg_temp al final) y califica sus tablas con `public.`
    // (las funciones de conjunto de Postgres, como jsonb_each y unnest, no son tablas).
    const funciones = codigo.match(/CREATE\s+FUNCTION[\s\S]*?\$\$;/gi) ?? [];
    expect(funciones).toHaveLength(20);
    for (const funcion of funciones) {
      expect(funcion).toMatch(/SET\s+search_path\s*=\s*pg_catalog,\s*public,\s*pg_temp/);
      expect(funcion).not.toMatch(
        /(?<!DISTINCT\s)\b(FROM|JOIN)\s+(?!public\.)(?!pg_)\w+\b(?!\s*\()/,
      );
    }
    // Las restrictivas son solo de la plataforma. Ninguna política `FOR ALL`.
    for (const restrictiva of codigo.match(/AS\s+RESTRICTIVE[^;]*;/gi) ?? []) {
      expect(restrictiva).toMatch(/TO\s+zuluhub_plataforma\b/);
      expect(restrictiva).not.toMatch(/zuluhub_(app|grupo|trabajos|autenticacion|publico)/);
    }
    expect(codigo).not.toMatch(/CREATE\s+POLICY[^;]*\bFOR\s+ALL\b/i);
    // El rol público solo lee: ningún INSERT, UPDATE ni EXECUTE para él (salvo USAGE del esquema).
    for (const concesion of codigo.match(/\bGRANT\b[^;]*;/gi) ?? []) {
      if (/zuluhub_publico/.test(concesion)) {
        // Columnas públicas de las tablas, el esquema y la vista de resolución del host (nada más).
        expect(concesion).toMatch(
          /^GRANT\s+(SELECT\s*\(|USAGE\s+ON\s+SCHEMA|SELECT\s+ON\s+resolucion_de_host\s+TO\s+zuluhub_publico\s*;$)/i,
        );
      }
    }
    // Depende de 0004 (lo comprueba al empezar) y no toca nada de 0005 ni de 0006.
    expect(sql).toMatch(/requiere 0004_plataforma/);
    expect(codigo).not.toMatch(/traspaso_gerencia|sucursal_nombre_ci|emisor|punto_de_venta/);
    // Escribe datos en una sola tabla: inserta la marca principal. Ningún UPDATE ni DELETE de filas.
    const inserciones = [...codigo.matchAll(/INSERT\s+INTO\s+(?:public\.)?(\w+)/gi)].map((i) =>
      (i[1] as string).toLowerCase(),
    );
    expect(inserciones).toEqual(["marca"]);
    expect(codigo).not.toMatch(/\bUPDATE\s+(?!OF\b)(?!ON\b)\w+\s+SET\b/i);
  });

  it("la reversión de 0007 vive fuera de la carpeta que aplica el ejecutor, así que nunca se corre sola", async () => {
    const aplicables = (await readdir(CARPETA_REAL)).filter((n) =>
      /^\d{4}_[a-z0-9_]+\.sql$/.test(n),
    );
    expect(aplicables).not.toContain("0007_revertir_marcas_y_planes.sql");
    expect(aplicables.filter((n) => n.startsWith("0007"))).toEqual(["0007_marcas_y_planes.sql"]);
    const reversion = await readFile(
      join(CARPETA_REAL, "reversiones", "0007_revertir_marcas_y_planes.sql"),
      "utf8",
    );
    expect(reversion).toMatch(/DESTRUCTIVA/);
    expect(reversion).not.toMatch(/PASSWORD\s+'/i);
    expect(reversion.replace(/--.*$/gm, "")).not.toMatch(/\bCASCADE\b/i);
  });

  it("0003 es compatible hacia atrás, no ensancha privilegios y no agrega SECURITY DEFINER", async () => {
    const sql = await readFile(join(CARPETA_REAL, "0003_trabajos.sql"), "utf8");
    const codigo = sql.replace(/--.*$/gm, "");
    expect(codigo).not.toMatch(/\b(DROP|TRUNCATE|DELETE\s+FROM)\b/i);
    expect(codigo).not.toMatch(/\bALTER\s+TABLE\s+\w+\s+(DROP|RENAME|ALTER\s+COLUMN)\b/i);
    expect(codigo).not.toMatch(/SECURITY\s+DEFINER/i);
    expect(codigo).not.toMatch(
      /\b(GRANT|CREATE\s+POLICY|ALTER\s+POLICY|ALTER\s+DEFAULT\s+PRIVILEGES)\b/i,
    );
    expect(codigo).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?ROLE|ALTER\s+ROLE/i);
  });
});
