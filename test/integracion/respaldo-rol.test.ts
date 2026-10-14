import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { RolPorPreparar } from "../../src/adaptadores/postgres/roles-de-la-aplicacion";
import { ejecutarMigracion, VARIABLE_DE_LA_CADENA } from "../../scripts/ejecutar-migracion";
import { crearBaseAparte } from "./entorno";

/**
 * El rol exclusivo de respaldo y las reglas de aislamiento que lo acompañan (`respaldo-y-recuperacion.md` §C, en el
 * repositorio de documentos). Cada regla es una función que devuelve los problemas que encuentra en una base, y
 * cada una tiene su violación inyectada: se rompe a propósito (dentro de una transacción que después se revierte, o
 * en una base aparte) y la regla tiene que nombrar lo roto.
 *
 *  RS1  Ningún rol tiene BYPASSRLS salvo `zuluhub_respaldo` (y los del proveedor, que ZuluHub no crea).
 *  RS2  TODA tabla de los esquemas de ZuluHub tiene RLS habilitado y forzado, salvo la lista de excepciones.
 *  RS3  El rol de respaldo: sus atributos, sus topes, sin pertenencias, y ningún privilegio que no sea SELECT.
 *  RS4  El rol de respaldo lee todas las tablas y secuencias (también las que se creen después).
 *  RS5  El comando de migración no lo activa sin `--con-respaldo` y nunca lo manda a Vercel.
 *
 * Los roles son del servidor entero: las violaciones sobre roles se hacen DENTRO de una transacción que se revierte
 * (nadie más las ve) o con roles propios de la prueba que se borran al terminar.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const CARPETA_REAL = join(import.meta.dirname, "../../migraciones");
const ROL = "zuluhub_respaldo";
const ESQUEMAS = ["public", "autenticacion"] as const;

/** Roles del proveedor con BYPASSRLS que ZuluHub no crea (ADR-011, A3). NO VERIFICADA la lista completa de Neon. */
const ROLES_DEL_PROVEEDOR = ["neondb_owner", "neon_superuser", "cloud_admin"] as const;

type Excepcion = Readonly<{ rls: boolean; forzado: boolean; motivo: string }>;

/**
 * Las tablas que NO tienen RLS habilitado y forzado, cada una con su motivo. Una tabla nueva sin RLS tiene que
 * sumarse acá con su motivo (y pasar revisión); una excepción que deja de hacer falta tiene que salir.
 */
const EXCEPCIONES_DE_RLS: Readonly<Record<string, Excepcion>> = {
  "public.contexto_clave": {
    rls: true,
    forzado: false,
    motivo:
      "los secretos de firma: RLS sin políticas y sin FORCE para que solo su dueño (contexto_firmado(), SECURITY DEFINER) la lea (0001)",
  },
  "public.migracion": {
    rls: false,
    forzado: false,
    motivo:
      "la tabla de control del ejecutor de migraciones: la crea y la usa solo el dueño; ningún rol de la aplicación tiene privilegios",
  },
};

type Fila = Record<string, unknown>;
const filas = async <T extends Fila>(c: pg.ClientBase, texto: string, p: unknown[] = []) =>
  (await c.query<T>(texto, p)).rows;

/** RS1: los roles con BYPASSRLS que no deberían tenerlo. */
async function problemasDeBypass(c: pg.ClientBase): Promise<string[]> {
  const roles = await filas<{ rolname: string }>(
    c,
    `select r.rolname from pg_roles r
      where r.rolbypassrls and not r.rolsuper and r.rolname <> $1
        and r.rolname not like 'pg\\_%' escape '\\'
        and r.oid <> (select datdba from pg_database where datname = current_database())
        and r.rolname <> all ($2::text[])
      order by 1`,
    [ROL, ROLES_DEL_PROVEEDOR],
  );
  return roles.map((r) => `RS1: el rol ${r.rolname} tiene BYPASSRLS`);
}

/** RS2: las tablas sin RLS habilitado y forzado (salvo las excepciones), y las excepciones que ya no valen. */
async function problemasDeRls(
  c: pg.ClientBase,
  excepciones: Readonly<Record<string, Excepcion>> = EXCEPCIONES_DE_RLS,
): Promise<string[]> {
  const tablas = await filas<{ nombre: string; rls: boolean; forzado: boolean }>(
    c,
    `select n.nspname || '.' || c.relname as nombre, c.relrowsecurity as rls, c.relforcerowsecurity as forzado
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any ($1::text[]) and c.relkind in ('r', 'p')
      order by 1`,
    [ESQUEMAS],
  );
  const problemas: string[] = [];
  const vistas = new Set<string>();
  for (const t of tablas) {
    vistas.add(t.nombre);
    const esperado = excepciones[t.nombre] ?? { rls: true, forzado: true };
    if (t.rls !== esperado.rls || t.forzado !== esperado.forzado) {
      problemas.push(
        `RS2: ${t.nombre} tiene RLS ${t.rls ? "habilitado" : "deshabilitado"} y ${t.forzado ? "forzado" : "sin forzar"}` +
          (t.nombre in excepciones ? " (distinto de su excepción)" : ""),
      );
    }
  }
  for (const nombre of Object.keys(excepciones)) {
    if (!vistas.has(nombre))
      problemas.push(`RS2: la excepción ${nombre} nombra una tabla que no existe`);
  }
  return problemas;
}

/** Los topes que tiene que tener el rol (la migración los pone; `pg_db_role_setting` los guarda como texto). */
const TOPES = [
  "statement_timeout=15min",
  "idle_in_transaction_session_timeout=10min",
  "lock_timeout=30s",
  "default_transaction_read_only=on",
];

/** RS3: los atributos, los topes, las pertenencias y los privilegios del rol (`rol`, por defecto el de respaldo). */
async function problemasDelRol(c: pg.ClientBase, rol: string = ROL): Promise<string[]> {
  const [r] = await filas<{
    rolsuper: boolean;
    rolbypassrls: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolreplication: boolean;
    rolinherit: boolean;
    rolconnlimit: number;
  }>(
    c,
    `select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication, rolinherit, rolconnlimit
       from pg_roles where rolname = $1`,
    [rol],
  );
  if (r === undefined) return [`RS3: el rol ${rol} no existe`];
  const problemas: string[] = [];
  const atributos = { ...r };
  const esperados = {
    rolsuper: false,
    rolbypassrls: true,
    rolcreatedb: false,
    rolcreaterole: false,
    rolreplication: false,
    rolinherit: false,
    rolconnlimit: 2,
  };
  for (const [clave, valor] of Object.entries(esperados)) {
    if (atributos[clave as keyof typeof atributos] !== valor) {
      problemas.push(
        `RS3: ${rol}.${clave} es ${String(atributos[clave as keyof typeof atributos])}`,
      );
    }
  }
  const [topes] = await filas<{ config: string[] | null }>(
    c,
    `select s.setconfig as config from pg_db_role_setting s join pg_roles ro on ro.oid = s.setrole
      where ro.rolname = $1 and s.setdatabase = 0`,
    [rol],
  );
  for (const tope of TOPES) {
    if (!(topes?.config ?? []).includes(tope))
      problemas.push(`RS3: a ${rol} le falta el tope ${tope}`);
  }
  const pertenencias = await filas<{ m: string; g: string }>(
    c,
    `select m.rolname as m, g.rolname as g from pg_auth_members am
       join pg_roles m on m.oid = am.member join pg_roles g on g.oid = am.roleid
      where m.rolname = $1 or g.rolname = $1 order by 1, 2`,
    [rol],
  );
  for (const p of pertenencias) problemas.push(`RS3: ${p.m} es miembro de ${p.g}`);
  const privilegios = await filas<{ objeto: string; privilegio: string }>(
    c,
    `select n.nspname || '.' || c.relname as objeto, a.privilege_type as privilegio
       from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(c.relacl) a
      where a.grantee = (select oid from pg_roles where rolname = $1) and a.privilege_type <> 'SELECT'
     union all
     select n.nspname || '.' || c.relname || '.' || at.attname, a.privilege_type
       from pg_attribute at join pg_class c on c.oid = at.attrelid join pg_namespace n on n.oid = c.relnamespace,
            aclexplode(at.attacl) a
      where a.grantee = (select oid from pg_roles where rolname = $1) and a.privilege_type <> 'SELECT'
     union all
     select n.nspname, a.privilege_type from pg_namespace n, aclexplode(n.nspacl) a
      where a.grantee = (select oid from pg_roles where rolname = $1) and a.privilege_type <> 'USAGE'
     order by 1, 2`,
    [rol],
  );
  for (const p of privilegios) problemas.push(`RS3: ${rol} tiene ${p.privilegio} en ${p.objeto}`);
  const [temporal] = await filas<{ puede: boolean }>(
    c,
    "select has_database_privilege($1, current_database(), 'TEMPORARY') as puede",
    [rol],
  );
  if (temporal?.puede === true) problemas.push(`RS3: ${rol} puede crear objetos temporales`);
  return problemas;
}

/** RS4: las tablas y secuencias de los esquemas de ZuluHub que el rol de respaldo no puede leer. */
async function problemasDeLectura(c: pg.ClientBase): Promise<string[]> {
  const sinLeer = await filas<{ objeto: string }>(
    c,
    `select n.nspname || '.' || c.relname as objeto from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any ($2::text[]) and c.relkind in ('r', 'p', 'S')
        and not has_table_privilege($1, c.oid, 'SELECT')
      order by 1`,
    [ROL, ESQUEMAS],
  );
  return sinLeer.map((s) => `RS4: ${ROL} no puede leer ${s.objeto}`);
}

const todosLosProblemas = async (c: pg.ClientBase) => [
  ...(await problemasDeBypass(c)),
  ...(await problemasDeRls(c)),
  ...(await problemasDelRol(c)),
  ...(await problemasDeLectura(c)),
];

/** Corre `trabajo` dentro de una transacción y la revierte siempre: nadie más ve lo que se rompió. */
async function revertido<T>(c: pg.ClientBase, trabajo: () => Promise<T>): Promise<T> {
  await c.query("BEGIN");
  try {
    return await trabajo();
  } finally {
    await c.query("ROLLBACK");
  }
}

const sufijo = () => randomBytes(4).toString("hex");

describe.skipIf(base === null)("el rol de respaldo y las reglas de aislamiento (RS1-RS5)", () => {
  let aparte: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;

  beforeAll(async () => {
    if (base === null) return;
    aparte = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: aparte.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await aparte.destruir();
  });

  it("una base recién migrada no tiene ningún problema de RS1 a RS4", async () => {
    expect(await todosLosProblemas(dueno)).toEqual([]);
  });

  it("el rol de respaldo nace sin LOGIN (lo activa el dueño con --con-respaldo)", async () => {
    const [r] = await filas<{ login: boolean }>(
      dueno,
      "select rolcanlogin as login from pg_roles where rolname = $1",
      [ROL],
    );
    expect(r?.login).toBe(false);
  });

  it("lee entera una tabla con RLS forzado sin contexto de empresa, y no puede escribir", async () => {
    await revertido(dueno, async () => {
      await dueno.query("insert into tenant (nombre) values ($1), ($2)", [
        `t-${sufijo()}`,
        `t-${sufijo()}`,
      ]);
      await dueno.query("SET LOCAL ROLE zuluhub_respaldo");
      // Sin contexto firmado un rol de la aplicación no ve ninguna fila de `tenant` (RLS forzado); el de respaldo, todas.
      const [n] = await filas<{ n: string }>(dueno, "select count(*) as n from tenant");
      expect(Number(n?.n)).toBeGreaterThanOrEqual(2);
      await expect(dueno.query("insert into tenant (nombre) values ('x')")).rejects.toMatchObject({
        code: "42501",
      });
    });
  });

  // ---------------------------------------------------------------------------------------------
  it("RS1 (violación inyectada): un rol nuevo con BYPASSRLS aparece nombrado", async () => {
    const rol = `rs1_${sufijo()}`;
    const problemas = await revertido(dueno, async () => {
      await dueno.query(`CREATE ROLE ${rol} NOLOGIN BYPASSRLS`);
      return problemasDeBypass(dueno);
    });
    expect(problemas).toEqual([`RS1: el rol ${rol} tiene BYPASSRLS`]);
    expect(await problemasDeBypass(dueno)).toEqual([]);
  });

  it("RS2 (violación inyectada): una tabla sin RLS y otra sin FORCE aparecen nombradas", async () => {
    const problemas = await revertido(dueno, async () => {
      await dueno.query("CREATE TABLE prueba_sin_rls (id int)");
      await dueno.query("CREATE TABLE autenticacion.prueba_sin_forzar (id int)");
      await dueno.query("ALTER TABLE autenticacion.prueba_sin_forzar ENABLE ROW LEVEL SECURITY");
      return problemasDeRls(dueno);
    });
    expect(problemas).toEqual([
      "RS2: autenticacion.prueba_sin_forzar tiene RLS habilitado y sin forzar",
      "RS2: public.prueba_sin_rls tiene RLS deshabilitado y sin forzar",
    ]);
  });

  it("RS2: la lista de excepciones no envejece (una que no existe, o que ya no hace falta, falla)", async () => {
    expect(
      await problemasDeRls(dueno, {
        ...EXCEPCIONES_DE_RLS,
        "public.no_existe": { rls: false, forzado: false, motivo: "prueba" },
        "public.sucursal": { rls: false, forzado: false, motivo: "prueba" },
      }),
    ).toEqual([
      "RS2: public.sucursal tiene RLS habilitado y forzado (distinto de su excepción)",
      "RS2: la excepción public.no_existe nombra una tabla que no existe",
    ]);
  });

  it("RS3 (violación inyectada): un rol con otros atributos, sin topes, con escritura y con pertenencias", async () => {
    const rol = `rs3_${sufijo()}`;
    const otro = `rs3_${sufijo()}`;
    const problemas = await revertido(dueno, async () => {
      await dueno.query(`CREATE ROLE ${rol} NOLOGIN NOBYPASSRLS INHERIT CREATEDB`);
      await dueno.query(`CREATE ROLE ${otro} NOLOGIN`);
      await dueno.query(`GRANT ${otro} TO ${rol}`);
      await dueno.query(`GRANT SELECT, INSERT ON sucursal TO ${rol}`);
      await dueno.query(`GRANT UPDATE (nombre) ON sucursal TO ${rol}`);
      await dueno.query(`GRANT CREATE ON SCHEMA autenticacion TO ${rol}`);
      return problemasDelRol(dueno, rol);
    });
    expect(problemas).toEqual([
      `RS3: ${rol}.rolbypassrls es false`,
      `RS3: ${rol}.rolcreatedb es true`,
      `RS3: ${rol}.rolinherit es true`,
      `RS3: ${rol}.rolconnlimit es -1`,
      ...TOPES.map((t) => `RS3: a ${rol} le falta el tope ${t}`),
      `RS3: ${rol} es miembro de ${otro}`,
      `RS3: ${rol} tiene CREATE en autenticacion`,
      `RS3: ${rol} tiene INSERT en public.sucursal`,
      `RS3: ${rol} tiene UPDATE en public.sucursal.nombre`,
    ]);
  });

  it("RS3: la migración frena si el rol de respaldo tiene pertenencias (en una transacción que se revierte)", async () => {
    const otro = `rs3_${sufijo()}`;
    const sql = await readFile(join(CARPETA_REAL, "0012_respaldo.sql"), "utf8");
    const error = await revertido(dueno, async () => {
      await dueno.query(`CREATE ROLE ${otro} NOLOGIN`);
      await dueno.query(`GRANT ${otro} TO ${ROL}`);
      return dueno.query(sql).then(
        () => null,
        (e: unknown) => e as { code?: string; message?: string },
      );
    });
    expect(error?.code).toBe("55000");
    expect(error?.message).toContain(`${ROL} es miembro de ${otro}`);
  });

  it("RS4 (violación inyectada): sin SELECT en una tabla aparece nombrada; una tabla o secuencia NUEVA la lee sin otro GRANT", async () => {
    const problemas = await revertido(dueno, async () => {
      await dueno.query(`REVOKE SELECT ON sucursal FROM ${ROL}`);
      await dueno.query("CREATE TABLE prueba_nueva (id int)");
      await dueno.query("CREATE SEQUENCE autenticacion.prueba_secuencia");
      return problemasDeLectura(dueno);
    });
    expect(problemas).toEqual([`RS4: ${ROL} no puede leer public.sucursal`]);
  });

  it.each(["RESET ALL", "NOBYPASSRLS", "INHERIT", "CONNECTION LIMIT -1", "CREATEDB"])(
    "la migración repone lo que el rol perdió (ALTER ROLE %s, en una transacción que se revierte)",
    async (cambio) => {
      const sql = await readFile(join(CARPETA_REAL, "0012_respaldo.sql"), "utf8");
      const problemas = await revertido(dueno, async () => {
        // Topes y atributos son del servidor: un rol ya creado los conserva. Se le saca uno y la migración lo repone.
        await dueno.query(`ALTER ROLE ${ROL} ${cambio}`);
        expect((await problemasDelRol(dueno)).length).toBeGreaterThan(0);
        await dueno.query(sql);
        return problemasDelRol(dueno);
      });
      expect(problemas).toEqual([]);
    },
  );

  it("la migración es repetible: aplicarla otra vez no cambia nada ni falla", async () => {
    const sql = await readFile(join(CARPETA_REAL, "0012_respaldo.sql"), "utf8");
    await revertido(dueno, async () => {
      await dueno.query(sql);
      expect(await todosLosProblemas(dueno)).toEqual([]);
    });
  });

  it("la reversión deja al rol sin acceso a la base y sin LOGIN, sin CASCADE ni contraseñas", async () => {
    const reversion = await readFile(
      join(CARPETA_REAL, "reversiones", "0012_revertir_respaldo.sql"),
      "utf8",
    );
    expect(reversion).not.toMatch(/PASSWORD\s+'/i);
    expect(reversion.replace(/--.*$/gm, "")).not.toMatch(/\bCASCADE\b/i);
    const despues = await revertido(dueno, async () => {
      await dueno.query(reversion);
      return problemasDeLectura(dueno);
    });
    expect(despues.length).toBeGreaterThan(40);
    expect(await problemasDeLectura(dueno)).toEqual([]);
  });
});

// =================================================================================================
// RS5: el comando de migración
// =================================================================================================

describe.skipIf(base === null)("RS5: --preparar-roles --con-respaldo", () => {
  let admin: pg.Client;
  let destruir: (() => Promise<void>) | null = null;
  const propios: string[] = [];

  beforeAll(async () => {
    if (base === null) return;
    admin = new pg.Client({ connectionString: base.admin });
    await admin.connect();
  });
  afterAll(async () => {
    if (base === null) return;
    if (destruir !== null) await destruir();
    for (const rol of propios) await admin.query(`DROP ROLE IF EXISTS ${rol}`);
    await admin.end();
  });

  async function correr(cadena: string, extras: string[], roles: RolPorPreparar[]) {
    const info: string[] = [];
    const error: string[] = [];
    const secreto: string[] = [];
    const pedidos: boolean[] = [];
    const codigo = await ejecutarMigracion({
      argumentos: ["--preparar-roles", ...extras],
      entorno: { [VARIABLE_DE_LA_CADENA]: cadena },
      carpeta: CARPETA_REAL,
      info: (l) => info.push(l),
      error: (l) => error.push(l),
      secreto: (l) => secreto.push(l),
      // Roles propios (los del servidor los usan las demás pruebas): el de respaldo solo si se pidió.
      roles: (_conAutenticacion, conRespaldo) => {
        pedidos.push(conRespaldo);
        return conRespaldo ? roles : roles.filter((r) => r.variable !== "ZULUHUB_DB_RESPALDO");
      },
    });
    return { codigo, info: info.join("\n"), error: error.join("\n"), secreto, pedidos };
  }

  it("con --vercel se rechaza antes de tocar nada: la credencial de respaldo nunca va a Vercel", async () => {
    const salida = await correr(
      "postgresql://nadie@127.0.0.1:1/nada",
      ["--con-respaldo", "--vercel", "preview"],
      [],
    );
    expect(salida.codigo).toBe(2);
    expect(salida.error).toContain("--con-respaldo no se usa con --vercel");
    expect(salida.pedidos).toEqual([]);
  });

  it("sin la bandera no se activa; con la bandera va en un bloque APARTE, con el host directo, y no en el de Vercel", async () => {
    if (base === null) return;
    const s = sufijo();
    const app = `zz_${s}_app`;
    const respaldo = `zz_${s}_respaldo`;
    propios.push(app, respaldo);
    for (const rol of propios) await admin.query(`CREATE ROLE ${rol} NOLOGIN`);
    const nueva = await crearBaseAparte(base, { migrar: false });
    destruir = nueva.destruir;
    const roles = [
      { rol: app, variable: "ZULUHUB_DB_APP" },
      { rol: respaldo, variable: "ZULUHUB_DB_RESPALDO" },
    ];

    const sin = await correr(nueva.base.dueno, [], roles);
    expect(sin.codigo).toBe(0);
    expect(sin.pedidos).toEqual([false]);
    expect(sin.secreto.join("\n")).not.toContain("ZULUHUB_DB_RESPALDO");
    const login = async (rol: string) =>
      (
        await filas<{ l: boolean }>(
          admin,
          "select rolcanlogin as l from pg_roles where rolname = $1",
          [rol],
        )
      )[0]?.l;
    expect(await login(respaldo)).toBe(false);

    const con = await correr(nueva.base.dueno, ["--con-respaldo"], roles);
    expect(con.codigo).toBe(0);
    expect(con.pedidos).toEqual([true]);
    expect(await login(respaldo)).toBe(true);
    const texto = con.secreto.join("\n");
    const bloqueDeGithub = texto.slice(texto.indexOf("PEGAR EN GITHUB"), texto.indexOf("FIN"));
    expect(bloqueDeGithub).toContain("NUNCA EN VERCEL");
    const linea = con.secreto.find((l) => l.startsWith("ZULUHUB_DB_RESPALDO="));
    expect(linea).toBeDefined();
    const url = new URL((linea ?? "").slice("ZULUHUB_DB_RESPALDO=".length));
    expect(url.username).toBe(respaldo);
    expect(url.hostname).toBe(new URL(nueva.base.dueno).hostname);
    // El de la aplicación ya tenía LOGIN: no hay bloque de Vercel con el de respaldo adentro.
    expect(texto).not.toContain("PEGAR EN VERCEL");
  });
});
