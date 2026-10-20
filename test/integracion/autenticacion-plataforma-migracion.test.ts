import { randomUUID } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import { crearUsuarioDeBase } from "./autenticacion-apoyo";
import { crearBaseAparte } from "./entorno";
import type { BaseDePruebas } from "./global";
import {
  CARPETA_DE_MIGRACIONES,
  HASTA_0006,
  baseConMigraciones,
  carpetaCon,
  huellaDeCatalogo,
} from "./marcas-apoyo";

/**
 * El segundo factor de la consola (0015): la migración sobre una base CON DATOS (aditiva: no cambia ni un dato), el
 * catálogo EXACTO de lo que agrega (columnas, tablas, índices, restricciones, RLS, políticas y privilegios), sus guardas,
 * que se puede repetir y que dos ejecutores a la vez la aplican una sola vez, lo que promete el texto del archivo y su
 * reversión (destructiva y protegida: sin `zuluhub.confirmar_reversion = 'SI'` no borra secretos).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const SUFIJO = "segundo_factor_de_plataforma";
const archivos = async () => (await readdir(CARPETA_DE_MIGRACIONES)).sort();
const archivoDeLaMigracion = async (): Promise<string> => {
  const encontrados = (await archivos()).filter((n) =>
    new RegExp(`^\\d{4}_${SUFIJO}\\.sql$`).test(n),
  );
  if (encontrados.length !== 1)
    throw new Error(`debería haber una migración, hay ${encontrados.length}`);
  return encontrados[0] as string;
};
const archivoDeLaReversion = async (): Promise<string> => {
  const encontrados = (await readdir(join(CARPETA_DE_MIGRACIONES, "reversiones"))).filter((n) =>
    new RegExp(`^\\d{4}_revertir_${SUFIJO}\\.sql$`).test(n),
  );
  if (encontrados.length !== 1)
    throw new Error(`debería haber una reversión, hay ${encontrados.length}`);
  return encontrados[0] as string;
};
/** Todas las migraciones anteriores a la de esta rama, en orden. */
const migracionesPrevias = async (): Promise<string[]> => {
  const mia = await archivoDeLaMigracion();
  return (await archivos()).filter((n) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n) && n < mia);
};
const textoDeLaMigracion = async (): Promise<string> =>
  readFile(join(CARPETA_DE_MIGRACIONES, await archivoDeLaMigracion()), "utf8");
const textoDeLaReversion = async (): Promise<string> =>
  readFile(join(CARPETA_DE_MIGRACIONES, "reversiones", await archivoDeLaReversion()), "utf8");

/** Lo que agrega 0015, además de dos columnas (`"user"."twoFactorEnabled"` y `session.segundo_factor_en`): tres tablas. */
const TABLAS_NUEVAS = ["codigo_totp_usado", "intento_segundo_factor", "twoFactor"] as const;

/** Contenido de cada tabla de `public` y de `autenticacion` (salvo el registro del ejecutor y lo nuevo): ni una fila puede cambiar. */
async function huellaDeDatos(c: pg.Client): Promise<Record<string, string>> {
  const { rows: tablas } = await c.query<{ t: string }>(
    `select format('%I.%I', n.nspname, c.relname) as t
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'autenticacion') and c.relkind = 'r' and c.relname <> 'migracion'
        and c.relname not in ('twoFactor', 'codigo_totp_usado', 'intento_segundo_factor')
      order by 1`,
  );
  const r: Record<string, string> = {};
  for (const { t } of tablas) {
    // Se excluyen las dos columnas que 0015 agrega (si existen): lo anterior no puede cambiar.
    const { rows } = await c.query<{ h: string }>(
      `select coalesce(md5(string_agg(((to_jsonb(x)) - 'twoFactorEnabled' - 'segundo_factor_en')::text, '|'
                                       order by ((to_jsonb(x)) - 'twoFactorEnabled' - 'segundo_factor_en')::text)), '-') as h from ${t} x`,
    );
    r[t] = rows[0]?.h as string;
  }
  return r;
}

/** Todo lo que el catálogo declara del esquema `autenticacion`, en líneas ordenables. */
async function catalogoDeAutenticacion(c: pg.Client): Promise<Record<string, string[]>> {
  const lista = async (texto: string) =>
    (await c.query<{ x: string }>(texto)).rows.map((f) => f.x).sort();
  return {
    columnas: await lista(
      `select format('%s.%s:%s:%s:%s:%s', table_name, column_name, data_type, is_nullable, coalesce(column_default, '-'), udt_name) as x
         from information_schema.columns where table_schema = 'autenticacion'`,
    ),
    restricciones: await lista(
      `select format('%s.%s:%s:%s', conrelid::regclass, conname, contype, pg_get_constraintdef(oid)) as x
         from pg_constraint where connamespace = 'autenticacion'::regnamespace and contype <> 'n'`,
    ),
    indices: await lista(
      `select format('%s:%s', tablename, indexdef) as x from pg_indexes where schemaname = 'autenticacion'`,
    ),
    tablas: await lista(
      `select format('%s:rls=%s:forzada=%s', relname, relrowsecurity, relforcerowsecurity) as x
         from pg_class where relnamespace = 'autenticacion'::regnamespace and relkind = 'r'`,
    ),
    politicas: await lista(
      `select format('%s.%s:%s:%s:%s:%s:%s', tablename, policyname, cmd, permissive, array_to_string(roles, '+'), coalesce(qual, '-'), coalesce(with_check, '-')) as x
         from pg_policies where schemaname = 'autenticacion'`,
    ),
    privilegiosDeTabla: await lista(
      `select format('%s:%s:%s', c.relname, coalesce(a.grantee::regrole::text, 'PUBLIC'), a.privilege_type) as x
         from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
        where c.relnamespace = 'autenticacion'::regnamespace and c.relkind = 'r' and a.grantee <> c.relowner`,
    ),
    privilegiosPorColumna: await lista(
      `select format('%s.%s:%s:%s', c.relname, t.attname, coalesce(a.grantee::regrole::text, 'PUBLIC'), a.privilege_type) as x
         from pg_class c join pg_attribute t on t.attrelid = c.oid and t.attacl is not null,
              aclexplode(t.attacl) a
        where c.relnamespace = 'autenticacion'::regnamespace and c.relkind = 'r'`,
    ),
    disparadores: await lista(
      `select format('%s.%s', event_object_table, trigger_name) as x from information_schema.triggers where trigger_schema = 'autenticacion'`,
    ),
    funciones: await lista(
      `select p.oid::regprocedure::text as x from pg_proc p where p.pronamespace = 'autenticacion'::regnamespace`,
    ),
  };
}

function diferencias(antes: Record<string, string[]>, despues: Record<string, string[]>) {
  const nuevas: Record<string, string[]> = {};
  const perdidas: Record<string, string[]> = {};
  for (const categoria of Object.keys(antes)) {
    const a = new Set(antes[categoria]);
    const d = new Set(despues[categoria]);
    nuevas[categoria] = [...d].filter((x) => !a.has(x));
    perdidas[categoria] = [...a].filter((x) => !d.has(x));
  }
  return { nuevas, perdidas };
}

const codigoDe = (consulta: Promise<unknown>): Promise<string | null> =>
  consulta.then(
    () => null,
    (e: { code?: string }) => e.code ?? "?",
  );

async function comoRol<T>(url: string, trabajo: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await trabajo(c);
  } finally {
    await c.end();
  }
}

/** Filas en las cinco tablas de la librería y en `public`, armadas por el dueño: sobre ellas se aplica la migración. */
async function sembrarDatosPrevios(c: pg.Client): Promise<{ usuario: string; sesion: string }> {
  const usuario = await crearUsuarioDeBase(c);
  await c.query(
    `insert into autenticacion.account ("accountId", "providerId", "userId") values ($1, 'google', $2)`,
    [randomUUID(), usuario.id],
  );
  const sesion = (
    await c.query<{ id: string }>(
      `insert into autenticacion.session ("expiresAt", token, "userId", host) values (now() + interval '1 hour', $1, $2, 'consola.example.test') returning id`,
      [randomUUID(), usuario.id],
    )
  ).rows[0]?.id as string;
  await c.query(
    `insert into autenticacion.verification (identifier, value, "expiresAt") values ($1, 'v', now() + interval '1 hour')`,
    [randomUUID()],
  );
  await c.query(
    `insert into autenticacion."rateLimit" (key, count, "lastRequest") values ($1, 1, 1)`,
    [randomUUID()],
  );
  await c.query(
    `insert into auditoria_plataforma (actor, accion, entidad, entidad_id) values ('sistema', 'PRUEBA', 'x', 'y')`,
  );
  return { usuario: usuario.id, sesion };
}

describe.skipIf(base === null)("segundo factor de la consola: la migración 0015", () => {
  const b = () => base as BaseDePruebas;

  /** Una base con las migraciones ANTERIORES a la mía y la carpeta que suma la mía. */
  async function conPrevias<T>(
    trabajo: (x: Awaited<ReturnType<typeof baseConMigraciones>>, conMia: string) => Promise<T>,
  ): Promise<T> {
    const previa = await baseConMigraciones(b(), await migracionesPrevias());
    const conMia = await carpetaCon([
      ...(await migracionesPrevias()),
      await archivoDeLaMigracion(),
    ]);
    try {
      return await trabajo(previa, conMia);
    } finally {
      await rm(conMia, { recursive: true, force: true });
      await previa.cerrar();
    }
  }

  // ===========================================================================================================
  // Sobre una base con datos: aditiva
  // ===========================================================================================================
  it("sobre una base con datos no cambia NI UN dato, no toca `public` y agrega exactamente lo prometido a `autenticacion`", async () => {
    await conPrevias(async (previa, conMia) => {
      const { usuario, sesion } = await sembrarDatosPrevios(previa.cliente);
      const datosAntes = await huellaDeDatos(previa.cliente);
      const publicoAntes = await huellaDeCatalogo(previa.cliente);
      const autenticacionAntes = await catalogoDeAutenticacion(previa.cliente);

      const r = await aplicarMigraciones(previa.aparte.base.dueno, conMia);
      expect(r.aplicadas).toEqual([await archivoDeLaMigracion()]);

      expect(await huellaDeDatos(previa.cliente)).toEqual(datosAntes);
      // `public` queda exactamente igual (ninguna categoría cambia).
      expect(await huellaDeCatalogo(previa.cliente)).toEqual(publicoAntes);
      // Los valores nuevos de lo que ya existía: el usuario sin segundo factor y la sesión sin marca.
      const { rows: u } = await previa.cliente.query(
        `select "twoFactorEnabled" as e from autenticacion."user" where id = $1`,
        [usuario],
      );
      expect(u).toEqual([{ e: false }]);
      const { rows: s } = await previa.cliente.query(
        `select segundo_factor_en as m from autenticacion.session where id = $1`,
        [sesion],
      );
      expect(s).toEqual([{ m: null }]);

      const { nuevas, perdidas } = diferencias(
        autenticacionAntes,
        await catalogoDeAutenticacion(previa.cliente),
      );
      for (const categoria of Object.keys(perdidas)) {
        expect(perdidas[categoria], `${categoria}: líneas perdidas`).toEqual([]);
      }
      // Lo único que cambia de lo existente: dos columnas nuevas (con su valor por defecto) y nada de funciones ni disparadores.
      expect(nuevas["columnas"]?.filter((x) => /^(user|session)\./.test(x))).toEqual([
        "session.segundo_factor_en:timestamp with time zone:YES:-:timestamptz",
        "user.twoFactorEnabled:boolean:NO:false:bool",
      ]);
      expect(nuevas["funciones"]).toEqual([]);
      expect(nuevas["disparadores"]).toEqual([]);
      // Las tablas nuevas, las tres, con RLS activa y forzada.
      expect(nuevas["tablas"]).toEqual([
        "codigo_totp_usado:rls=t:forzada=t",
        "intento_segundo_factor:rls=t:forzada=t",
        "twoFactor:rls=t:forzada=t",
      ]);
    });
  });

  it("el catálogo EXACTO de lo que agrega: restricciones, índices, políticas y privilegios", async () => {
    await conPrevias(async (previa, conMia) => {
      const antes = await catalogoDeAutenticacion(previa.cliente);
      await aplicarMigraciones(previa.aparte.base.dueno, conMia);
      const { nuevas } = diferencias(antes, await catalogoDeAutenticacion(previa.cliente));

      expect(nuevas["restricciones"]).toEqual(
        [
          'autenticacion."twoFactor".twoFactor_pkey:p:PRIMARY KEY (id)',
          `autenticacion."twoFactor".twoFactor_userId_fkey:f:FOREIGN KEY ("userId") REFERENCES autenticacion."user"(id) ON DELETE CASCADE`,
          "autenticacion.codigo_totp_usado.codigo_totp_usado_paso_ck:c:CHECK ((paso >= 0))",
          "autenticacion.codigo_totp_usado.codigo_totp_usado_pk:p:PRIMARY KEY (usuario_id, paso)",
          'autenticacion.codigo_totp_usado.codigo_totp_usado_usuario_id_fkey:f:FOREIGN KEY (usuario_id) REFERENCES autenticacion."user"(id) ON DELETE CASCADE',
          "autenticacion.intento_segundo_factor.intento_segundo_factor_pkey:p:PRIMARY KEY (id)",
          'autenticacion.intento_segundo_factor.intento_segundo_factor_usuario_id_fkey:f:FOREIGN KEY (usuario_id) REFERENCES autenticacion."user"(id) ON DELETE CASCADE',
        ].sort(),
      );
      expect(nuevas["indices"]?.map((x) => x.replace(/^[^:]+:/, "")).sort()).toEqual(
        [
          `CREATE UNIQUE INDEX "twoFactor_pkey" ON autenticacion."twoFactor" USING btree (id)`,
          `CREATE INDEX "twoFactor_secret_idx" ON autenticacion."twoFactor" USING btree (secret)`,
          `CREATE UNIQUE INDEX "twoFactor_userId_idx" ON autenticacion."twoFactor" USING btree ("userId")`,
          "CREATE UNIQUE INDEX codigo_totp_usado_pk ON autenticacion.codigo_totp_usado USING btree (usuario_id, paso)",
          "CREATE UNIQUE INDEX intento_segundo_factor_pkey ON autenticacion.intento_segundo_factor USING btree (id)",
          "CREATE INDEX intento_segundo_factor_usuario_ix ON autenticacion.intento_segundo_factor USING btree (usuario_id, fallo_en)",
        ].sort(),
      );
      // Una política por comando concedido, solo para el rol de la librería, sin condición (el aislamiento es del rol).
      const politica = (tabla: string, nombre: string, cmd: string, cond: string) =>
        `${tabla}.${nombre}:${cmd}:PERMISSIVE:zuluhub_autenticacion:${cmd === "INSERT" ? "-" : cond}:${cmd === "INSERT" || cmd === "UPDATE" ? "true" : "-"}`;
      expect(nuevas["politicas"]).toEqual(
        [
          ...["twoFactor"].flatMap((t) => [
            politica(t, "rol_autenticacion_leer", "SELECT", "true"),
            politica(t, "rol_autenticacion_alta", "INSERT", "true"),
            politica(t, "rol_autenticacion_cambiar", "UPDATE", "true"),
          ]),
          ...["codigo_totp_usado", "intento_segundo_factor"].flatMap((t) => [
            politica(t, "rol_autenticacion_leer", "SELECT", "true"),
            politica(t, "rol_autenticacion_alta", "INSERT", "true"),
            politica(t, "rol_autenticacion_borrar", "DELETE", "true"),
          ]),
        ].sort(),
      );
      // Privilegios de tabla: el rol de la librería y el de respaldo (0012: SELECT por defecto en toda tabla nueva, y es el
      // ÚNICO que salta la RLS para el volcado); NADIE más (ni PUBLIC).
      expect(nuevas["privilegiosDeTabla"]).toEqual(
        [
          "twoFactor:zuluhub_autenticacion:INSERT",
          "twoFactor:zuluhub_autenticacion:SELECT",
          ...["codigo_totp_usado", "intento_segundo_factor"].flatMap((t) =>
            ["DELETE", "INSERT", "SELECT"].map((p) => `${t}:zuluhub_autenticacion:${p}`),
          ),
          ...TABLAS_NUEVAS.map((t) => `${t}:zuluhub_respaldo:SELECT`),
        ].sort(),
      );
      // Por columna: UPDATE de SOLO tres columnas del segundo factor (secreto, códigos y `verified`).
      expect(nuevas["privilegiosPorColumna"]).toEqual(
        [
          "twoFactor.backupCodes:zuluhub_autenticacion:UPDATE",
          "twoFactor.secret:zuluhub_autenticacion:UPDATE",
          "twoFactor.verified:zuluhub_autenticacion:UPDATE",
        ].sort(),
      );
    });
  });

  it("repetir el ejecutor, aplicar el archivo a mano dos veces y dos ejecutores a la vez dejan el mismo resultado", async () => {
    await conPrevias(async (previa, conMia) => {
      const mia = await archivoDeLaMigracion();
      // Dos ejecutores simultáneos (toman el bloqueo asesor): la migración se aplica UNA sola vez.
      const [x, y] = await Promise.all([
        aplicarMigraciones(previa.aparte.base.dueno, conMia),
        aplicarMigraciones(previa.aparte.base.dueno, conMia),
      ]);
      expect([...x.aplicadas, ...y.aplicadas]).toEqual([mia]);
      const catalogo = await catalogoDeAutenticacion(previa.cliente);
      const publico = await huellaDeCatalogo(previa.cliente);
      // El ejecutor de nuevo: nada que aplicar.
      expect(await aplicarMigraciones(previa.aparte.base.dueno, conMia)).toEqual({
        aplicadas: [],
        yaAplicadas: [...(await migracionesPrevias()), mia],
      });
      // El archivo corrido a mano otra vez (lo que el ejecutor jamás hace) tampoco falla ni cambia nada.
      const sql = await textoDeLaMigracion();
      await previa.cliente.query(sql);
      await previa.cliente.query(sql);
      expect(await catalogoDeAutenticacion(previa.cliente)).toEqual(catalogo);
      expect(await huellaDeCatalogo(previa.cliente)).toEqual(publico);
    });
  });

  it("si una de las tablas nuevas ya existía a medias (una corrida cortada), la migración la completa sin duplicar ni perder filas", async () => {
    await conPrevias(async (previa, conMia) => {
      const { usuario } = await sembrarDatosPrevios(previa.cliente);
      // Un estado intermedio: la columna de la sesión y una tabla ya están, con un dato.
      await previa.cliente.query(
        `alter table autenticacion.session add column segundo_factor_en timestamptz`,
      );
      await previa.cliente.query(
        `create table autenticacion.intento_segundo_factor (id uuid primary key default gen_random_uuid(), usuario_id uuid not null references autenticacion."user" (id) on delete cascade, fallo_en timestamptz not null)`,
      );
      await previa.cliente.query(
        `insert into autenticacion.intento_segundo_factor (usuario_id, fallo_en) values ($1, now())`,
        [usuario],
      );
      await aplicarMigraciones(previa.aparte.base.dueno, conMia);
      const { rows } = await previa.cliente.query(
        `select 1 from autenticacion.intento_segundo_factor`,
      );
      expect(rows).toHaveLength(1);
      const { nuevas } = diferencias(
        { tablas: [] },
        { tablas: (await catalogoDeAutenticacion(previa.cliente))["tablas"] ?? [] },
      );
      expect(nuevas["tablas"]).toContain("twoFactor:rls=t:forzada=t");
    });
  });

  // ===========================================================================================================
  // Guardas
  // ===========================================================================================================
  it("exige el esquema de 0010: sin él se frena con un mensaje claro y no deja nada registrado", async () => {
    const aparte = await baseConMigraciones(b(), HASTA_0006);
    const carpeta = await carpetaCon([...HASTA_0006, await archivoDeLaMigracion()]);
    try {
      await expect(aplicarMigraciones(aparte.aparte.base.dueno, carpeta)).rejects.toThrow(
        /el segundo factor requiere 0010_autenticacion aplicada antes/,
      );
      const { rows } = await aparte.cliente.query<{ nombre: string }>(
        `select nombre from migracion where nombre like '%${SUFIJO}%'`,
      );
      expect(rows).toEqual([]);
      const { rows: tablas } = await aparte.cliente.query(
        `select 1 from pg_namespace where nspname = 'autenticacion'`,
      );
      expect(tablas).toEqual([]);
    } finally {
      await rm(carpeta, { recursive: true, force: true });
      await aparte.cerrar();
    }
  });

  it("sin el rol de la librería (0004) también se frena, con su propio mensaje", async () => {
    const aparte = await crearBaseAparte(b(), { migrar: false });
    const cliente = new pg.Client({ connectionString: aparte.base.dueno });
    await cliente.connect();
    try {
      // Una base de otra instalación donde el rol no existe: se simula quitándolo para esta sentencia.
      const sql = (await textoDeLaMigracion()).replace(
        "SELECT 1 FROM pg_roles WHERE rolname = 'zuluhub_autenticacion'",
        "SELECT 1 FROM pg_roles WHERE rolname = 'zuluhub_autenticacion_inexistente'",
      );
      await expect(cliente.query(sql)).rejects.toMatchObject({
        code: "55000",
        message: expect.stringMatching(/falta el rol zuluhub_autenticacion/) as string,
      });
    } finally {
      await cliente.end();
      await aparte.destruir();
    }
  });

  // ===========================================================================================================
  // El catálogo con los roles reales (la base compartida ya trae 0015)
  // ===========================================================================================================
  describe("después de migrar, con los roles reales", () => {
    let completa: Awaited<ReturnType<typeof crearBaseAparte>>;
    let dueno: pg.Client;

    beforeAll(async () => {
      completa = await crearBaseAparte(b());
      dueno = new pg.Client({ connectionString: completa.base.dueno });
      await dueno.connect();
    });
    afterAll(async () => {
      await dueno.end();
      await completa.destruir();
    });

    it("ningún otro rol ni PUBLIC toca las tablas nuevas, y el de la librería no puede crear nada en su esquema", async () => {
      for (const rol of [
        "zuluhub_app",
        "zuluhub_grupo",
        "zuluhub_trabajos",
        "zuluhub_plataforma",
        "zuluhub_publico",
        "zuluhub_captacion",
      ]) {
        for (const tabla of TABLAS_NUEVAS) {
          const { rows } = await dueno.query<{ puede: boolean }>(
            `select (has_table_privilege($1, format('autenticacion.%I', $2::text), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                     or has_any_column_privilege($1, format('autenticacion.%I', $2::text), 'SELECT,INSERT,UPDATE,REFERENCES')) as puede`,
            [rol, tabla],
          );
          expect(rows[0]?.puede, `${rol} sobre autenticacion.${tabla}`).toBe(false);
        }
      }
      const { rows: publico } = await dueno.query(
        `select 1 from pg_class c, aclexplode(c.relacl) a
          where c.relnamespace = 'autenticacion'::regnamespace and c.relkind = 'r' and a.grantee = 0`,
      );
      expect(publico).toEqual([]);
      for (const tabla of TABLAS_NUEVAS) {
        const { rows } = await dueno.query<{ truncate: boolean; refs: boolean; trigger: boolean }>(
          `select has_table_privilege('zuluhub_autenticacion', format('autenticacion.%I', $1::text), 'TRUNCATE') as truncate,
                  has_table_privilege('zuluhub_autenticacion', format('autenticacion.%I', $1::text), 'REFERENCES') as refs,
                  has_table_privilege('zuluhub_autenticacion', format('autenticacion.%I', $1::text), 'TRIGGER') as trigger`,
          [tabla],
        );
        expect(rows[0], tabla).toEqual({ truncate: false, refs: false, trigger: false });
      }
    });

    it("el rol de la librería: `twoFactor` solo lee, da de alta y cambia TRES columnas; nunca borra (ni usuarios ni cuentas, 0013)", async () => {
      const u = await crearUsuarioDeBase(dueno);
      await dueno.query(
        `insert into autenticacion."twoFactor" (secret, "backupCodes", "userId") values ('c', '[]', $1)`,
        [u.id],
      );
      await comoRol(completa.base.autenticacion, async (c) => {
        expect(await codigoDe(c.query(`select secret from autenticacion."twoFactor"`))).toBeNull();
        expect(
          await codigoDe(
            c.query(
              `insert into autenticacion."twoFactor" (secret, "backupCodes", "userId") values ('d', '[]', $1)`,
              [u.id],
            ),
          ),
        ).toBe(
          "23505", // una sola fila de segundo factor por usuario (índice único)
        );
        expect(
          await codigoDe(
            c.query(
              `update autenticacion."twoFactor" set secret = 'e', "backupCodes" = '[]', verified = true`,
            ),
          ),
        ).toBeNull();
        for (const columna of [
          `"userId" = gen_random_uuid()`,
          `id = gen_random_uuid()`,
          `"failedVerificationCount" = 1`,
          `"lockedUntil" = now()`,
        ]) {
          expect(
            await codigoDe(c.query(`update autenticacion."twoFactor" set ${columna}`)),
            columna,
          ).toBe("42501");
        }
        expect(await codigoDe(c.query(`delete from autenticacion."twoFactor"`))).toBe("42501");
        expect(await codigoDe(c.query(`delete from autenticacion."user"`))).toBe("42501");
      });
    });

    it("un usuario tiene una sola fila de segundo factor, un paso de TOTP se usa una sola vez y los pasos y fallos son de un usuario que existe", async () => {
      const u = await crearUsuarioDeBase(dueno);
      await dueno.query(
        `insert into autenticacion."twoFactor" (secret, "backupCodes", "userId") values ('c', '[]', $1)`,
        [u.id],
      );
      await expect(
        dueno.query(
          `insert into autenticacion."twoFactor" (secret, "backupCodes", "userId") values ('d', '[]', $1)`,
          [u.id],
        ),
      ).rejects.toMatchObject({ code: "23505" });
      await dueno.query(
        `insert into autenticacion.codigo_totp_usado (usuario_id, paso) values ($1, 7)`,
        [u.id],
      );
      await expect(
        dueno.query(
          `insert into autenticacion.codigo_totp_usado (usuario_id, paso) values ($1, 7)`,
          [u.id],
        ),
      ).rejects.toMatchObject({
        code: "23505",
      });
      await expect(
        dueno.query(
          `insert into autenticacion.codigo_totp_usado (usuario_id, paso) values ($1, -1)`,
          [u.id],
        ),
      ).rejects.toMatchObject({
        code: "23514",
      });
      for (const texto of [
        `insert into autenticacion.codigo_totp_usado (usuario_id, paso) values (gen_random_uuid(), 1)`,
        `insert into autenticacion.intento_segundo_factor (usuario_id, fallo_en) values (gen_random_uuid(), now())`,
        `insert into autenticacion."twoFactor" (secret, "backupCodes", "userId") values ('c', '[]', gen_random_uuid())`,
      ]) {
        await expect(dueno.query(texto)).rejects.toMatchObject({ code: "23503" });
      }
      // `verified` nace en falso y `twoFactorEnabled` también (un estado dudoso es «no verificado»).
      const v = await dueno.query<{ v: boolean }>(
        `select verified as v from autenticacion."twoFactor" where "userId" = $1`,
        [u.id],
      );
      expect(v.rows[0]?.v).toBe(false);
      await expect(
        dueno.query(
          `insert into autenticacion."twoFactor" (secret, "backupCodes", "userId", verified) select 'z', '[]', id, null from autenticacion."user" limit 1`,
        ),
      ).rejects.toMatchObject({
        code: "23502",
      });
      await expect(
        dueno.query(`update autenticacion."user" set "twoFactorEnabled" = null where id = $1`, [
          u.id,
        ]),
      ).rejects.toMatchObject({
        code: "23502",
      });
    });

    it("la RLS FORZADA vale aun para el dueño de las tablas: sin la política del rol no ve filas", async () => {
      const u = await crearUsuarioDeBase(dueno);
      await dueno.query(
        `insert into autenticacion.codigo_totp_usado (usuario_id, paso) values ($1, 11)`,
        [u.id],
      );
      // El dueño evade RLS por ser superusuario de la prueba; lo que se comprueba es el atributo en el catálogo.
      const { rows } = await dueno.query<{ n: string; f: boolean; r: boolean }>(
        `select relname as n, relforcerowsecurity as f, relrowsecurity as r from pg_class
          where relnamespace = 'autenticacion'::regnamespace and relname = any($1)`,
        [[...TABLAS_NUEVAS]],
      );
      expect(rows).toHaveLength(3);
      for (const t of rows) expect([t.n, t.f, t.r]).toEqual([t.n, true, true]);
    });

    it("la web de empresa sigue funcionando: sus consultas no tocan lo nuevo y el rol de la librería sigue sin ver tablas de negocio", async () => {
      await comoRol(completa.base.autenticacion, async (c) => {
        for (const tabla of [
          "persona",
          "empresa",
          "tenant",
          "membresia",
          "marca",
          "admin_plataforma",
        ]) {
          expect(await codigoDe(c.query(`select 1 from ${tabla}`)), tabla).toBe("42501");
        }
        // Un alta de usuario como la hace la instancia de empresa (sin las columnas nuevas): toma los valores por defecto.
        const { rows } = await c.query<{ e: boolean }>(
          `insert into autenticacion."user" (name, email, "emailVerified") values ('N', $1, true) returning "twoFactorEnabled" as e`,
          [`${randomUUID()}@ejemplo.test`],
        );
        expect(rows[0]?.e).toBe(false);
        const { rows: sesion } = await c.query<{ m: Date | null }>(
          `insert into autenticacion.session ("expiresAt", token, "userId", host) select now() + interval '1 hour', $1, id, 'app.example.test' from autenticacion."user" limit 1 returning segundo_factor_en as m`,
          [randomUUID()],
        );
        expect(sesion[0]?.m).toBeNull();
      });
    });
  });

  // ===========================================================================================================
  // Lo que promete el texto
  // ===========================================================================================================
  describe("el texto de la migración promete lo que hace", () => {
    it("la cabecera declara lo que es: aditiva, repetible, con su reversión destructiva y protegida, y lo que cambió de lo que exporta la librería", async () => {
      const completo = await textoDeLaMigracion();
      const plano = completo.replace(/\n--\s*/g, " ");
      expect(plano).toMatch(/Es ADITIVA/);
      expect(plano).toMatch(/Es REPETIBLE/);
      expect(plano).toMatch(/DESTRUCTIVA/);
      expect(plano).toMatch(/getMigrations\(\.\.\.\)\.compileMigrations\(\)/);
      expect(plano).toMatch(/se quitó `create schema if not exists/);
      expect(plano).toMatch(/NOT NULL DEFAULT false/);
      expect(plano).toMatch(/NINGUNA función SECURITY DEFINER/);
      expect(completo).toContain(`reversiones/${await archivoDeLaReversion()}`);
    });

    it("el código no crea esquemas ni funciones, no borra datos, no da LOGIN ni contraseñas ni cadenas de conexión", async () => {
      const codigo = (await textoDeLaMigracion()).replace(/--.*$/gm, "");
      expect(codigo).not.toMatch(/\bCREATE\s+SCHEMA\b/i);
      expect(codigo).not.toMatch(/\bCREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b/i);
      expect(codigo).not.toMatch(/\bCREATE\s+(OR\s+REPLACE\s+)?TRIGGER\b/i);
      expect(codigo).not.toMatch(/\bSECURITY\s+DEFINER\b/i);
      expect(codigo).not.toMatch(/\b(DROP|TRUNCATE)\b/i);
      expect(codigo).not.toMatch(/\bDELETE\s+FROM\b/i);
      expect(codigo).not.toMatch(/\bUPDATE\s+\S+\s+SET\b/i);
      expect(codigo).not.toMatch(/\bLOGIN\b/i);
      expect(codigo).not.toMatch(/\bPASSWORD\s+'/i);
      expect(codigo).not.toMatch(/postgres(ql)?:\/\//i);
      // Nada para PUBLIC y ningún privilegio a otro rol que el de la librería.
      expect(
        codigo.match(/\bTO\s+(\w+)/gi)?.map((x) => x.replace(/\s+/g, " ").toLowerCase()),
      ).toEqual(expect.arrayContaining(["to zuluhub_autenticacion"]));
      for (const m of codigo.matchAll(/\bTO\s+(\w+)/gi)) expect(m[1]).toBe("zuluhub_autenticacion");
      // Las columnas de la librería con datos no se tocan salvo para agregar las dos nuevas.
      expect(
        [...codigo.matchAll(/\bALTER\s+TABLE\s+(\S+)\s+ADD\s+COLUMN/gi)].map((m) => m[1]),
      ).toEqual(['autenticacion."user"', "autenticacion.session"]);
    });

    it("la reversión está protegida: cuenta lo que borraría, exige confirmación explícita y dice cómo correrla", async () => {
      const texto = await textoDeLaReversion();
      expect(texto).toMatch(/DESTRUCTIVA/);
      expect(texto).toMatch(/NO lo aplica el ejecutor de migraciones/);
      expect(texto).toMatch(/BEGIN;/);
      expect(texto).toMatch(/SET LOCAL zuluhub\.confirmar_reversion = 'SI'/);
      expect(texto).toMatch(/AVISAR AL DUEÑO/);
      const codigo = texto.replace(/--.*$/gm, "");
      expect(codigo).not.toMatch(/\bCASCADE\b/i);
      expect(codigo).toMatch(/current_setting\('zuluhub\.confirmar_reversion', true\)/);
    });
  });

  // ===========================================================================================================
  // Reversión
  // ===========================================================================================================
  describe("la reversión (script aparte, destructiva y protegida)", () => {
    const revertir = async (c: pg.Client, confirmar: boolean) => {
      await c.query("begin");
      try {
        if (confirmar) await c.query("SET LOCAL zuluhub.confirmar_reversion = 'SI'");
        await c.query(await textoDeLaReversion());
        await c.query("commit");
      } catch (e) {
        await c.query("rollback");
        throw e;
      }
    };
    /** Datos del segundo factor: un secreto, un paso usado, un fallo, un usuario con segundo factor y una sesión marcada. */
    async function sembrarSegundoFactor(c: pg.Client): Promise<string> {
      const u = await crearUsuarioDeBase(c);
      await c.query(
        `insert into autenticacion."twoFactor" (secret, "backupCodes", "userId", verified) values ('cifrado', '["h1:x"]', $1, true)`,
        [u.id],
      );
      await c.query(
        `insert into autenticacion.codigo_totp_usado (usuario_id, paso) values ($1, 1)`,
        [u.id],
      );
      await c.query(
        `insert into autenticacion.intento_segundo_factor (usuario_id, fallo_en) values ($1, now())`,
        [u.id],
      );
      await c.query(`update autenticacion."user" set "twoFactorEnabled" = true where id = $1`, [
        u.id,
      ]);
      await c.query(
        `insert into autenticacion.session ("expiresAt", token, "userId", host, segundo_factor_en) values (now() + interval '1 hour', $1, $2, 'consola.example.test', now())`,
        [randomUUID(), u.id],
      );
      return u.id;
    }

    it("sin datos de segundo factor deja el catálogo EXACTAMENTE como estaba antes, borra la fila del ejecutor, se puede repetir y la migración se puede volver a aplicar", async () => {
      await conPrevias(async (previa, conMia) => {
        await sembrarDatosPrevios(previa.cliente);
        const autenticacionAntes = await catalogoDeAutenticacion(previa.cliente);
        const publicoAntes = await huellaDeCatalogo(previa.cliente);
        const { rows: registroAntes } = await previa.cliente.query(
          "select nombre, checksum from migracion order by 1",
        );
        await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        expect(await catalogoDeAutenticacion(previa.cliente)).not.toEqual(autenticacionAntes);
        const datosConLaMigracion = await huellaDeDatos(previa.cliente);

        await revertir(previa.cliente, false);
        expect(await catalogoDeAutenticacion(previa.cliente)).toEqual(autenticacionAntes);
        expect(await huellaDeCatalogo(previa.cliente)).toEqual(publicoAntes);
        expect(
          (await previa.cliente.query("select nombre, checksum from migracion order by 1")).rows,
        ).toEqual(registroAntes);
        expect(await huellaDeDatos(previa.cliente)).toEqual(datosConLaMigracion);

        // Repetirla no falla ni cambia nada.
        await revertir(previa.cliente, false);
        expect(await catalogoDeAutenticacion(previa.cliente)).toEqual(autenticacionAntes);

        // Y la migración se puede aplicar otra vez.
        const otra = await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        expect(otra.aplicadas).toEqual([await archivoDeLaMigracion()]);
      });
    });

    it("CON datos de segundo factor NO borra nada sin la confirmación: dice cuántos datos perdería y no cambia el catálogo", async () => {
      await conPrevias(async (previa, conMia) => {
        await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        await sembrarSegundoFactor(previa.cliente);
        const antes = await catalogoDeAutenticacion(previa.cliente);
        const datos = await huellaDeDatos(previa.cliente);
        await expect(revertir(previa.cliente, false)).rejects.toMatchObject({
          code: "55000",
          message: expect.stringMatching(
            /1 secretos, 1 usuarios con segundo factor, 1 sesiones marcadas, 1 pasos usados, 1 intentos.*zuluhub\.confirmar_reversion/,
          ) as string,
        });
        expect(await catalogoDeAutenticacion(previa.cliente)).toEqual(antes);
        expect(await huellaDeDatos(previa.cliente)).toEqual(datos);
        const { rows } = await previa.cliente.query(`select 1 from autenticacion."twoFactor"`);
        expect(rows).toHaveLength(1);
        // Una confirmación con otro valor tampoco alcanza.
        await previa.cliente.query("begin");
        await previa.cliente.query("SET LOCAL zuluhub.confirmar_reversion = 'si'");
        await expect(previa.cliente.query(await textoDeLaReversion())).rejects.toMatchObject({
          code: "55000",
        });
        await previa.cliente.query("rollback");
      });
    });

    it("cada uno de los cinco tipos de dato pide la confirmación por sí solo", async () => {
      await conPrevias(async (previa, conMia) => {
        await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        const u = await crearUsuarioDeBase(previa.cliente);
        const casos: [string, string][] = [
          [
            "un secreto",
            `insert into autenticacion."twoFactor" (secret, "backupCodes", "userId") values ('c', '[]', '${u.id}')`,
          ],
          [
            "un paso usado",
            `insert into autenticacion.codigo_totp_usado (usuario_id, paso) values ('${u.id}', 1)`,
          ],
          [
            "un intento",
            `insert into autenticacion.intento_segundo_factor (usuario_id, fallo_en) values ('${u.id}', now())`,
          ],
          [
            "un usuario con segundo factor",
            `update autenticacion."user" set "twoFactorEnabled" = true where id = '${u.id}'`,
          ],
          [
            "una sesión marcada",
            `insert into autenticacion.session ("expiresAt", token, "userId", host, segundo_factor_en) values (now() + interval '1 hour', '${randomUUID()}', '${u.id}', 'h.example.test', now())`,
          ],
        ];
        const limpiar = [
          `delete from autenticacion."twoFactor"`,
          `delete from autenticacion.codigo_totp_usado`,
          `delete from autenticacion.intento_segundo_factor`,
          `update autenticacion."user" set "twoFactorEnabled" = false`,
          `delete from autenticacion.session`,
        ];
        for (const [nombre, sembrar] of casos) {
          await previa.cliente.query(sembrar);
          await expect(revertir(previa.cliente, false), nombre).rejects.toMatchObject({
            code: "55000",
          });
          for (const l of limpiar) await previa.cliente.query(l);
        }
      });
    });

    it("CON la confirmación borra solo lo del segundo factor: la base queda como antes de 0015 y el resto de los datos intactos", async () => {
      await conPrevias(async (previa, conMia) => {
        await sembrarDatosPrevios(previa.cliente);
        const autenticacionAntes = await catalogoDeAutenticacion(previa.cliente);
        const publicoAntes = await huellaDeCatalogo(previa.cliente);
        await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        await sembrarSegundoFactor(previa.cliente);
        // Los datos que NO son del segundo factor, medidos sin las columnas de 0015 y sin el usuario que sembró el segundo factor.
        const usuariosAntes = Number(
          (
            await previa.cliente.query<{ n: string }>(
              `select count(*) as n from autenticacion."user"`,
            )
          ).rows[0]?.n,
        );
        const sesionesAntes = Number(
          (
            await previa.cliente.query<{ n: string }>(
              `select count(*) as n from autenticacion.session`,
            )
          ).rows[0]?.n,
        );
        await revertir(previa.cliente, true);
        expect(await catalogoDeAutenticacion(previa.cliente)).toEqual(autenticacionAntes);
        expect(await huellaDeCatalogo(previa.cliente)).toEqual(publicoAntes);
        // Los usuarios y las sesiones siguen (con la sesión marcada también: solo se fue su columna).
        expect(
          Number(
            (
              await previa.cliente.query<{ n: string }>(
                `select count(*) as n from autenticacion."user"`,
              )
            ).rows[0]?.n,
          ),
        ).toBe(usuariosAntes);
        expect(
          Number(
            (
              await previa.cliente.query<{ n: string }>(
                `select count(*) as n from autenticacion.session`,
              )
            ).rows[0]?.n,
          ),
        ).toBe(sesionesAntes);
        // La reversión borró la fila del ejecutor: el ejecutor vuelve a aplicarla.
        const otra = await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        expect(otra.aplicadas).toEqual([await archivoDeLaMigracion()]);
      });
    });

    it("necesita un rol que evada RLS (si no, el conteo no vería nada y borraría sin avisar): con otro rol se frena", async () => {
      await conPrevias(async (previa, conMia) => {
        await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        await sembrarSegundoFactor(previa.cliente);
        await comoRol(previa.aparte.base.plataforma, async (c) => {
          await expect(c.query(await textoDeLaReversion())).rejects.toMatchObject({
            code: "55000",
            message: expect.stringMatching(/necesita que el rol que la corre evada RLS/) as string,
          });
        });
        const { rows } = await previa.cliente.query(`select 1 from autenticacion."twoFactor"`);
        expect(rows).toHaveLength(1);
      });
    });

    it("revertida, la librería de empresa sigue entrando: el rol de autenticación inserta usuarios y sesiones como antes", async () => {
      await conPrevias(async (previa, conMia) => {
        await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        await revertir(previa.cliente, false);
        await comoRol(previa.aparte.base.autenticacion, async (c) => {
          const { rows } = await c.query<{ id: string }>(
            `insert into autenticacion."user" (name, email, "emailVerified") values ('N', $1, true) returning id`,
            [`${randomUUID()}@ejemplo.test`],
          );
          await c.query(
            `insert into autenticacion.session ("expiresAt", token, "userId", host) values (now() + interval '1 hour', $1, $2, 'app.example.test')`,
            [randomUUID(), rows[0]?.id],
          );
        });
      });
    });
  });
});
