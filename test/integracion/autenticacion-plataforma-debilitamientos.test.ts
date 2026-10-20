import { randomUUID } from "node:crypto";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import { crearUsuarioDeBase } from "./autenticacion-apoyo";
import type { BaseDePruebas } from "./global";
import { CARPETA_DE_MIGRACIONES, baseConMigraciones, carpetaCon } from "./marcas-apoyo";

/**
 * Los DEBILITAMIENTOS propios del SQL del segundo factor (0015). Cada caso rompe a propósito la migración de una forma
 * razonable (quitar la RLS forzada, una clave única, un NOT NULL, un privilegio de menos o de más...) en una base
 * descartable y comprueba que una sonda —la misma que pasa sobre el SQL real— deja de cumplirse. Una sonda que sigue
 * pasando con la migración rota es una prueba que no muerde. También se rompe la reversión: sin su guarda borraría los
 * secretos TOTP sin pedir confirmación.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const SUFIJO = "segundo_factor_de_plataforma";
const archivos = async () => (await readdir(CARPETA_DE_MIGRACIONES)).sort();
const archivoDeLaMigracion = async (): Promise<string> =>
  (await archivos()).find((n) => new RegExp(`^\\d{4}_${SUFIJO}\\.sql$`).test(n)) as string;
const migracionesPrevias = async (): Promise<string[]> => {
  const mia = await archivoDeLaMigracion();
  return (await archivos()).filter((n) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n) && n < mia);
};

type Ctx = Readonly<{ base: BaseDePruebas; dueno: pg.Client }>;
/** `true` cuando la base cumple lo que la sonda protege. */
type Sonda = (ctx: Ctx) => Promise<boolean>;

/** Reemplaza `de` por `a` exigiendo que `de` esté exactamente `veces` veces: un debilitamiento que no cambia nada no prueba nada. */
function cambiar(sql: string, de: string, a: string, veces = 1): string {
  const n = sql.split(de).length - 1;
  if (n !== veces)
    throw new Error(`el texto aparece ${n} veces (tenía que ser ${veces}): ${de.slice(0, 80)}`);
  return sql.split(de).join(a);
}

let plantilla: Awaited<ReturnType<typeof baseConMigraciones>>;
let plantillaNombre = "";
let admin: pg.Client;
let sqlReal = "";
let reversionReal = "";

const conBase = (url: string, nombre: string): string => {
  const u = new URL(url);
  u.pathname = `/${nombre}`;
  return u.toString();
};

/** Una copia de la plantilla (las migraciones anteriores) con ese texto de 0015 aplicado; se destruye al terminar. */
async function conMigracion<T>(sql: string, trabajo: (ctx: Ctx) => Promise<T>): Promise<T> {
  const b = base as BaseDePruebas;
  const nombre = `zuluhub_deb_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  await admin.query(`CREATE DATABASE ${nombre} TEMPLATE ${plantillaNombre}`);
  const carpeta = await carpetaCon(await migracionesPrevias());
  const copia: BaseDePruebas = {
    ...b,
    dueno: conBase(b.dueno, nombre),
    app: conBase(b.app, nombre),
    grupo: conBase(b.grupo, nombre),
    trabajos: conBase(b.trabajos, nombre),
    plataforma: conBase(b.plataforma, nombre),
    autenticacion: conBase(b.autenticacion, nombre),
    publico: conBase(b.publico, nombre),
    captacion: conBase(b.captacion, nombre),
  };
  const dueno = new pg.Client({ connectionString: copia.dueno });
  try {
    await writeFile(join(carpeta, await archivoDeLaMigracion()), sql);
    await aplicarMigraciones(copia.dueno, carpeta);
    await dueno.connect();
    return await trabajo({ base: copia, dueno });
  } finally {
    await dueno.end().catch(() => undefined);
    await rm(carpeta, { recursive: true, force: true });
    await admin.query(`DROP DATABASE ${nombre} WITH (FORCE)`);
  }
}

const codigoDe = async (
  c: pg.Client,
  texto: string,
  parametros: unknown[] = [],
): Promise<string | null> => {
  await c.query("begin");
  try {
    await c.query(texto, parametros);
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "?";
  } finally {
    await c.query("rollback");
  }
};

async function comoAutenticacion<T>(ctx: Ctx, trabajo: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: ctx.base.autenticacion });
  await c.connect();
  try {
    return await trabajo(c);
  } finally {
    await c.end();
  }
}

const conUsuarioYFila = async (ctx: Ctx): Promise<string> => {
  const u = await crearUsuarioDeBase(ctx.dueno);
  await ctx.dueno.query(
    `insert into autenticacion."twoFactor" (secret, "backupCodes", "userId") values ('c', '[]', $1)`,
    [u.id],
  );
  return u.id;
};

// ---- sondas --------------------------------------------------------------------------------------------

const sondas = {
  /** La RLS de las tres tablas nuevas está activa y forzada. */
  rlsForzadaEnLasTres: async (ctx: Ctx) => {
    const { rows } = await ctx.dueno.query<{ n: number }>(
      `select count(*)::int as n from pg_class
        where relnamespace = 'autenticacion'::regnamespace and relname in ('twoFactor', 'codigo_totp_usado', 'intento_segundo_factor')
          and relrowsecurity and relforcerowsecurity`,
    );
    return rows[0]?.n === 3;
  },
  /** Las nueve políticas (tres por tabla) son solo del rol de la librería. */
  politicasSoloDelRol: async (ctx: Ctx) => {
    const { rows } = await ctx.dueno.query<{ n: number }>(
      `select count(*)::int as n from pg_policies
        where schemaname = 'autenticacion' and tablename in ('twoFactor', 'codigo_totp_usado', 'intento_segundo_factor')
          and roles = array['zuluhub_autenticacion']::name[]`,
    );
    return rows[0]?.n === 9;
  },
  /** Un paso de TOTP se registra una sola vez POR USUARIO (G2): el mismo paso de otra persona no estorba. */
  pasoUnicoPorUsuario: async (ctx: Ctx) => {
    const u = await crearUsuarioDeBase(ctx.dueno);
    const otro = await crearUsuarioDeBase(ctx.dueno);
    await ctx.dueno.query(
      `insert into autenticacion.codigo_totp_usado (usuario_id, paso) values ($1, 5)`,
      [u.id],
    );
    const repetido = await codigoDe(
      ctx.dueno,
      `insert into autenticacion.codigo_totp_usado (usuario_id, paso) values ($1, 5)`,
      [u.id],
    );
    const deOtro = await codigoDe(
      ctx.dueno,
      `insert into autenticacion.codigo_totp_usado (usuario_id, paso) values ($1, 5)`,
      [otro.id],
    );
    return repetido === "23505" && deOtro === null;
  },
  /** Un paso de reloj no es negativo. */
  pasoNoNegativo: async (ctx: Ctx) => {
    const u = await crearUsuarioDeBase(ctx.dueno);
    return (
      (await codigoDe(
        ctx.dueno,
        `insert into autenticacion.codigo_totp_usado (usuario_id, paso) values ($1, -1)`,
        [u.id],
      )) === "23514"
    );
  },
  /** Un usuario tiene una sola fila de segundo factor. */
  unaFilaPorUsuario: async (ctx: Ctx) => {
    const u = await conUsuarioYFila(ctx);
    return (
      (await codigoDe(
        ctx.dueno,
        `insert into autenticacion."twoFactor" (secret, "backupCodes", "userId") values ('d', '[]', $1)`,
        [u],
      )) === "23505"
    );
  },
  /** `verified` y `twoFactorEnabled` no admiten nulo (un estado dudoso es «no verificado»). */
  sinNulosEnLosEstados: async (ctx: Ctx) => {
    const u = await conUsuarioYFila(ctx);
    const a = await codigoDe(
      ctx.dueno,
      `update autenticacion."twoFactor" set verified = null where "userId" = $1`,
      [u],
    );
    const b = await codigoDe(
      ctx.dueno,
      `update autenticacion."user" set "twoFactorEnabled" = null where id = $1`,
      [u],
    );
    return a === "23502" && b === "23502";
  },
  /** Una sesión nueva y un usuario nuevo nacen sin segundo factor (lo que ve la web de empresa, que no sabe de él). */
  nacenSinSegundoFactor: async (ctx: Ctx) => {
    // Si la base rechaza el alta (por ejemplo, una columna sin valor por defecto), no nacen sin segundo factor: `false`.
    const r = await comoAutenticacion(ctx, async (c) => {
      const u = await c.query<{ id: string; e: boolean }>(
        `insert into autenticacion."user" (name, email, "emailVerified") values ('N', $1, true) returning id, "twoFactorEnabled" as e`,
        [`${randomUUID()}@ejemplo.test`],
      );
      const s = await c.query<{ m: Date | null }>(
        `insert into autenticacion.session ("expiresAt", token, "userId", host) values (now() + interval '1 hour', $1, $2, 'h.example.test') returning segundo_factor_en as m`,
        [randomUUID(), u.rows[0]?.id],
      );
      return u.rows[0]?.e === false && s.rows[0]?.m === null;
    }).catch(() => false);
    return r;
  },
  /** El rol de la librería no borra el segundo factor (no hay ruta que dé de baja el TOTP: es del dueño). */
  sinDeleteEnTwoFactor: async (ctx: Ctx) => {
    await conUsuarioYFila(ctx);
    return comoAutenticacion(
      ctx,
      async (c) => (await codigoDe(c, `delete from autenticacion."twoFactor"`)) === "42501",
    );
  },
  /** El rol de la librería cambia solo TRES columnas del segundo factor. */
  updateSoloTresColumnas: async (ctx: Ctx) => {
    await conUsuarioYFila(ctx);
    return comoAutenticacion(ctx, async (c) => {
      const ok = await codigoDe(
        c,
        `update autenticacion."twoFactor" set secret = 'e', "backupCodes" = '[]', verified = true`,
      );
      const usuario = await codigoDe(
        c,
        `update autenticacion."twoFactor" set "userId" = gen_random_uuid()`,
      );
      const bloqueo = await codigoDe(
        c,
        `update autenticacion."twoFactor" set "lockedUntil" = now()`,
      );
      return ok === null && usuario === "42501" && bloqueo === "42501";
    });
  },
  /** Los pasos y los intentos no se cambian (solo se dan de alta, se leen y se borran los viejos). */
  sinUpdateEnLosRegistros: async (ctx: Ctx) => {
    const u = await crearUsuarioDeBase(ctx.dueno);
    await ctx.dueno.query(
      `insert into autenticacion.codigo_totp_usado (usuario_id, paso) values ($1, 9)`,
      [u.id],
    );
    await ctx.dueno.query(
      `insert into autenticacion.intento_segundo_factor (usuario_id, fallo_en) values ($1, now())`,
      [u.id],
    );
    return comoAutenticacion(ctx, async (c) => {
      const a = await codigoDe(c, `update autenticacion.codigo_totp_usado set paso = 10`);
      const b = await codigoDe(
        c,
        `update autenticacion.intento_segundo_factor set fallo_en = now()`,
      );
      return a === "42501" && b === "42501";
    });
  },
  /** Ningún otro rol (la aplicación, la plataforma) ni PUBLIC toca las tablas nuevas. */
  nadieMasTocaLasTablas: async (ctx: Ctx) => {
    for (const rol of [
      "zuluhub_app",
      "zuluhub_plataforma",
      "zuluhub_trabajos",
      "zuluhub_grupo",
      "zuluhub_publico",
      "zuluhub_captacion",
    ]) {
      for (const tabla of ["twoFactor", "codigo_totp_usado", "intento_segundo_factor"]) {
        const { rows } = await ctx.dueno.query<{ puede: boolean }>(
          `select (has_table_privilege($1, format('autenticacion.%I', $2::text), 'SELECT,INSERT,UPDATE,DELETE')
                   or has_any_column_privilege($1, format('autenticacion.%I', $2::text), 'SELECT,INSERT,UPDATE')) as puede`,
          [rol, tabla],
        );
        if (rows[0]?.puede !== false) return false;
      }
    }
    const { rows: publico } = await ctx.dueno.query(
      `select 1 from pg_class c, aclexplode(c.relacl) a
        where c.oid in ('autenticacion."twoFactor"'::regclass, 'autenticacion.codigo_totp_usado'::regclass, 'autenticacion.intento_segundo_factor'::regclass) and a.grantee = 0`,
    );
    return publico.length === 0;
  },
  /** Borrar un usuario (lo hace el dueño) arrastra su segundo factor. */
  cascadaDelUsuario: async (ctx: Ctx) => {
    const u = await conUsuarioYFila(ctx);
    const borrado = await codigoDe(ctx.dueno, `delete from autenticacion."user" where id = $1`, [
      u,
    ]);
    if (borrado !== null) return false; // sin cascada, la clave foránea impide borrar al usuario
    await ctx.dueno.query(`delete from autenticacion."user" where id = $1`, [u]);
    const { rows } = await ctx.dueno.query(
      `select 1 from autenticacion."twoFactor" where "userId" = $1`,
      [u],
    );
    return rows.length === 0;
  },
  /** Con datos de segundo factor, la reversión NO corre sin la confirmación. */
  reversionProtegida: async (ctx: Ctx) => {
    await conUsuarioYFila(ctx);
    await ctx.dueno.query("begin");
    try {
      await ctx.dueno.query(reversionReal);
      return false;
    } catch (e) {
      return (e as { code?: string }).code === "55000";
    } finally {
      await ctx.dueno.query("rollback");
    }
  },
} satisfies Record<string, Sonda>;

type NombreDeSonda = keyof typeof sondas;

describe.skipIf(base === null)(
  "segundo factor de la consola: debilitamientos del SQL (cada sonda muerde)",
  () => {
    beforeAll(async () => {
      if (base === null) return;
      sqlReal = await readFile(join(CARPETA_DE_MIGRACIONES, await archivoDeLaMigracion()), "utf8");
      const reversiones = await readdir(join(CARPETA_DE_MIGRACIONES, "reversiones"));
      reversionReal = await readFile(
        join(
          CARPETA_DE_MIGRACIONES,
          "reversiones",
          reversiones.find((n) => n.endsWith(`_revertir_${SUFIJO}.sql`)) as string,
        ),
        "utf8",
      );
      plantilla = await baseConMigraciones(base, await migracionesPrevias());
      await plantilla.cliente.end();
      plantillaNombre = new URL(plantilla.aparte.base.dueno).pathname.slice(1);
      admin = new pg.Client({ connectionString: base.admin });
      await admin.connect();
    });
    afterAll(async () => {
      if (base === null) return;
      await admin.end();
      await rm(plantilla.carpeta, { recursive: true, force: true });
      await plantilla.aparte.destruir();
    });

    it("CONTROL: con el SQL real todas las sondas se cumplen", async () => {
      await conMigracion(sqlReal, async (ctx) => {
        for (const [nombre, sonda] of Object.entries(sondas)) {
          expect(await sonda(ctx), nombre).toBe(true);
        }
      });
    });

    // [nombre del debilitamiento, cómo se rompe, la sonda que tiene que dejar de cumplirse]
    const casos: [string, (sql: string) => string, NombreDeSonda][] = [
      [
        "sin FORCE ROW LEVEL SECURITY",
        (s) =>
          cambiar(
            s,
            "    EXECUTE format('ALTER TABLE autenticacion.%I FORCE ROW LEVEL SECURITY', t);\n",
            "",
          ),
        "rlsForzadaEnLasTres",
      ],
      [
        "sin ENABLE ROW LEVEL SECURITY",
        (s) =>
          cambiar(
            s,
            "    EXECUTE format('ALTER TABLE autenticacion.%I ENABLE ROW LEVEL SECURITY', t);\n",
            "",
          ),
        "rlsForzadaEnLasTres",
      ],
      [
        "políticas para PUBLIC en lugar del rol de la librería",
        (s) => cambiar(s, "FOR %s TO zuluhub_autenticacion %s", "FOR %s TO public %s"),
        "politicasSoloDelRol",
      ],
      [
        "sin la clave primaria (usuario, paso) de los pasos usados",
        (s) =>
          cambiar(s, ",\n  CONSTRAINT codigo_totp_usado_pk PRIMARY KEY (usuario_id, paso)", ""),
        "pasoUnicoPorUsuario",
      ],
      [
        "la clave de los pasos usados solo por usuario (uno por persona)",
        (s) => cambiar(s, "PRIMARY KEY (usuario_id, paso)", "UNIQUE (paso)"),
        "pasoUnicoPorUsuario",
      ],
      [
        "sin el CHECK de paso no negativo",
        (s) => cambiar(s, " CONSTRAINT codigo_totp_usado_paso_ck CHECK (paso >= 0)", ""),
        "pasoNoNegativo",
      ],
      [
        "el índice de userId del segundo factor sin unicidad",
        (s) =>
          cambiar(
            s,
            'CREATE UNIQUE INDEX IF NOT EXISTS "twoFactor_userId_idx"',
            'CREATE INDEX IF NOT EXISTS "twoFactor_userId_idx"',
          ),
        "unaFilaPorUsuario",
      ],
      [
        "`verified` anulable (como lo exporta la librería)",
        (s) =>
          cambiar(
            s,
            "verified                  boolean NOT NULL DEFAULT false,",
            "verified                  boolean,",
          ),
        "sinNulosEnLosEstados",
      ],
      [
        "`twoFactorEnabled` anulable (como lo exporta la librería)",
        (s) =>
          cambiar(
            s,
            '"twoFactorEnabled" boolean NOT NULL DEFAULT false',
            '"twoFactorEnabled" boolean DEFAULT false',
          ),
        "sinNulosEnLosEstados",
      ],
      [
        "`twoFactorEnabled` sin valor por defecto",
        (s) =>
          cambiar(
            s,
            '"twoFactorEnabled" boolean NOT NULL DEFAULT false',
            '"twoFactorEnabled" boolean NOT NULL',
          ),
        "nacenSinSegundoFactor",
      ],
      [
        "DELETE de más sobre el segundo factor",
        (s) =>
          cambiar(
            s,
            'GRANT SELECT, INSERT ON autenticacion."twoFactor" TO zuluhub_autenticacion;',
            'GRANT SELECT, INSERT, DELETE ON autenticacion."twoFactor" TO zuluhub_autenticacion;',
          ),
        "sinDeleteEnTwoFactor",
      ],
      [
        "UPDATE de tabla entera (en vez de tres columnas)",
        (s) =>
          cambiar(
            s,
            'GRANT UPDATE (secret, "backupCodes", verified) ON autenticacion."twoFactor" TO zuluhub_autenticacion;',
            'GRANT UPDATE ON autenticacion."twoFactor" TO zuluhub_autenticacion;',
          ),
        "updateSoloTresColumnas",
      ],
      [
        "UPDATE de más en los registros de intentos y pasos",
        (s) =>
          cambiar(
            s,
            "GRANT SELECT, INSERT, DELETE ON autenticacion.codigo_totp_usado, autenticacion.intento_segundo_factor",
            "GRANT SELECT, INSERT, UPDATE, DELETE ON autenticacion.codigo_totp_usado, autenticacion.intento_segundo_factor",
          ),
        "sinUpdateEnLosRegistros",
      ],
      [
        "sin quitarle los privilegios a PUBLIC",
        (s) =>
          cambiar(
            s,
            'REVOKE ALL ON autenticacion."twoFactor", autenticacion.codigo_totp_usado, autenticacion.intento_segundo_factor\n  FROM PUBLIC;',
            'GRANT SELECT ON autenticacion."twoFactor" TO PUBLIC;',
          ),
        "nadieMasTocaLasTablas",
      ],
      [
        "la aplicación recibe SELECT sobre el segundo factor",
        (s) => `${s}\nGRANT SELECT ON autenticacion."twoFactor" TO zuluhub_app;\n`,
        "nadieMasTocaLasTablas",
      ],
      [
        "la clave foránea del segundo factor sin borrado en cascada",
        (s) =>
          cambiar(
            s,
            '"userId"                  uuid NOT NULL REFERENCES autenticacion."user" (id) ON DELETE CASCADE,',
            '"userId"                  uuid NOT NULL REFERENCES autenticacion."user" (id),',
          ),
        "cascadaDelUsuario",
      ],
    ];

    it.each(casos)("%s: la sonda deja de cumplirse", async (_nombre, romper, sonda) => {
      // Primero, que la sonda pase con el SQL real (así no se cumple «por vacío»).
      await conMigracion(sqlReal, async (ctx) =>
        expect(await sondas[sonda](ctx), `real: ${sonda}`).toBe(true),
      );
      await conMigracion(romper(sqlReal), async (ctx) =>
        expect(await sondas[sonda](ctx), `roto: ${sonda}`).toBe(false),
      );
    });

    it("la reversión sin su guarda de confirmación borraría los secretos sin pedir nada: la sonda lo detecta", async () => {
      const sinGuarda = cambiar(
        reversionReal,
        "IF v_secretos + v_usuarios + v_sesiones + v_pasos + v_intentos > 0\n     AND coalesce(current_setting('zuluhub.confirmar_reversion', true), '') <> 'SI' THEN",
        "IF false THEN",
      );
      await conMigracion(sqlReal, async (ctx) => {
        await conUsuarioYFila(ctx);
        await ctx.dueno.query("begin");
        try {
          await ctx.dueno.query(sinGuarda);
          const { rows } = await ctx.dueno.query<{ t: string | null }>(
            `select to_regclass('autenticacion."twoFactor"') as t`,
          );
          expect(rows[0]?.t, "la tabla con los secretos se borró sin confirmación").toBeNull();
        } finally {
          await ctx.dueno.query("rollback");
        }
      });
    });

    it("cada debilitamiento cambia algo de verdad (el texto roto no es el real)", () => {
      for (const [nombre, romper] of casos) expect(romper(sqlReal), nombre).not.toBe(sqlReal);
    });
  },
);
