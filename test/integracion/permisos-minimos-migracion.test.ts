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
 * Permisos mínimos (0013): la migración que le da a la aplicación lo MÍNIMO para leer la tabla de control
 * `migracion` (`SELECT (nombre)`, para la guarda «En mantenimiento» de la web) y le quita a la librería de
 * autenticación el `DELETE` sobre `user` y `account` (ningún camino borra usuarios ni cuentas). Cambian solo
 * privilegios: se prueba sobre una base CON DATOS que ni una fila se mueve, el catálogo EXACTO de lo que cada rol
 * puede después, la reversión (devuelve los privilegios de antes, sin pérdida de datos), que repetirla no cambia
 * nada, sus guardas y lo que promete el texto del archivo.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const SUFIJO = "permisos_minimos";
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

const TABLAS_DE_AUTENTICACION = [
  "account",
  "rateLimit",
  "session",
  "user",
  "verification",
] as const;
const ROLES_SIN_ACCESO_A_MIGRACION = [
  "zuluhub_autenticacion",
  "zuluhub_captacion",
  "zuluhub_grupo",
  "zuluhub_plataforma",
  "zuluhub_publico",
  "zuluhub_trabajos",
] as const;

/** El código de error de una consulta que se espera denegada (`null` si salió bien). */
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

/** Contenido de cada tabla de `public` y de `autenticacion` (salvo el registro del ejecutor): ni una fila puede cambiar. */
async function huellaDeDatos(c: pg.Client): Promise<Record<string, string>> {
  const { rows: tablas } = await c.query<{ t: string }>(
    `select format('%I.%I', n.nspname, c.relname) as t
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'autenticacion') and c.relkind = 'r' and c.relname <> 'migracion'
      order by 1`,
  );
  const r: Record<string, string> = {};
  for (const { t } of tablas) {
    const { rows } = await c.query<{ h: string }>(
      `select coalesce(md5(string_agg((to_jsonb(x))::text, '|' order by (to_jsonb(x))::text)), '-') as h from ${t} x`,
    );
    r[t] = rows[0]?.h as string;
  }
  return r;
}

/** Los privilegios (de tabla y por columna) de las cinco tablas de la librería: lo que 0013 toca fuera de `public`. */
async function privilegiosDeAutenticacion(c: pg.Client): Promise<Record<string, string>> {
  const { rows } = await c.query<{ t: string; acl: string }>(
    `select c.relname as t,
            coalesce(c.relacl::text, '') || '|' ||
            coalesce((select string_agg(a.attname || '=' || a.attacl::text, ',' order by a.attname)
                        from pg_attribute a where a.attrelid = c.oid and a.attacl is not null), '') as acl
       from pg_class c where c.relnamespace = 'autenticacion'::regnamespace and c.relkind = 'r' order by 1`,
  );
  return Object.fromEntries(rows.map((f) => [f.t, f.acl]));
}

/** Filas en las cinco tablas de la librería, armadas por el dueño. */
async function sembrarAutenticacion(c: pg.Client): Promise<{ usuario: string; cuenta: string }> {
  const usuario = await crearUsuarioDeBase(c);
  const { rows: cuenta } = await c.query<{ id: string }>(
    `insert into autenticacion.account ("accountId", "providerId", "userId")
     values ($1, 'google', $2) returning id`,
    [randomUUID(), usuario.id],
  );
  await c.query(
    `insert into autenticacion.session ("expiresAt", token, "userId", host)
     values (now() + interval '1 hour', $1, $2, 'app.zuluhub.test')`,
    [randomUUID(), usuario.id],
  );
  await c.query(
    `insert into autenticacion.verification (identifier, value, "expiresAt")
     values ($1, 'v', now() + interval '1 hour')`,
    [randomUUID()],
  );
  await c.query(
    `insert into autenticacion."rateLimit" (key, count, "lastRequest") values ($1, 1, 1)`,
    [randomUUID()],
  );
  return { usuario: usuario.id, cuenta: cuenta[0]?.id as string };
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

describe.skipIf(base === null)(
  "permisos mínimos: la migración 0013 (lectura de `migracion` y DELETE de la librería de autenticación)",
  () => {
    const b = () => base as BaseDePruebas;

    /** Una base con las migraciones ANTERIORES a la mía y la carpeta que suma la mía. */
    async function conPrevias<T>(
      trabajo: (x: Awaited<ReturnType<typeof baseConMigraciones>>, con: string) => Promise<T>,
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
    // Sobre una base con datos: solo cambian privilegios, y exactamente los dos prometidos
    // ===========================================================================================================
    it("sobre una base con datos no cambia NI UN dato; en el catálogo solo agrega `SELECT (nombre)` de migracion a la aplicación y quita DELETE de user y account a la librería", async () => {
      await conPrevias(async (previa, conMia) => {
        await sembrarAutenticacion(previa.cliente);
        const datosAntes = await huellaDeDatos(previa.cliente);
        const catalogoAntes = await huellaDeCatalogo(previa.cliente);
        const autenticacionAntes = await privilegiosDeAutenticacion(previa.cliente);

        const r = await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        expect(r.aplicadas).toEqual([await archivoDeLaMigracion()]);

        expect(await huellaDeDatos(previa.cliente)).toEqual(datosAntes);

        // `public`: ninguna categoría cambia salvo el privilegio por columna, donde aparece UNA línea nueva.
        const { nuevas, perdidas } = diferencias(
          catalogoAntes,
          await huellaDeCatalogo(previa.cliente),
        );
        for (const categoria of Object.keys(nuevas)) {
          if (categoria === "privilegiosPorColumna") continue;
          expect(nuevas[categoria], `${categoria}: líneas nuevas`).toEqual([]);
          expect(perdidas[categoria], `${categoria}: líneas perdidas`).toEqual([]);
        }
        expect(perdidas["privilegiosPorColumna"]).toEqual([]);
        expect(nuevas["privilegiosPorColumna"]).toHaveLength(1);
        expect((nuevas["privilegiosPorColumna"] as string[])[0]).toMatch(
          /^migracion\.nombre:\{zuluhub_app=r\/[^,}]+\}$/,
        );

        // `autenticacion`: cambian user y account (pierden la `d` del rol de la librería) y nada más.
        const autenticacionDespues = await privilegiosDeAutenticacion(previa.cliente);
        for (const tabla of TABLAS_DE_AUTENTICACION) {
          if (tabla === "user" || tabla === "account") {
            expect(autenticacionDespues[tabla], tabla).not.toEqual(autenticacionAntes[tabla]);
            expect(autenticacionAntes[tabla], tabla).toMatch(/zuluhub_autenticacion=arwd\//);
            expect(autenticacionDespues[tabla], tabla).toMatch(/zuluhub_autenticacion=arw\//);
            expect(autenticacionDespues[tabla]?.replace("=arw/", "=arwd/"), tabla).toBe(
              autenticacionAntes[tabla],
            );
          } else {
            expect(autenticacionDespues[tabla], tabla).toEqual(autenticacionAntes[tabla]);
          }
        }
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
        const catalogo = await huellaDeCatalogo(previa.cliente);
        const autenticacion = await privilegiosDeAutenticacion(previa.cliente);

        // El ejecutor de nuevo: nada que aplicar, nada que cambie.
        expect(await aplicarMigraciones(previa.aparte.base.dueno, conMia)).toEqual({
          aplicadas: [],
          yaAplicadas: [...(await migracionesPrevias()), mia],
        });
        // El archivo corrido a mano otra vez (lo que el ejecutor jamás hace) tampoco falla ni cambia nada.
        const sql = await textoDeLaMigracion();
        await previa.cliente.query(sql);
        await previa.cliente.query(sql);
        expect(await huellaDeCatalogo(previa.cliente)).toEqual(catalogo);
        expect(await privilegiosDeAutenticacion(previa.cliente)).toEqual(autenticacion);
      });
    });

    it("aunque alguien le haya concedido de más a mano (SELECT de toda la tabla), el resultado es EXACTAMENTE `SELECT (nombre)`", async () => {
      await conPrevias(async (previa, conMia) => {
        await previa.cliente.query(
          "grant select, insert, update, delete on migracion to zuluhub_app",
        );
        await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        await comoRol(previa.aparte.base.app, async (app) => {
          expect(await codigoDe(app.query("select nombre from migracion"))).toBeNull();
          for (const texto of [
            "select checksum from migracion",
            "select aplicada_en from migracion",
            "select * from migracion",
            "insert into migracion (nombre, checksum) values ('9999_x.sql', 'x')",
            "update migracion set nombre = nombre",
            "delete from migracion",
          ]) {
            expect(await codigoDe(app.query(texto)), texto).toBe("42501");
          }
        });
      });
    });

    // ===========================================================================================================
    // Guardas
    // ===========================================================================================================
    it("exige 0010: sin el esquema de la librería se frena con un mensaje claro y no deja nada registrado", async () => {
      const aparte = await baseConMigraciones(b(), HASTA_0006);
      const carpeta = await carpetaCon([...HASTA_0006, await archivoDeLaMigracion()]);
      try {
        await expect(aplicarMigraciones(aparte.aparte.base.dueno, carpeta)).rejects.toThrow(
          /0013 requiere 0010_autenticacion aplicada antes/,
        );
        const { rows } = await aparte.cliente.query<{ nombre: string }>(
          `select nombre from migracion where nombre like '%${SUFIJO}%'`,
        );
        expect(rows).toEqual([]);
      } finally {
        await rm(carpeta, { recursive: true, force: true });
        await aparte.cerrar();
      }
    });

    it("corrida a mano sobre una base sin tabla de control, se frena (el ejecutor es quien la crea)", async () => {
      const aparte = await crearBaseAparte(b(), { migrar: false });
      const cliente = new pg.Client({ connectionString: aparte.base.dueno });
      await cliente.connect();
      try {
        await expect(cliente.query(await textoDeLaMigracion())).rejects.toMatchObject({
          code: "55000",
          message: expect.stringMatching(/tabla de control `migracion`/) as string,
        });
      } finally {
        await cliente.end();
        await aparte.destruir();
      }
    });

    // ===========================================================================================================
    // El catálogo EXACTO y el comportamiento con los roles reales (la base compartida ya trae 0013)
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

      it("la aplicación lee de `migracion` EXACTAMENTE la columna `nombre`, solo con SELECT; ningún otro rol ni PUBLIC la toca", async () => {
        const { rows } = await dueno.query<{ c: string; p: string }>(
          `select column_name as c, privilege_type as p from information_schema.column_privileges
            where grantee = 'zuluhub_app' and table_schema = 'public' and table_name = 'migracion' order by 1, 2`,
        );
        expect(rows).toEqual([{ c: "nombre", p: "SELECT" }]);
        // Ni un privilegio de TABLA (un SELECT de tabla entera daría también `checksum`).
        const { rows: deTabla } = await dueno.query(
          `select 1 from information_schema.table_privileges
            where grantee = 'zuluhub_app' and table_schema = 'public' and table_name = 'migracion'`,
        );
        expect(deTabla).toEqual([]);
        for (const rol of ROLES_SIN_ACCESO_A_MIGRACION) {
          const { rows: t } = await dueno.query<{ puede: boolean }>(
            `select (has_table_privilege($1, 'public.migracion', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                     or has_any_column_privilege($1, 'public.migracion', 'SELECT,INSERT,UPDATE,REFERENCES')) as puede`,
            [rol],
          );
          expect(t[0]?.puede, rol).toBe(false);
        }
        expect(
          (
            await dueno.query(
              `select 1 from pg_class c, aclexplode(c.relacl) a
                where c.oid = 'public.migracion'::regclass and a.grantee = 0`,
            )
          ).rows,
        ).toEqual([]);
      });

      it("la consulta exacta de la guarda de la web devuelve la última migración; el resto de la tabla, escribirla o borrarla da 42501", async () => {
        const ultima = (await archivos()).filter((n) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n)).at(-1);
        await comoRol(completa.base.app, async (app) => {
          const { rows } = await app.query<{ nombre: string }>(
            "SELECT nombre FROM migracion ORDER BY nombre DESC LIMIT 1",
          );
          // Sin RLS que la filtre a cero filas: ve lo que el dueño ve.
          expect(rows).toEqual([{ nombre: ultima }]);
          const { rows: todas } = await app.query<{ n: string }>(
            "select count(*)::text as n from migracion",
          );
          const { rows: lasDelDueno } = await dueno.query<{ n: string }>(
            "select count(*)::text as n from migracion",
          );
          expect(todas[0]?.n).toBe(lasDelDueno[0]?.n);
          for (const texto of [
            "select checksum from migracion",
            "select aplicada_en from migracion",
            "select nombre, checksum from migracion",
            "select nombre from migracion where checksum <> ''",
            "select * from migracion",
            "insert into migracion (nombre, checksum) values ('9999_x.sql', 'x')",
            "update migracion set nombre = nombre",
            "delete from migracion",
            "truncate migracion",
          ]) {
            expect(await codigoDe(app.query(texto)), texto).toBe("42501");
          }
        });
        // Nada cambió en la tabla.
        const { rows } = await dueno.query<{ n: string }>(
          "select count(*)::text as n from migracion where nombre = '9999_x.sql'",
        );
        expect(rows[0]?.n).toBe("0");
      });

      it("ningún otro rol puede leer `migracion` (42501)", async () => {
        const url: Record<(typeof ROLES_SIN_ACCESO_A_MIGRACION)[number], string> = {
          zuluhub_autenticacion: completa.base.autenticacion,
          zuluhub_captacion: completa.base.captacion,
          zuluhub_grupo: completa.base.grupo,
          zuluhub_plataforma: completa.base.plataforma,
          zuluhub_publico: completa.base.publico,
          zuluhub_trabajos: completa.base.trabajos,
        };
        for (const rol of ROLES_SIN_ACCESO_A_MIGRACION) {
          await comoRol(url[rol], async (c) => {
            expect(await codigoDe(c.query("select nombre from migracion")), rol).toBe("42501");
          });
        }
      });

      it("la librería de autenticación ya NO borra usuarios ni cuentas (42501, la fila sigue) y SIGUE borrando sesiones, verificaciones y contadores", async () => {
        const { usuario, cuenta } = await sembrarAutenticacion(dueno);
        await comoRol(completa.base.autenticacion, async (auth) => {
          expect(
            await codigoDe(auth.query(`delete from autenticacion."user" where id = $1`, [usuario])),
          ).toBe("42501");
          expect(
            await codigoDe(auth.query(`delete from autenticacion.account where id = $1`, [cuenta])),
          ).toBe("42501");
          expect(await codigoDe(auth.query(`delete from autenticacion."user"`))).toBe("42501");
          expect(await codigoDe(auth.query(`delete from autenticacion.account`))).toBe("42501");
          // Lo demás de esas dos tablas sigue: leer, dar de alta y cambiar (alta de usuario, cuenta nueva, renovación).
          const { rows: leido } = await auth.query(
            `select id from autenticacion."user" where id = $1`,
            [usuario],
          );
          expect(leido).toHaveLength(1);
          await auth.query(`update autenticacion."user" set name = 'Otro nombre' where id = $1`, [
            usuario,
          ]);
          await auth.query(`update autenticacion.account set scope = 'openid' where id = $1`, [
            cuenta,
          ]);
          const { rows: alta } = await auth.query<{ id: string }>(
            `insert into autenticacion."user" (name, email, "emailVerified") values ('N', $1, true) returning id`,
            [`${randomUUID()}@zuluhub.test`],
          );
          expect(alta).toHaveLength(1);

          // Donde sí se usa, borra: el barrido de vencidos y la rotación/cierre de sesión.
          for (const tabla of ["session", "verification", `"rateLimit"`]) {
            const r = await auth.query(`delete from autenticacion.${tabla}`);
            expect(r.rowCount, tabla).toBeGreaterThan(0);
          }
        });
        const { rows: siguen } = await dueno.query(
          `select (select count(*) from autenticacion."user" where id = $1)::int as u,
                  (select count(*) from autenticacion.account where id = $2)::int as a`,
          [usuario, cuenta],
        );
        expect(siguen).toEqual([{ u: 1, a: 1 }]);
      });

      it("el dueño sigue pudiendo borrar un usuario y arrastra en cascada sus sesiones y cuentas (soporte lo resuelve a mano)", async () => {
        const { usuario } = await sembrarAutenticacion(dueno);
        await dueno.query(`delete from autenticacion."user" where id = $1`, [usuario]);
        const { rows } = await dueno.query(
          `select (select count(*) from autenticacion.session where "userId" = $1)::int as s,
                  (select count(*) from autenticacion.account where "userId" = $1)::int as a`,
          [usuario],
        );
        expect(rows).toEqual([{ s: 0, a: 0 }]);
      });
    });

    // ===========================================================================================================
    // Lo que promete el texto
    // ===========================================================================================================
    describe("el texto de la migración promete lo que hace", () => {
      /** Las sentencias que se ejecutan fuera de los bloques `DO`, sin comentarios y con los espacios normalizados. */
      const sentencias = (texto: string): string[] =>
        texto
          .replace(/--.*$/gm, "")
          .replace(/DO\s+\$\$[\s\S]*?\$\$\s*;/g, "")
          .split(";")
          .map((s) => s.replace(/\s+/g, " ").trim())
          .filter((s) => s !== "");

      it("la cabecera declara lo que es: solo permisos, repetible, con su reversión que no pierde datos", async () => {
        const completo = await textoDeLaMigracion();
        const plano = completo.replace(/\n--\s*/g, " ");
        expect(plano).toMatch(/solo cambian PRIVILEGIOS/);
        expect(plano).toMatch(/REPETIBLE/);
        expect(plano).toMatch(/NO pierde datos/);
        expect(plano).toMatch(/migracion. NO tiene RLS/);
        expect(completo).toContain(`reversiones/${await archivoDeLaReversion()}`);
      });

      it("ejecuta EXACTAMENTE tres sentencias, todas de privilegios: nada se crea, se modifica ni se borra, ni se da LOGIN o contraseña", async () => {
        const completo = await textoDeLaMigracion();
        expect(sentencias(completo)).toEqual([
          "REVOKE ALL ON migracion FROM zuluhub_app",
          "GRANT SELECT (nombre) ON migracion TO zuluhub_app",
          'REVOKE DELETE ON autenticacion."user", autenticacion.account FROM zuluhub_autenticacion',
        ]);
        const codigo = completo.replace(/--.*$/gm, "");
        expect(codigo).not.toMatch(/\b(CREATE|DROP|TRUNCATE|INSERT|UPDATE|CASCADE)\b/i);
        expect(codigo).not.toMatch(/\bSECURITY\s+DEFINER\b/i);
        expect(codigo).not.toMatch(/\bLOGIN\b/i);
        expect(codigo).not.toMatch(/\bPASSWORD\s+'/i);
        expect(codigo).not.toMatch(/postgres(ql)?:\/\//i);
      });

      it("la reversión solo toca privilegios y la fila del ejecutor, y su cabecera dice cómo se corre", async () => {
        const texto = await textoDeLaReversion();
        expect(texto).toMatch(/NO es destructiva/);
        expect(texto).toMatch(/NO lo aplica el ejecutor de migraciones/);
        expect(texto).toMatch(/BEGIN;/);
        expect(sentencias(texto)).toEqual([
          "REVOKE SELECT (nombre) ON migracion FROM zuluhub_app",
          'GRANT DELETE ON autenticacion."user", autenticacion.account TO zuluhub_autenticacion',
        ]);
        const codigo = texto.replace(/--.*$/gm, "");
        expect(codigo).not.toMatch(/\b(DROP|TRUNCATE|CASCADE|CREATE)\b/i);
        // El único DELETE de datos es la fila de la propia migración en el registro del ejecutor.
        expect(codigo.match(/\bDELETE\s+FROM\b/gi)).toHaveLength(1);
        expect(codigo).toMatch(/DELETE FROM public\.migracion WHERE nombre LIKE/);
      });
    });

    // ===========================================================================================================
    // Reversión
    // ===========================================================================================================
    describe("la reversión (script aparte, sin pérdida de datos)", () => {
      it("deja los privilegios EXACTAMENTE como estaban antes, no toca los datos, borra la fila del ejecutor y se puede repetir", async () => {
        await conPrevias(async (previa, conMia) => {
          await sembrarAutenticacion(previa.cliente);
          const catalogoAntes = await huellaDeCatalogo(previa.cliente);
          const autenticacionAntes = await privilegiosDeAutenticacion(previa.cliente);
          const { rows: registroAntes } = await previa.cliente.query(
            "select nombre, checksum from migracion order by 1",
          );

          await aplicarMigraciones(previa.aparte.base.dueno, conMia);
          expect(await huellaDeCatalogo(previa.cliente)).not.toEqual(catalogoAntes);
          expect(await privilegiosDeAutenticacion(previa.cliente)).not.toEqual(autenticacionAntes);
          const datosConLaMigracion = await huellaDeDatos(previa.cliente);

          const reversion = await textoDeLaReversion();
          await previa.cliente.query("begin");
          await previa.cliente.query(reversion);
          await previa.cliente.query("commit");

          expect(await huellaDeCatalogo(previa.cliente)).toEqual(catalogoAntes);
          expect(await privilegiosDeAutenticacion(previa.cliente)).toEqual(autenticacionAntes);
          expect(
            (await previa.cliente.query("select nombre, checksum from migracion order by 1")).rows,
          ).toEqual(registroAntes);
          expect(await huellaDeDatos(previa.cliente)).toEqual(datosConLaMigracion);

          // Repetirla no falla ni cambia nada.
          await previa.cliente.query(reversion);
          expect(await huellaDeCatalogo(previa.cliente)).toEqual(catalogoAntes);
          expect(await privilegiosDeAutenticacion(previa.cliente)).toEqual(autenticacionAntes);

          // Revertida: la aplicación vuelve a no leer `migracion` y la librería vuelve a poder borrar usuarios y cuentas.
          await comoRol(previa.aparte.base.app, async (app) => {
            expect(await codigoDe(app.query("select nombre from migracion"))).toBe("42501");
          });
          await comoRol(previa.aparte.base.autenticacion, async (auth) => {
            for (const tabla of ['"user"', "account"]) {
              expect(
                await codigoDe(auth.query(`delete from autenticacion.${tabla}`)),
                tabla,
              ).toBeNull();
            }
          });

          // Y la migración se puede aplicar otra vez.
          const otra = await aplicarMigraciones(previa.aparte.base.dueno, conMia);
          expect(otra.aplicadas).toEqual([await archivoDeLaMigracion()]);
          await comoRol(previa.aparte.base.autenticacion, async (auth) => {
            expect(await codigoDe(auth.query(`delete from autenticacion."user"`))).toBe("42501");
          });
        });
      });
    });
  },
);
