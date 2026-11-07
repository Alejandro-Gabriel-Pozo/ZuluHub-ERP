import { sql, type Kysely } from "kysely";
import pg from "pg";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
  vi,
} from "vitest";
import { crearConexionDeAutenticacion } from "../../src/adaptadores/postgres/conexion-de-autenticacion";
import { ErrorDeConexionDeBase } from "../../src/adaptadores/postgres/errores";
import { cantidadDePozosAbiertos } from "../../src/adaptadores/postgres/pozos";
import {
  crearTransacciones,
  type SinTablas,
  type TransaccionesDePostgres,
} from "../../src/adaptadores/postgres/transacciones";
import type { Contexto } from "../../src/contexto/contexto";
import type { ErrorDePersistencia } from "../../src/puertos/transacciones";
import { ok, type Resultado } from "../../src/primitivas/resultado/resultado";
import { crearBaseAparte } from "./entorno";

/**
 * Un CORTE de la conexión a mitad de una transacción (el servidor mata el backend: `pg_terminate_backend`, que es lo mismo que ve la app
 * cuando Neon reinicia el cómputo o se cae la red), contra Postgres real y con pozo de 1 y de varias conexiones.
 *
 * Previene (cada protección tiene su violación inyectada en este archivo o en `pozos.test.ts` / `errores.test.ts`):
 *  - que el 'error' del cliente prestado, sin oyente (pg-pool lo saca mientras la conexión está prestada), tire abajo el proceso;
 *  - que el corte salga como excepción cruda (con host y detalle) en vez de un error tipado y genérico;
 *  - que la conexión rota vuelva al pozo y el siguiente pedido la reciba muerta, o que quede una transacción «idle in transaction»;
 *  - que la transacción quede a medias (atomicidad) o que reintentar con la misma clave duplique el efecto (idempotencia);
 *  - que el pozo agotado del rol de autenticación (la librería de ingreso) salga como excepción cruda y no tipada como el de la app.
 */

const base = inject("baseDePruebas");
const CONTEXTO: Contexto = { tipo: "TRABAJOS", ahora: new Date("2026-11-07T12:00:00Z") };
const esperar = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

type Corte = "ENTRE_SENTENCIAS" | "SENTENCIA_EN_CURSO" | "ANTES_DE_CONFIRMAR";

describe.skipIf(base === null)("corte de conexión a mitad de una transacción", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let observador: pg.Client;
  let nombreDeLaBase = "";
  const abiertas: TransaccionesDePostgres<Kysely<SinTablas>>[] = [];
  const noCapturadas: Error[] = [];
  const alNoCapturar = (error: Error) => noCapturadas.push(error);

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    observador = new pg.Client({ connectionString: propia.base.dueno });
    await observador.connect();
    nombreDeLaBase = new URL(propia.base.dueno).pathname.slice(1);
    // Una tabla propia de la prueba, con clave única: el efecto que no debe quedar a medias ni duplicarse.
    await observador.query(
      "create table corte_prueba (clave text primary key, valor integer not null)",
    );
  });
  afterAll(async () => {
    await observador.end();
    await propia.destruir();
  });
  beforeEach(async () => {
    noCapturadas.length = 0;
    // Vitest también registra por su cuenta toda excepción sin atrapar y falla la corrida; esto lo hace explícito en cada caso.
    process.on("uncaughtException", alNoCapturar);
    await observador.query("truncate corte_prueba");
  });
  afterEach(async () => {
    process.off("uncaughtException", alNoCapturar);
    await Promise.all(abiertas.splice(0).map((t) => t.cerrar()));
    expect(cantidadDePozosAbiertos()).toBe(0);
  });

  function armar(maximoDeConexiones: number) {
    if (base === null) throw new Error("sin base");
    const registrados: string[] = [];
    const transacciones = crearTransacciones<Kysely<SinTablas>>({
      urls: { TRABAJOS: propia.base.dueno },
      clave: base.clave,
      armar: (db) => db,
      maximoDeConexiones,
      plazoParaConseguirConexionEnMs: 1_000,
      alRegistrarErrorInesperado: (e) => registrados.push(e.mensaje),
    });
    abiertas.push(transacciones);
    return { transacciones, registrados };
  }

  const filas = async (): Promise<string[]> =>
    (
      await observador.query<{ clave: string }>("select clave from corte_prueba order by clave")
    ).rows.map((f) => f.clave);

  const enTransaccionAbierta = async (): Promise<number> =>
    Number(
      (
        await observador.query<{ n: string }>(
          `select count(*)::text as n from pg_stat_activity
           where datname = $1 and state like 'idle in transaction%' and pid <> pg_backend_pid()`,
          [nombreDeLaBase],
        )
      ).rows[0]?.n,
    );

  /** Espera a que el servidor no tenga ninguna transacción abierta (el rollback de una conexión muerta es del servidor, no inmediato). */
  const sinTransaccionesAbiertas = async (): Promise<boolean> => {
    const limite = Date.now() + 3_000;
    while (Date.now() < limite) {
      if ((await enTransaccionAbierta()) === 0) return true;
      await esperar(25);
    }
    return false;
  };

  /** El trabajo: escribe la clave, y en el punto indicado el servidor mata la conexión de ESTA transacción. */
  function registrar(
    transacciones: TransaccionesDePostgres<Kysely<SinTablas>>,
    clave: string,
    corte: Corte | null,
  ): Promise<Resultado<string, ErrorDePersistencia>> {
    return transacciones.ejecutar({ contexto: CONTEXTO }, async (db) => {
      const { rows } = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(db);
      const pid = (rows[0] as { pid: number }).pid;
      await sql`insert into corte_prueba (clave, valor) values (${clave}, 1)
                on conflict (clave) do nothing`.execute(db);
      if (corte === "ENTRE_SENTENCIAS") {
        await observador.query("select pg_terminate_backend($1)", [pid]);
        await esperar(150);
        await sql`select 1`.execute(db);
      } else if (corte === "SENTENCIA_EN_CURSO") {
        setTimeout(() => void observador.query("select pg_terminate_backend($1)", [pid]), 150);
        await sql`select pg_sleep(30)`.execute(db);
      } else if (corte === "ANTES_DE_CONFIRMAR") {
        await observador.query("select pg_terminate_backend($1)", [pid]);
        await esperar(150);
      }
      return ok(clave);
    });
  }

  const CORTES: readonly Corte[] = ["ENTRE_SENTENCIAS", "SENTENCIA_EN_CURSO", "ANTES_DE_CONFIRMAR"];

  describe.each([1, 3])("con un pozo de %i conexión(es)", (maximo) => {
    it.each(CORTES)(
      "corte %s: el proceso sigue vivo y el corte sale como error tipado y genérico",
      async (corte) => {
        const { transacciones, registrados } = armar(maximo);
        const r = await registrar(transacciones, "a", corte);
        await esperar(300);
        expect(noCapturadas).toEqual([]);
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.error.tipo).toBe("Inesperado");
        // Sin host, puerto, usuario ni cadena: el mensaje es el genérico, no el de `pg` ni el del sistema.
        const texto = JSON.stringify(r.error) + registrados.join("|");
        for (const prohibido of ["127.0.0.1", "localhost", "pedernal_", "postgres://", "55432"]) {
          expect(texto).not.toContain(prohibido);
        }
        expect(registrados.length).toBeGreaterThan(0);
      },
    );

    it.each(CORTES)(
      "corte %s: la siguiente petición anda, no queda ninguna transacción abierta y nada quedó a medias",
      async (corte) => {
        const { transacciones } = armar(maximo);
        await registrar(transacciones, "cortada", corte);
        await esperar(300);
        // La siguiente petición anda (la conexión muerta no volvió al pozo, o se descartó al pedirla).
        const siguiente = await registrar(transacciones, "siguiente", null);
        expect(siguiente).toEqual(ok("siguiente"));
        expect(await sinTransaccionesAbiertas()).toBe(true);
        // Atomicidad: lo escrito dentro de la transacción cortada NO quedó; solo está lo de la petición sana.
        expect(await filas()).toEqual(["siguiente"]);
        expect(noCapturadas).toEqual([]);
      },
    );

    it.each(CORTES)(
      "corte %s: reintentar con la misma clave deja el efecto una sola vez, aunque se repita",
      async (corte) => {
        const { transacciones } = armar(maximo);
        const primera = await registrar(transacciones, "pago-1", corte);
        expect(primera.ok).toBe(false);
        expect(await filas()).toEqual([]);
        expect(await registrar(transacciones, "pago-1", null)).toEqual(ok("pago-1"));
        expect(await registrar(transacciones, "pago-1", null)).toEqual(ok("pago-1"));
        expect(await filas()).toEqual(["pago-1"]);
      },
    );
  });

  it("varias transacciones a la vez cortadas no dejan el pozo con conexiones muertas", async () => {
    const { transacciones } = armar(3);
    const resultados = await Promise.all([
      registrar(transacciones, "x1", "ENTRE_SENTENCIAS"),
      registrar(transacciones, "x2", "SENTENCIA_EN_CURSO"),
      registrar(transacciones, "x3", "ANTES_DE_CONFIRMAR"),
    ]);
    await esperar(300);
    expect(resultados.every((r) => !r.ok)).toBe(true);
    for (const clave of ["s1", "s2", "s3", "s4"]) {
      expect(await registrar(transacciones, clave, null)).toEqual(ok(clave));
    }
    expect(await filas()).toEqual(["s1", "s2", "s3", "s4"]);
    expect(await sinTransaccionesAbiertas()).toBe(true);
    expect(noCapturadas).toEqual([]);
  });

  it("un corte durante lecturas compartidas del pedido sale tipado y la siguiente lectura anda", async () => {
    const { transacciones } = armar(1);
    const leer = () =>
      transacciones.conLecturasCompartidas(CONTEXTO, async () => {
        const uno = await transacciones.ejecutar(
          { contexto: CONTEXTO, soloLectura: true, aislamiento: "read committed" },
          async (db) => {
            const { rows } = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(db);
            return ok((rows[0] as { pid: number }).pid);
          },
        );
        if (!uno.ok) return uno;
        await observador.query("select pg_terminate_backend($1)", [uno.valor]);
        await esperar(150);
        return transacciones.ejecutar(
          { contexto: CONTEXTO, soloLectura: true, aislamiento: "read committed" },
          async (db) => {
            await sql`select 1`.execute(db);
            return ok("leído");
          },
        );
      });
    const cortada = await leer();
    await esperar(300);
    expect(cortada.ok).toBe(false);
    if (!cortada.ok) expect(cortada.error.tipo).toBe("Inesperado");
    const sana = await transacciones.ejecutar({ contexto: CONTEXTO }, async (db) => {
      await sql`select 1`.execute(db);
      return ok("sana");
    });
    expect(sana).toEqual(ok("sana"));
    expect(await sinTransaccionesAbiertas()).toBe(true);
    expect(noCapturadas).toEqual([]);
  });

  describe("el pozo del rol de autenticación (la librería de ingreso)", () => {
    it("agotado, falla con el mismo error tipado y genérico que el pozo de la app, sin detalle", async () => {
      if (base === null) return;
      const conexion = crearConexionDeAutenticacion({
        url: propia.base.autenticacion,
        maximoDeConexiones: 1,
        plazoParaConseguirConexionEnMs: 200,
      });
      try {
        let error: unknown;
        // Una consulta retiene la única conexión; otra pide la suya y se le acaba la espera.
        await conexion.db.connection().execute(async () => {
          try {
            await sql`select 1`.execute(conexion.db);
          } catch (e) {
            error = e;
          }
        });
        expect(error).toBeInstanceOf(ErrorDeConexionDeBase);
        expect((error as ErrorDeConexionDeBase).causa).toBe("POZO_AGOTADO");
        expect((error as Error).message).toBe(
          "no hubo una conexión libre a la base a tiempo (pozo agotado)",
        );
      } finally {
        await conexion.cerrar();
      }
    });

    it("un corte de la conexión prestada no tira el proceso y la siguiente consulta anda", async () => {
      if (base === null) return;
      const conexion = crearConexionDeAutenticacion({
        url: propia.base.autenticacion,
        maximoDeConexiones: 1,
      });
      try {
        await conexion.db.connection().execute(async (c) => {
          const { rows } = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(c);
          await observador.query("select pg_terminate_backend($1)", [
            (rows[0] as { pid: number }).pid,
          ]);
          await esperar(150);
          await sql`select 1`.execute(c).then(
            () => undefined,
            () => undefined,
          );
        });
        await esperar(300);
        expect(noCapturadas).toEqual([]);
        await expect(sql`select 1 as uno`.execute(conexion.db)).resolves.toBeTruthy();
        expect(await sinTransaccionesAbiertas()).toBe(true);
      } finally {
        await conexion.cerrar();
      }
    });
  });
});

vi.setConfig({ testTimeout: 60_000 });
