import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { opcionesDeInstancia } from "../../src/adaptadores/autenticacion/opciones";
import { crearConexionDeAutenticacion } from "../../src/adaptadores/postgres/conexion-de-autenticacion";
import { configuracionDeHost } from "../../src/capacidades/autenticacion/host-de-autenticacion";
import { LIMITES_DE_SESION } from "../../src/capacidades/autenticacion/vigencia-de-sesion";
import { crearBaseAparte } from "./entorno";
import {
  Navegador,
  armarAutenticacionDePrueba,
  levantarProveedorLocal,
  perfilAlAzar,
  type ProveedorLocal,
} from "./autenticacion-ingreso-apoyo";

/**
 * Autenticación (W3b): la migración 0010 (que W3a escribió a mano) contra la librería REAL, la 1.7.7, con el
 * rol limitado `zuluhub_autenticacion` (sin CREATE). La librería no puede tener nada por crear, agregar ni
 * indexar; sus propias columnas coinciden con las de la migración; la columna propia `session.host` (NOT
 * NULL) convive con lo que la librería inserta porque el gancho G4 la llena antes del insert; y el rol no
 * puede hacer DDL ni ver una tabla de negocio. Es la verificación que W3a dejó pedida (hallazgo del spec §4.2).
 */

const base = inject("baseDePruebas");

describe.skipIf(base === null)("autenticación: la migración 0010 contra Better Auth 1.7.7", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let conexion: ReturnType<typeof crearConexionDeAutenticacion>;
  let dueno: pg.Client;

  const opciones = () => {
    const c = configuracionDeHost("app.marca-a.test");
    if (!c.ok) throw new Error("host de prueba inválido");
    return opcionesDeInstancia({
      configuracion: c.valor,
      db: conexion.db,
      secreto: "s".repeat(40),
      google: { clientId: "cliente", clientSecret: "secreto" },
      limites: LIMITES_DE_SESION,
      reloj: () => new Date(),
      rutaDeError: "/ingreso",
      registrar: () => undefined,
    });
  };

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    conexion = crearConexionDeAutenticacion({ url: propia.base.autenticacion });
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await conexion.cerrar();
    await dueno.end();
    await propia.destruir();
  });

  it("getMigrations con el rol limitado: nada por crear, agregar ni indexar, y ningún problema de esquema", async () => {
    const m = await getMigrations(opciones(), { throwOnUnsafe: false });
    expect(m.toBeCreated).toEqual([]);
    expect(m.toBeAdded).toEqual([]);
    expect(m.toBeAddedIndexes).toEqual([]);
    expect(m.unsafeChanges).toEqual([]);
    expect(m.schemaProblems).toEqual([]);
    // El SQL que compilaría la librería está vacío: no hay un solo CREATE/ALTER que aplicar.
    expect((await m.compileMigrations()).replace(/[;\s]/g, "")).toBe("");
  });

  it("sin la columna propia `host` la librería sí lo notaría: el control positivo de la comparación", async () => {
    // Una base cuyo esquema difiere de lo que la librería espera tiene que mostrarse en `getMigrations`.
    const aparte = await crearBaseAparte(base as NonNullable<typeof base>);
    const admin = new pg.Client({ connectionString: aparte.base.dueno });
    await admin.connect();
    const otra = crearConexionDeAutenticacion({ url: aparte.base.autenticacion });
    try {
      await admin.query("alter table autenticacion.session drop column host");
      await admin.query(`alter table autenticacion."user" drop column image`);
      const c = configuracionDeHost("app.marca-a.test");
      if (!c.ok) throw new Error("host de prueba inválido");
      const m = await getMigrations(
        opcionesDeInstancia({
          configuracion: c.valor,
          db: otra.db,
          secreto: "s".repeat(40),
          google: { clientId: "cliente", clientSecret: "secreto" },
          limites: LIMITES_DE_SESION,
          reloj: () => new Date(),
          rutaDeError: "/ingreso",
          registrar: () => undefined,
        }),
        { throwOnUnsafe: false },
      );
      const agregadas = m.toBeAdded.flatMap((t) =>
        Object.keys(t.fields).map((f) => `${t.table}.${f}`),
      );
      expect(agregadas.sort()).toEqual(["session.host", "user.image"]);
    } finally {
      await otra.cerrar();
      await admin.end();
      await aparte.destruir();
    }
  });

  it("lo que la librería crearía en un esquema vacío coincide con la migración: columnas, tipos, claves, índices y claves foráneas", async () => {
    // Se deja que la librería cree TODO su esquema en una base vacía (con un rol que sí puede crear) y se
    // compara columna por columna con lo que 0010 creó a mano.
    const vacia = await crearBaseAparte(base as NonNullable<typeof base>, { migrar: false });
    const admin = new pg.Client({ connectionString: vacia.base.dueno });
    await admin.connect();
    const conAdmin = crearConexionDeAutenticacion({ url: vacia.base.dueno });
    try {
      const c = configuracionDeHost("app.marca-a.test");
      if (!c.ok) throw new Error("host de prueba inválido");
      const generado = await getMigrations(
        opcionesDeInstancia({
          configuracion: c.valor,
          db: conAdmin.db,
          secreto: "s".repeat(40),
          google: { clientId: "cliente", clientSecret: "secreto" },
          limites: LIMITES_DE_SESION,
          reloj: () => new Date(),
          rutaDeError: "/ingreso",
          registrar: () => undefined,
        }),
        { throwOnUnsafe: false },
      );
      await admin.query(await generado.compileMigrations());
      const catalogo = async (cliente: pg.Client) => {
        const { rows } = await cliente.query<{ clave: string; tipo: string; obligatoria: string }>(
          `select table_name || '.' || column_name as clave, udt_name as tipo, is_nullable as obligatoria
             from information_schema.columns where table_schema = 'autenticacion' order by 1`,
        );
        return new Map(rows.map((f) => [f.clave, `${f.tipo}/${f.obligatoria}`]));
      };
      const deLaLibreria = await catalogo(admin);
      const deLaMigracion = await catalogo(dueno);
      // La columna propia `session.host` también la declara la librería (campo adicional de la sesión).
      const soloMigracion = [...deLaMigracion.keys()].filter((k) => !deLaLibreria.has(k));
      const soloLibreria = [...deLaLibreria.keys()].filter((k) => !deLaMigracion.has(k));
      expect(soloLibreria).toEqual([]);
      expect(soloMigracion).toEqual([]);
      const distintas = [...deLaLibreria]
        .filter(([k, v]) => deLaMigracion.get(k) !== v)
        .map(([k, v]) => `${k}: librería ${v}, migración ${deLaMigracion.get(k)}`);
      expect(distintas).toEqual([]);
      // Claves, unicidades, índices y claves foráneas (columnas y borrado en cascada), sin importar los nombres.
      const estructura = async (cliente: pg.Client) => {
        const { rows } = await cliente.query<{ t: string; fila: string }>(
          `select c.relname as t,
                  case when i.indisprimary then 'pk' when i.indisunique then 'unico' else 'indice' end
                  || ':' || (select string_agg(a.attname, ',' order by k.ord)
                               from unnest(i.indkey) with ordinality k(n, ord)
                               join pg_attribute a on a.attrelid = c.oid and a.attnum = k.n) as fila
             from pg_index i join pg_class c on c.oid = i.indrelid
            where c.relnamespace = 'autenticacion'::regnamespace
           union all
           select c.relname, 'fk:' || (select string_agg(a.attname, ',') from pg_attribute a
                    where a.attrelid = c.oid and a.attnum = any(o.conkey)) || '->' || o.confrelid::regclass::text
                    || ':' || o.confdeltype::text
             from pg_constraint o join pg_class c on c.oid = o.conrelid
            where o.contype = 'f' and c.relnamespace = 'autenticacion'::regnamespace`,
        );
        return new Set(rows.map((f) => `${f.t} ${f.fila}`));
      };
      const e1 = await estructura(admin);
      const e2 = await estructura(dueno);
      expect([...e1].filter((x) => !e2.has(x))).toEqual([]);
      // Lo único que 0010 agrega: la unicidad de la cuenta de un proveedor, que la librería no impone sola.
      expect([...e2].filter((x) => !e1.has(x))).toEqual(["account unico:providerId,accountId"]);
    } finally {
      await conAdmin.cerrar();
      await admin.end();
      await vacia.destruir();
    }
  });

  it("las tablas y columnas de la librería son exactamente las de la migración (ni una de más, ni una de menos)", async () => {
    const auth = betterAuth(opciones());
    const contexto = await auth.$context;
    // El esquema que la librería declara (con las columnas propias) contra el catálogo real.
    const { rows } = await dueno.query<{ tabla: string; columna: string }>(
      `select table_name as tabla, column_name as columna from information_schema.columns
        where table_schema = 'autenticacion' order by 1, 2`,
    );
    const enBase = new Map<string, string[]>();
    for (const { tabla, columna } of rows) {
      enBase.set(tabla, [...(enBase.get(tabla) ?? []), columna]);
    }
    const declarado = new Map<string, string[]>();
    for (const [modelo, tabla] of Object.entries(contexto.tables)) {
      declarado.set(
        tabla.modelName ?? modelo,
        ["id", ...Object.entries(tabla.fields).map(([campo, f]) => f.fieldName ?? campo)].sort(),
      );
    }
    // Las cinco tablas, y solo ellas (no hay `twoFactor`: el plugin no está).
    expect([...enBase.keys()].sort()).toEqual([
      "account",
      "rateLimit",
      "session",
      "user",
      "verification",
    ]);
    expect([...declarado.keys()].sort()).toEqual([...enBase.keys()].sort());
    for (const [tabla, columnas] of declarado) {
      expect(enBase.get(tabla)?.sort(), tabla).toEqual(columnas);
    }
  });

  it("el rol no puede hacer DDL ni ver tablas de negocio (42501), y la conexión de la librería es la de ese rol", async () => {
    const codigo = async (consulta: ReturnType<typeof sql>): Promise<string | undefined> => {
      try {
        await consulta.execute(conexion.db);
        return undefined;
      } catch (e) {
        return (e as { code?: string }).code;
      }
    };
    expect(await codigo(sql`create table autenticacion.prueba_ddl (x int)`)).toBe("42501");
    expect(await codigo(sql`create table public.prueba_ddl (x int)`)).toBe("42501");
    expect(await codigo(sql`create schema prueba_ddl`)).toBe("42501");
    expect(await codigo(sql`alter table autenticacion.session add column x int`)).toBe("42501");
    expect(await codigo(sql`drop table autenticacion.account`)).toBe("42501");
    for (const tabla of ["persona", "empresa", "tenant", "membresia", "marca"]) {
      expect(await codigo(sql`select 1 from ${sql.table(tabla)}`), tabla).toBe("42501");
    }
    const { rows } = await sql<{ yo: string }>`select current_user as yo`.execute(conexion.db);
    expect(rows[0]?.yo).toBe("zuluhub_autenticacion");
  });

  describe("la columna propia session.host (NOT NULL) y lo que inserta la librería", () => {
    let proveedor: ProveedorLocal;

    beforeAll(async () => {
      vi.stubEnv("NODE_ENV", "production");
      proveedor = await levantarProveedorLocal();
    });
    afterAll(async () => {
      await proveedor.cerrar();
      vi.unstubAllEnvs();
    });

    it("el gancho G4 la llena antes del insert: la sesión nace con el host de la instancia", async () => {
      const a = armarAutenticacionDePrueba(propia.base, proveedor);
      try {
        const n = new Navegador();
        const r = await n.ingresarConGoogle(
          a.autenticacion,
          "app.marca-a.test",
          proveedor,
          perfilAlAzar(),
        );
        expect(r.estado).toBe(302);
        const { rows } = await dueno.query<{ host: string }>(
          "select host from autenticacion.session",
        );
        expect(rows.map((f) => f.host)).toEqual(["app.marca-a.test"]);
      } finally {
        await a.cerrar();
      }
    });

    it("sin el valor que el gancho pone, la base rechaza la sesión (23502): la columna no se llena por azar", async () => {
      await expect(
        dueno.query(
          `insert into autenticacion.session ("expiresAt", token, "userId")
           select now(), 'sin-host', id from autenticacion."user" limit 1`,
        ),
      ).rejects.toMatchObject({ code: "23502" });
    });
  });
});
