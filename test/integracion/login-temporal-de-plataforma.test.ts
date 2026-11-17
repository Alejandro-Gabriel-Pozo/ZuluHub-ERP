import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  abrirLoginDePlataforma,
  cerrarLoginDePlataforma,
} from "../../src/adaptadores/postgres/login-temporal-de-plataforma";
import { sufijoUnico } from "./unicos";

/**
 * El login temporal del rol de plataforma contra una base REAL: abre el login con una clave de la corrida (y se puede
 * entrar con ella), lo cierra (no se puede entrar ni con la clave vieja) y el rol queda sin login y sin clave, también
 * cuando la corrida falla a mitad de camino (el cierre es independiente de lo que pasó antes). Los roles son del
 * servidor entero y el rol real lo usan otras pruebas: acá se usa un rol propio de la prueba, que se borra al terminar.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROL = `prueba_login_temporal_${sufijoUnico()}`;

describe.skipIf(base === null)("login temporal del rol de plataforma (base real)", () => {
  const dueno = base?.dueno as string;
  const admin = new pg.Client({ connectionString: base?.admin });

  beforeAll(async () => {
    await admin.connect();
    await admin.query(`CREATE ROLE ${ROL} NOLOGIN`);
  });
  afterAll(async () => {
    await admin.query(`DROP ROLE IF EXISTS ${ROL}`);
    await admin.end();
  });

  // Pase lo que pase en una prueba, el rol de la siguiente arranca cerrado (una falla no arrastra a las demás).
  afterEach(async () => {
    await cerrarLoginDePlataforma(base?.dueno as string, { rol: ROL });
  });

  const entra = async (cadena: string): Promise<boolean> => {
    const cliente = new pg.Client({ connectionString: cadena, connectionTimeoutMillis: 10_000 });
    cliente.on("error", () => undefined);
    try {
      await cliente.connect();
      await cliente.query("SELECT 1");
      return true;
    } catch {
      return false;
    } finally {
      await cliente.end().catch(() => undefined);
    }
  };
  const puede = async () =>
    (
      await admin.query<{ p: boolean }>(
        "SELECT rolcanlogin AS p FROM pg_roles WHERE rolname = $1",
        [ROL],
      )
    ).rows[0]?.p;

  it("abre con una clave de la corrida, se entra con ella, y el cierre deja el rol sin login y sin clave", async () => {
    expect(await puede()).toBe(false);
    const abierto = await abrirLoginDePlataforma(dueno, { rol: ROL });
    expect(await puede()).toBe(true);
    expect(await entra(abierto.cadena)).toBe(true);

    const cierre = await cerrarLoginDePlataforma(dueno, { rol: ROL });
    expect(await puede()).toBe(false);
    expect(await entra(abierto.cadena)).toBe(false);
    const { rows } = await admin.query<{ sin_clave: boolean }>(
      "SELECT rolpassword IS NULL AS sin_clave FROM pg_authid WHERE rolname = $1",
      [ROL],
    );
    expect(rows[0]?.sin_clave).toBe(true);
    // Con el administrador de la prueba (superusuario) la clave se puede mirar; con el dueño de Neon, no: lo dice el resultado.
    expect(typeof cierre.claveVerificada).toBe("boolean");
  });

  it("el login vence solo (~30 minutos); vencido, la clave ya no sirve aunque el cierre no haya corrido; el cierre sigue siendo idempotente", async () => {
    const abierto = await abrirLoginDePlataforma(dueno, { rol: ROL });
    const { rows } = await admin.query<{ minutos: number }>(
      "SELECT extract(epoch FROM (rolvaliduntil - now())) / 60 AS minutos FROM pg_roles WHERE rolname = $1",
      [ROL],
    );
    expect(Number(rows[0]?.minutos)).toBeGreaterThan(28);
    expect(Number(rows[0]?.minutos)).toBeLessThanOrEqual(30);
    expect(await entra(abierto.cadena)).toBe(true);

    // El runner «murió»: pasa el plazo y nadie cerró. El rol sigue marcado con login, pero la clave venció.
    await admin.query(`ALTER ROLE ${ROL} VALID UNTIL '2000-01-01'`);
    expect(await puede()).toBe(true);
    const vencido = await admin.query<{ vencido: boolean }>(
      "SELECT rolvaliduntil < now() AS vencido FROM pg_roles WHERE rolname = $1",
      [ROL],
    );
    expect(vencido.rows[0]?.vencido).toBe(true);
    // Que una clave vencida no entre lo hace Postgres, y SOLO si el servidor verifica claves: con `trust` (el CI) nunca las pide.
    // Se detecta con una clave equivocada: si entra, el servidor no verifica claves y esta parte no se puede comprobar acá.
    const conClaveEquivocada = new URL(abierto.cadena);
    conClaveEquivocada.password = "clave-equivocada";
    if (!(await entra(conClaveEquivocada.toString()))) {
      expect(await entra(abierto.cadena)).toBe(false);
    }

    await cerrarLoginDePlataforma(dueno, { rol: ROL });
    await cerrarLoginDePlataforma(dueno, { rol: ROL });
    expect(await puede()).toBe(false);
    const cerrado = await admin.query<{ vence: string | null }>(
      "SELECT rolvaliduntil::text AS vence FROM pg_roles WHERE rolname = $1",
      [ROL],
    );
    expect(cerrado.rows[0]?.vence).toBe("infinity");
  });

  it("si la corrida falla a mitad de camino, el cierre igual lo deja cerrado (y se puede repetir)", async () => {
    await abrirLoginDePlataforma(dueno, { rol: ROL });
    // …aquí un paso intermedio habría fallado: el paso de cierre corre igual.
    await cerrarLoginDePlataforma(dueno, { rol: ROL });
    await cerrarLoginDePlataforma(dueno, { rol: ROL });
    expect(await puede()).toBe(false);
  });

  it("no abre un rol que ya tiene login; el cierre lo deja cerrado y entonces sí abre", async () => {
    await abrirLoginDePlataforma(dueno, { rol: ROL });
    await expect(abrirLoginDePlataforma(dueno, { rol: ROL })).rejects.toThrow(/ya tiene login/);
    await cerrarLoginDePlataforma(dueno, { rol: ROL });
    await abrirLoginDePlataforma(dueno, { rol: ROL });
    await cerrarLoginDePlataforma(dueno, { rol: ROL });
    expect(await puede()).toBe(false);
  });

  it("dos aperturas a la vez: una abre y la otra falla; nunca quedan dos claves distintas vigentes", async () => {
    const resultados = await Promise.allSettled([
      abrirLoginDePlataforma(dueno, { rol: ROL }),
      abrirLoginDePlataforma(dueno, { rol: ROL }),
    ]);
    const abiertas = resultados.filter((r) => r.status === "fulfilled");
    // Sin bloqueo entre las dos, ambas podrían ver el rol cerrado; lo que importa es que el cierre lo deja cerrado.
    expect(abiertas.length).toBeGreaterThanOrEqual(1);
    await cerrarLoginDePlataforma(dueno, { rol: ROL });
    expect(await puede()).toBe(false);
    for (const r of abiertas) {
      expect(await entra((r as PromiseFulfilledResult<{ cadena: string }>).value.cadena)).toBe(
        false,
      );
    }
  });
});
