/**
 * Spike de persistencia (pruebas P1 a P8 de ZuluHub-docs, `06-stack-y-costos/propuesta-stack.md` §6).
 *
 * Es TEMPORAL: verifica con pruebas, a través del pooler real de Neon y desde una función de Vercel,
 * las decisiones de los ADR-004 y ADR-009 a ADR-011. Cuando haya resultados, lo que sirva pasa a pruebas
 * del CI y este archivo se borra.
 *
 * Seguridad: no corre en producción, no devuelve cadenas de conexión y todo lo que crea vive en el esquema
 * `spike` (se borra al empezar y al terminar). El despliegue está detrás de la protección de Vercel.
 */
import { Kysely, PostgresDialect, sql } from "kysely";
import type { Transaction } from "kysely";
import pg from "pg";

// ---------- tipos del resultado ----------

export type Estado = "pasa" | "falla" | "no_aplica";

export interface ResultadoPrueba {
  prueba: string;
  titulo: string;
  estado: Estado;
  detalle: string;
  milisegundos: number;
}

export interface ConfiguracionSpike {
  /** Cadena con pooler (la que usará la aplicación). */
  urlPooler: string;
  /** Cadena directa (migraciones y preparación). */
  urlDirecta: string;
}

// ---------- tablas del spike (solo para tipar las consultas) ----------

interface Empresa {
  id: string;
  cuit: string;
  estado: string;
}
interface Miembro {
  empresa_id: string;
  persona_id: string;
  rol: string;
  activo: boolean;
}
interface BaseDeDatos {
  empresa: Empresa;
  miembro: Miembro;
}

// ---------- utilidades ----------

const esperar = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

function codigoDe(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const codigo = error.code;
    return typeof codigo === "string" ? codigo : undefined;
  }
  return undefined;
}

function restriccionDe(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "constraint" in error) {
    const restriccion = error.constraint;
    return typeof restriccion === "string" ? restriccion : undefined;
  }
  return undefined;
}

const esReintentable = (error: unknown) => {
  const c = codigoDe(error);
  return c === "40001" || c === "40P01";
};

/** Sin credenciales: reemplaza cualquier cadena de conexión que aparezca en un mensaje. */
function limpiar(mensaje: string, config: ConfiguracionSpike): string {
  let salida = mensaje;
  for (const url of [config.urlPooler, config.urlDirecta]) {
    if (url) salida = salida.split(url).join("<url>");
    try {
      const u = new URL(url);
      if (u.password) salida = salida.split(u.password).join("<clave>");
    } catch {
      // una cadena inválida ya se informó en la validación de entorno
    }
  }
  return salida;
}

async function correrConConcurrencia(
  total: number,
  concurrencia: number,
  tarea: (indice: number) => Promise<void>,
): Promise<void> {
  let siguiente = 0;
  const trabajadores = Array.from({ length: Math.min(concurrencia, total) }, async () => {
    for (;;) {
      const indice = siguiente++;
      if (indice >= total) return;
      await tarea(indice);
    }
  });
  await Promise.all(trabajadores);
}

function crearBase(urlPooler: string, max: number): { db: Kysely<BaseDeDatos>; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: urlPooler, max, idleTimeoutMillis: 10_000 });
  const db = new Kysely<BaseDeDatos>({ dialect: new PostgresDialect({ pool }) }).withSchema(
    "spike",
  );
  return { db, pool };
}

// ---------- preparación y limpieza (conexión directa) ----------

const SQL_LIMPIAR = `
DROP SCHEMA IF EXISTS spike CASCADE;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'spike_app') THEN
    DROP OWNED BY spike_app;
    DROP ROLE spike_app;
  END IF;
END $$;
`;

const SQL_PREPARAR = `
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE SCHEMA spike;
CREATE ROLE spike_app NOLOGIN NOBYPASSRLS NOSUPERUSER;
GRANT spike_app TO CURRENT_USER;
GRANT USAGE ON SCHEMA spike TO spike_app;

CREATE TABLE spike.empresa (
  id text PRIMARY KEY,
  cuit text NOT NULL,
  estado text NOT NULL DEFAULT 'ACTIVE'
);
CREATE UNIQUE INDEX empresa_cuit_uk ON spike.empresa (cuit) WHERE estado <> 'CANCELLED';

CREATE TABLE spike.sucursal (
  empresa_id text NOT NULL,
  id text NOT NULL,
  nombre text NOT NULL,
  PRIMARY KEY (empresa_id, id)
);
ALTER TABLE spike.sucursal ENABLE ROW LEVEL SECURITY;
ALTER TABLE spike.sucursal FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento ON spike.sucursal
  USING (empresa_id = current_setting('app.empresa_id', true))
  WITH CHECK (empresa_id = current_setting('app.empresa_id', true));
GRANT SELECT ON spike.sucursal TO spike_app;

CREATE TABLE spike.miembro (
  empresa_id text NOT NULL,
  persona_id text NOT NULL,
  rol text NOT NULL,
  activo boolean NOT NULL DEFAULT true,
  PRIMARY KEY (empresa_id, persona_id)
);

CREATE TABLE spike.reserva (
  id serial PRIMARY KEY,
  habitacion text NOT NULL,
  periodo daterange NOT NULL,
  CONSTRAINT reserva_sin_superposicion EXCLUDE USING gist (habitacion WITH =, periodo WITH &&)
);

INSERT INTO spike.sucursal (empresa_id, id, nombre)
SELECT e, 's' || n, 'Sucursal ' || n FROM unnest(ARRAY['A','B']) AS e, generate_series(1,3) AS n;
`;

async function sqlDirecto(urlDirecta: string, texto: string): Promise<void> {
  const cliente = new pg.Client({ connectionString: urlDirecta });
  await cliente.connect();
  try {
    await cliente.query(texto);
  } finally {
    await cliente.end();
  }
}

// ---------- pruebas ----------

type Medir = () => Promise<{ estado: Estado; detalle: string }>;

async function ejecutar(
  prueba: string,
  titulo: string,
  config: ConfiguracionSpike,
  cuerpo: Medir,
): Promise<ResultadoPrueba> {
  const inicio = Date.now();
  try {
    const { estado, detalle } = await cuerpo();
    return { prueba, titulo, estado, detalle, milisegundos: Date.now() - inicio };
  } catch (error) {
    const texto = error instanceof Error ? error.message : String(error);
    return {
      prueba,
      titulo,
      estado: "falla",
      detalle: `Excepción: ${limpiar(texto, config)}`,
      milisegundos: Date.now() - inicio,
    };
  }
}

/** P1: el contexto fijado dentro de la transacción no se filtra entre pedidos a través del pooler. */
async function p1(config: ConfiguracionSpike, iteraciones: number, concurrencia: number) {
  const { db } = crearBase(config.urlPooler, concurrencia);
  let filtraciones = 0;
  let errores = 0;
  let sinContextoVioFilas = 0;
  let primerError = "";
  try {
    await correrConConcurrencia(iteraciones, concurrencia, async (i) => {
      // 1 de cada 3 pedidos NO fija contexto: tiene que ver 0 filas (falla cerrado).
      const esperada = i % 3 === 0 ? null : i % 2 === 0 ? "A" : "B";
      try {
        const filas = await db.transaction().execute(async (trx) => {
          if (esperada !== null) {
            await sql`select set_config('app.empresa_id', ${esperada}, true)`.execute(trx);
          }
          await sql`set local role spike_app`.execute(trx);
          const r = await sql<{
            empresa_id: string;
          }>`select empresa_id from spike.sucursal`.execute(trx);
          return r.rows;
        });
        if (esperada === null) {
          if (filas.length !== 0) sinContextoVioFilas++;
        } else if (filas.length !== 3 || filas.some((f) => f.empresa_id !== esperada)) {
          filtraciones++;
        }
      } catch (error) {
        errores++;
        if (!primerError) primerError = error instanceof Error ? error.message : String(error);
      }
    });
  } finally {
    await db.destroy();
  }
  const ok = filtraciones === 0 && sinContextoVioFilas === 0 && errores === 0;
  return {
    estado: (ok ? "pasa" : "falla") as Estado,
    detalle:
      `${iteraciones} transacciones, concurrencia ${concurrencia}. ` +
      `Filas de otra empresa: ${filtraciones}. Sin contexto con filas visibles: ${sinContextoVioFilas}. ` +
      `Errores: ${errores}${primerError ? ` (${limpiar(primerError, config)})` : ""}.`,
  };
}

/** P2: el rol de la aplicación no es dueño ni se saltea RLS; informa cómo es el rol de conexión. */
async function p2(config: ConfiguracionSpike) {
  const cliente = new pg.Client({ connectionString: config.urlDirecta });
  await cliente.connect();
  try {
    const roles = await cliente.query<{
      rolname: string;
      rolbypassrls: boolean;
      rolsuper: boolean;
    }>(
      `SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname IN (current_user, 'spike_app')`,
    );
    const duenos = await cliente.query<{ tableowner: string }>(
      `SELECT DISTINCT tableowner FROM pg_tables WHERE schemaname = 'spike'`,
    );
    const actual =
      (await cliente.query<{ u: string }>(`SELECT current_user AS u`)).rows[0]?.u ?? "";
    const app = roles.rows.find((r) => r.rolname === "spike_app");
    const conexion = roles.rows.find((r) => r.rolname === actual);
    const appDueno = duenos.rows.some((d) => d.tableowner === "spike_app");
    const ok = app !== undefined && !app.rolbypassrls && !app.rolsuper && !appDueno;
    return {
      estado: (ok ? "pasa" : "falla") as Estado,
      detalle:
        `Rol de la aplicación (spike_app): bypassrls=${String(app?.rolbypassrls)}, super=${String(app?.rolsuper)}, ` +
        `dueño de las tablas=${String(appDueno)}. ` +
        `Rol de conexión (${actual}): bypassrls=${String(conexion?.rolbypassrls)}, super=${String(conexion?.rolsuper)} ` +
        `(si bypassrls es true, esa cadena NO sirve para la aplicación; se usa solo para migraciones).`,
    };
  } finally {
    await cliente.end();
  }
}

type Resultado3 = "ok" | "ultimo_admin" | "agotado";

async function bajarAdmin(
  db: Kysely<BaseDeDatos>,
  empresa: string,
  persona: string,
  serializable: boolean,
): Promise<Resultado3> {
  for (let intento = 0; intento < 8; intento++) {
    try {
      const constructor = db.transaction();
      const tx = serializable ? constructor.setIsolationLevel("serializable") : constructor;
      return await tx.execute(async (trx: Transaction<BaseDeDatos>) => {
        const r = await sql<{ n: string }>`
          select count(*)::text as n from spike.miembro
          where empresa_id = ${empresa} and rol = 'ADMIN' and activo`.execute(trx);
        if (Number(r.rows[0]?.n ?? "0") <= 1) return "ultimo_admin" as const;
        await sleepCorto();
        await sql`update spike.miembro set activo = false
          where empresa_id = ${empresa} and persona_id = ${persona}`.execute(trx);
        return "ok" as const;
      });
    } catch (error) {
      if (!esReintentable(error)) throw error;
      await esperar(5 + Math.floor(Math.random() * 15));
    }
  }
  return "agotado";
}

/** Pausa breve entre leer y escribir para forzar el cruce entre las dos transacciones. */
const sleepCorto = () => esperar(20);

/** P3: serializable con reintento; los dos últimos admins no pueden bajarse a la vez. */
async function p3(config: ConfiguracionSpike, corridas: number) {
  const { db } = crearBase(config.urlPooler, 6);
  const direct = new pg.Client({ connectionString: config.urlDirecta });
  await direct.connect();
  const contar = async () =>
    Number(
      (
        await direct.query<{ n: string }>(
          `select count(*)::text as n from spike.miembro where empresa_id='E' and activo`,
        )
      ).rows[0]?.n ?? "0",
    );
  const reponer = async () => {
    await direct.query(`delete from spike.miembro where empresa_id='E'`);
    await direct.query(
      `insert into spike.miembro (empresa_id, persona_id, rol) values ('E','p1','ADMIN'),('E','p2','ADMIN')`,
    );
  };
  const resumen = { ok: 0, ultimo: 0, agotado: 0, sinAdmins: 0, controlSinAdmins: 0 };
  try {
    for (let i = 0; i < corridas; i++) {
      await reponer();
      const [a, b] = await Promise.all([
        bajarAdmin(db, "E", "p1", true),
        bajarAdmin(db, "E", "p2", true),
      ]);
      for (const r of [a, b]) {
        if (r === "ok") resumen.ok++;
        else if (r === "ultimo_admin") resumen.ultimo++;
        else resumen.agotado++;
      }
      if ((await contar()) < 1) resumen.sinAdmins++;
    }
    // Control: sin serializable la carrera sí deja a la empresa sin admins (muestra que la prueba detecta el problema).
    for (let i = 0; i < Math.min(corridas, 30); i++) {
      await reponer();
      await Promise.all([bajarAdmin(db, "E", "p1", false), bajarAdmin(db, "E", "p2", false)]);
      if ((await contar()) < 1) resumen.controlSinAdmins++;
    }
  } finally {
    await direct.end();
    await db.destroy();
  }
  const ok = resumen.sinAdmins === 0 && resumen.ok === corridas && resumen.agotado === 0;
  return {
    estado: (ok ? "pasa" : "falla") as Estado,
    detalle:
      `${corridas} corridas con dos bajas simultáneas. Quedaron 0 admins: ${resumen.sinAdmins}. ` +
      `Resultados: ok=${resumen.ok}, rechazo ULTIMO_ADMIN=${resumen.ultimo}, concurrencia agotada=${resumen.agotado}. ` +
      `Control sin serializable (30 corridas): dejó 0 admins en ${resumen.controlSinAdmins}.`,
  };
}

interface Traducido {
  tipo: "unicidad" | "superposicion" | "otro";
  restriccion: string | undefined;
}

function traducir(error: unknown): Traducido {
  const c = codigoDe(error);
  const r = restriccionDe(error);
  if (c === "23505") return { tipo: "unicidad", restriccion: r };
  if (c === "23P01") return { tipo: "superposicion", restriccion: r };
  return { tipo: "otro", restriccion: r };
}

/** P4: CUIT duplicado y EXCLUDE con btree_gist salen como errores tipados con el nombre de la restricción. */
async function p4(config: ConfiguracionSpike) {
  const { db } = crearBase(config.urlPooler, 4);
  const fallas: string[] = [];
  try {
    // dos altas simultáneas con el mismo CUIT
    const resultados = await Promise.allSettled([
      db.insertInto("empresa").values({ id: "e1", cuit: "30-1", estado: "PROVISIONING" }).execute(),
      db.insertInto("empresa").values({ id: "e2", cuit: "30-1", estado: "PROVISIONING" }).execute(),
    ]);
    const rechazadas = resultados.filter((r) => r.status === "rejected");
    const aceptadas = resultados.filter((r) => r.status === "fulfilled");
    const t = traducir(
      rechazadas[0] && "reason" in rechazadas[0] ? rechazadas[0].reason : undefined,
    );
    if (aceptadas.length !== 1) fallas.push(`altas aceptadas=${aceptadas.length} (se esperaba 1)`);
    if (t.tipo !== "unicidad" || t.restriccion !== "empresa_cuit_uk") {
      fallas.push(`CUIT duplicado se tradujo como ${t.tipo}/${String(t.restriccion)}`);
    }
    // cancelada: el CUIT se libera (índice único parcial)
    await sql`update spike.empresa set estado = 'CANCELLED' where cuit = '30-1' and id = 'e1'`.execute(
      db,
    );
    await sql`update spike.empresa set estado = 'CANCELLED' where cuit = '30-1' and id = 'e2'`.execute(
      db,
    );
    try {
      await db
        .insertInto("empresa")
        .values({ id: "e3", cuit: "30-1", estado: "PROVISIONING" })
        .execute();
    } catch (error) {
      fallas.push(`reutilizar un CUIT de alta cancelada falló: ${traducir(error).tipo}`);
    }
    // EXCLUDE: superposición de reservas
    await sql`insert into spike.reserva (habitacion, periodo) values ('h1', daterange('2026-01-01','2026-01-05'))`.execute(
      db,
    );
    let superposicion: Traducido = { tipo: "otro", restriccion: undefined };
    try {
      await sql`insert into spike.reserva (habitacion, periodo) values ('h1', daterange('2026-01-03','2026-01-06'))`.execute(
        db,
      );
    } catch (error) {
      superposicion = traducir(error);
    }
    if (
      superposicion.tipo !== "superposicion" ||
      superposicion.restriccion !== "reserva_sin_superposicion"
    ) {
      fallas.push(
        `superposición se tradujo como ${superposicion.tipo}/${String(superposicion.restriccion)}`,
      );
    }
    try {
      await sql`insert into spike.reserva (habitacion, periodo) values ('h1', daterange('2026-01-05','2026-01-08'))`.execute(
        db,
      );
    } catch (error) {
      fallas.push(`reserva contigua rechazada: ${traducir(error).tipo}`);
    }
  } finally {
    await db.destroy();
  }
  return {
    estado: (fallas.length === 0 ? "pasa" : "falla") as Estado,
    detalle:
      fallas.length === 0
        ? "CUIT duplicado → unicidad (empresa_cuit_uk); CUIT de alta cancelada reutilizable; superposición → exclusión (reserva_sin_superposicion); reserva contigua aceptada."
        : fallas.join("; "),
  };
}

/** Generador determinístico para que la prueba sea repetible. */
function generador(semilla: number): () => number {
  let a = semilla;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** P5: numeric y bigint hacen ida y vuelta sin perder nada y llegan como texto, nunca como number. */
async function p5(config: ConfiguracionSpike) {
  const pool = new pg.Pool({ connectionString: config.urlPooler, max: 4 });
  const azar = generador(42);
  const dig = (n: number) =>
    Array.from({ length: n }, () => Math.floor(azar() * 10).toString()).join("");
  let mal = 0;
  let noTexto = 0;
  let primero = "";
  try {
    for (let i = 0; i < 1000; i++) {
      const entero = dig(1 + Math.floor(azar() * 11)).replace(/^0+(?=\d)/, "");
      const signo = azar() < 0.2 ? "-" : "";
      const valor = `${signo}${entero}.${dig(6)}`;
      const grande = `${signo}${dig(1 + Math.floor(azar() * 18)).replace(/^0+(?=\d)/, "")}`;
      const r = await pool.query<{ v: unknown; b: unknown }>(
        `select $1::numeric(18,6) as v, $2::bigint as b`,
        [valor, grande],
      );
      const fila = r.rows[0];
      if (typeof fila?.v !== "string" || typeof fila.b !== "string") {
        noTexto++;
        continue;
      }
      const normalizado = valor === "-0.000000" ? "0.000000" : valor;
      const grandeNorm = grande === "-0" ? "0" : grande;
      if (fila.v !== normalizado || fila.b !== grandeNorm) {
        mal++;
        if (!primero) primero = `${valor} → ${fila.v}; ${grande} → ${String(fila.b)}`;
      }
    }
  } finally {
    await pool.end();
  }
  return {
    estado: (mal === 0 && noTexto === 0 ? "pasa" : "falla") as Estado,
    detalle: `1.000 valores numeric(18,6) y bigint. Distintos: ${mal}. No llegaron como texto: ${noTexto}.${primero ? ` Primer caso: ${primero}` : ""}`,
  };
}

// ---------- P7: independencia de la herramienta de acceso a datos ----------

interface RepositorioEmpresas {
  registrarAlta(e: { id: string; cuit: string }): Promise<"ok" | "cuit_duplicado">;
  cancelar(id: string): Promise<void>;
  buscarPorId(id: string): Promise<{ id: string; cuit: string; estado: string } | null>;
}

function repositorioConKysely(db: Kysely<BaseDeDatos>): RepositorioEmpresas {
  return {
    async registrarAlta(e) {
      try {
        await db
          .insertInto("empresa")
          .values({ id: e.id, cuit: e.cuit, estado: "PROVISIONING" })
          .execute();
        return "ok";
      } catch (error) {
        if (traducir(error).restriccion === "empresa_cuit_uk") return "cuit_duplicado";
        throw error;
      }
    },
    async cancelar(id) {
      await db.updateTable("empresa").set({ estado: "CANCELLED" }).where("id", "=", id).execute();
    },
    async buscarPorId(id) {
      const f = await db.selectFrom("empresa").selectAll().where("id", "=", id).executeTakeFirst();
      return f ?? null;
    },
  };
}

function repositorioConPg(pool: pg.Pool): RepositorioEmpresas {
  return {
    async registrarAlta(e) {
      try {
        await pool.query(
          `insert into spike.empresa (id, cuit, estado) values ($1, $2, 'PROVISIONING')`,
          [e.id, e.cuit],
        );
        return "ok";
      } catch (error) {
        if (restriccionDe(error) === "empresa_cuit_uk") return "cuit_duplicado";
        throw error;
      }
    },
    async cancelar(id) {
      await pool.query(`update spike.empresa set estado = 'CANCELLED' where id = $1`, [id]);
    },
    async buscarPorId(id) {
      const r = await pool.query<{ id: string; cuit: string; estado: string }>(
        `select id, cuit, estado from spike.empresa where id = $1`,
        [id],
      );
      return r.rows[0] ?? null;
    },
  };
}

/** Misma prueba de contrato para cualquier implementación; devuelve lo observado. */
async function contrato(repo: RepositorioEmpresas, prefijo: string): Promise<string[]> {
  const a = `${prefijo}-a`;
  const b = `${prefijo}-b`;
  const c = `${prefijo}-c`;
  const cuit = `${prefijo}-cuit`;
  const salida: string[] = [];
  salida.push(`alta:${await repo.registrarAlta({ id: a, cuit })}`);
  salida.push(`dup:${await repo.registrarAlta({ id: b, cuit })}`);
  salida.push(`buscar:${JSON.stringify(await repo.buscarPorId(a))?.replace(prefijo, "P")}`);
  salida.push(`faltante:${JSON.stringify(await repo.buscarPorId(`${prefijo}-nada`))}`);
  await repo.cancelar(a);
  salida.push(`reuso:${await repo.registrarAlta({ id: c, cuit })}`);
  return salida;
}

async function p7(config: ConfiguracionSpike) {
  const { db, pool } = crearBase(config.urlPooler, 4);
  try {
    const conKysely = await contrato(repositorioConKysely(db), "k");
    const conPg = await contrato(repositorioConPg(pool), "k2");
    const norm = (xs: string[]) => xs.map((x) => x.replace(/k2?-/g, "x-").replace(/"k2?-/g, '"x-'));
    const iguales = JSON.stringify(norm(conKysely)) === JSON.stringify(norm(conPg));
    return {
      estado: (iguales ? "pasa" : "falla") as Estado,
      detalle: iguales
        ? "El mismo contrato (alta, duplicado, búsqueda, cancelar y reutilizar CUIT) da el mismo resultado con Kysely y con pg directo, sin tocar nada fuera del repositorio."
        : `Difieren. Kysely: ${conKysely.join(" | ")} — pg: ${conPg.join(" | ")}`,
    };
  } finally {
    await db.destroy();
  }
}

// ---------- latencia ----------

async function latencia(config: ConfiguracionSpike) {
  const pool = new pg.Pool({ connectionString: config.urlPooler, max: 2 });
  const tiempos: number[] = [];
  try {
    await pool.query("select 1");
    for (let i = 0; i < 30; i++) {
      const t = Date.now();
      await pool.query("select 1");
      tiempos.push(Date.now() - t);
    }
  } finally {
    await pool.end();
  }
  tiempos.sort((x, y) => x - y);
  const p = (q: number) =>
    tiempos[Math.min(tiempos.length - 1, Math.floor(tiempos.length * q))] ?? 0;
  return `Una consulta simple tarda p50=${p(0.5)} ms y p95=${p(0.95)} ms.`;
}

// ---------- orquestación ----------

export interface InformeSpike {
  entorno: Record<string, string | boolean>;
  resultados: ResultadoPrueba[];
  resumen: string;
}

export function validarEntorno(config: Partial<ConfiguracionSpike>): string[] {
  const problemas: string[] = [];
  if (!config.urlPooler) problemas.push("Falta DATABASE_URL (cadena con pooler).");
  if (!config.urlDirecta) problemas.push("Falta DATABASE_URL_UNPOOLED (cadena directa).");
  return problemas;
}

export async function ejecutarSpike(
  config: ConfiguracionSpike,
  opciones: {
    iteraciones?: number;
    concurrencia?: number;
    corridas?: number;
    /** Por defecto se deduce del host (`-pooler`); en local se indica a mano. */
    esPooler?: boolean;
  } = {},
): Promise<InformeSpike> {
  const iteraciones = opciones.iteraciones ?? 1000;
  const concurrencia = opciones.concurrencia ?? 20;
  const corridas = opciones.corridas ?? 100;
  const esPooler = opciones.esPooler ?? hostTienePooler(config.urlPooler);
  const resultados: ResultadoPrueba[] = [];

  await sqlDirecto(config.urlDirecta, SQL_LIMPIAR);
  await sqlDirecto(config.urlDirecta, SQL_PREPARAR);
  try {
    resultados.push(
      esPooler
        ? await ejecutar("P1", "Contexto por transacción a través del pooler", config, () =>
            p1(config, iteraciones, concurrencia),
          )
        : {
            prueba: "P1",
            titulo: "Contexto por transacción a través del pooler",
            estado: "falla",
            detalle:
              "DATABASE_URL no es una cadena con pooler (el host no tiene -pooler), así que esta prueba no concluye: con una conexión directa nunca se comparten conexiones. Cargá la cadena con Connection pooling activado.",
            milisegundos: 0,
          },
      await ejecutar("P2", "Rol de la aplicación sin BYPASSRLS y no dueño", config, () =>
        p2(config),
      ),
      await ejecutar("P3", "Serializable con reintento (últimos admins)", config, () =>
        p3(config, corridas),
      ),
      await ejecutar("P4", "Errores tipados: CUIT duplicado y EXCLUDE con btree_gist", config, () =>
        p4(config),
      ),
      await ejecutar("P5", "numeric y bigint ida y vuelta como texto", config, () => p5(config)),
      {
        prueba: "P6",
        titulo: "Tipos generados desde la base; importación prohibida",
        estado: "no_aplica",
        detalle:
          "Se verifica en el CI (generador de tipos contra una base migrada y regla de arquitectura), no en la función de Vercel.",
        milisegundos: 0,
      },
      await ejecutar("P7", "Independencia: repositorio con Kysely y con pg directo", config, () =>
        p7(config),
      ),
    );
    const pruebaLatencia = await ejecutar(
      "P8",
      "Transacción interactiva desde la función de Vercel",
      config,
      async () => ({
        estado: "pasa" as Estado,
        detalle: `Las transacciones de P1, P3 y P4 (BEGIN, varias sentencias, COMMIT) corrieron dentro de esta función. ${await latencia(config)}`,
      }),
    );
    const p1a = resultados.find((r) => r.prueba === "P1");
    const p3a = resultados.find((r) => r.prueba === "P3");
    if (pruebaLatencia.estado === "pasa" && (p1a?.estado !== "pasa" || p3a?.estado !== "pasa")) {
      pruebaLatencia.detalle +=
        " Atención: P1 o P3 no pasaron, así que esta prueba solo confirma que hay conexión.";
    }
    resultados.push(pruebaLatencia);
  } finally {
    await sqlDirecto(config.urlDirecta, SQL_LIMPIAR).catch(() => undefined);
  }

  const fallas = resultados.filter((r) => r.estado === "falla").map((r) => r.prueba);
  return {
    entorno: {},
    resultados,
    resumen:
      fallas.length === 0 ? "Todas las pruebas aplicables pasan." : `Fallan: ${fallas.join(", ")}.`,
  };
}

// ---------- punto de entrada de la función de Vercel ----------

function hostTienePooler(url: string): boolean {
  try {
    return new URL(url).hostname.includes("-pooler");
  } catch {
    return false;
  }
}

/** Identificador del endpoint de Neon (`ep-…`), sin `-pooler`. No es un secreto; permite comparar ramas. */
function endpointDe(url: string | undefined): string {
  try {
    if (!url) return "(falta)";
    const primera = new URL(url).hostname.split(".")[0] ?? "";
    return primera.replace(/-pooler$/, "");
  } catch {
    return "(inválida)";
  }
}

function hostDe(url: string | undefined): string {
  try {
    return url ? new URL(url).hostname.replace(/^[^.]*/, (e) => e.replace(/./g, "*")) : "(falta)";
  } catch {
    return "(inválida)";
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    const entorno = process.env.VERCEL_ENV ?? "local";
    if (entorno === "production") {
      return Response.json({ error: "El spike no corre en producción." }, { status: 403 });
    }
    const config = {
      urlPooler: process.env.DATABASE_URL ?? "",
      urlDirecta: process.env.DATABASE_URL_UNPOOLED ?? "",
    };
    const info = {
      vercelEnv: entorno,
      regionVercel: process.env.VERCEL_REGION ?? "(desconocida)",
      node: process.version,
      tieneDatabaseUrl: config.urlPooler !== "",
      tieneDatabaseUrlUnpooled: config.urlDirecta !== "",
      databaseUrlEsPooler: hostTienePooler(config.urlPooler),
      databaseUrlUnpooledEsDirecta:
        config.urlDirecta !== "" && !config.urlDirecta.includes("-pooler"),
      hostPooler: hostDe(config.urlPooler),
      endpointPooler: endpointDe(config.urlPooler),
      endpointDirecto: endpointDe(config.urlDirecta),
      mismoEndpoint: endpointDe(config.urlPooler) === endpointDe(config.urlDirecta),
    };
    const problemas = validarEntorno(config);
    if (problemas.length === 0 && !info.mismoEndpoint) {
      problemas.push(
        "DATABASE_URL y DATABASE_URL_UNPOOLED apuntan a endpoints distintos (ramas de Neon distintas): el spike crearía los objetos en una y probaría en la otra. Cargá ambas desde la misma rama.",
      );
    }
    if (problemas.length > 0) {
      return Response.json({ entorno: info, problemas }, { status: 412 });
    }
    const url = new URL(request.url);
    const rapido = url.searchParams.get("rapido") === "1";
    const informe = await ejecutarSpike(config, rapido ? { iteraciones: 120, corridas: 10 } : {});
    return Response.json({ ...informe, entorno: info });
  },
};
