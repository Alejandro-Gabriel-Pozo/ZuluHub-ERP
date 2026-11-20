import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  aplicarCambioDeLaConsola,
  leerEstadoDeLaConsola,
  type CambioDeLaConsola,
} from "../../src/adaptadores/postgres/consola-de-plataforma";
import { crearBaseAparte } from "./entorno";
import { sufijoUnico } from "./unicos";

/**
 * Lo que `cargar-entorno-consola` hace en la base, contra una base real y con roles PROPIOS de la prueba (los roles son del servidor
 * entero: no se toca ninguno de Pedernal). Previene: una clave o un login que quede a medias si Vercel falla, una clave instalada
 * dos veces, dos corridas simultáneas que se pisan, y una vigencia que no se extienda.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

describe.skipIf(base === null)("consola de plataforma contra una base real", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let admin: pg.Client;
  let dueno: pg.Client;
  const sufijo = sufijoUnico()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const ROL_A = `prueba_consola_a_${sufijo}`;
  const ROL_B = `prueba_consola_b_${sufijo}`;
  const opciones = { rolesPermitidos: [ROL_A, ROL_B] };
  const secreto = (n: number) => Buffer.alloc(32, n);

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    admin = new pg.Client({ connectionString: base.admin });
    await admin.connect();
    for (const rol of [ROL_A, ROL_B]) await admin.query(`CREATE ROLE ${rol} NOLOGIN`);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await propia.destruir();
    for (const rol of [ROL_A, ROL_B]) await admin.query(`DROP ROLE IF EXISTS ${rol}`);
    await admin.end();
  });

  const rol = async (nombre: string) =>
    (
      await dueno.query<{ entra: boolean; vence: Date | null }>(
        "select rolcanlogin as entra, rolvaliduntil as vence from pg_roles where rolname = $1",
        [nombre],
      )
    ).rows[0];
  const claves = async () =>
    (await dueno.query<{ kid: number }>("select kid from contexto_clave order by kid")).rows.map(
      (f) => f.kid,
    );
  const cambio = (
    kid: number,
    n: number,
    logins: CambioDeLaConsola["loginsNuevos"] = [],
  ): CambioDeLaConsola => ({
    claveDeContexto: { kid, secreto: secreto(n) },
    loginsNuevos: logins,
    renovar: [],
  });

  it("confirma: instala la clave y abre el login con vigencia de ~90 días", async () => {
    const antes = await claves();
    const ok = await aplicarCambioDeLaConsola(
      propia.base.dueno,
      cambio(3, 1, [{ rol: ROL_A, clave: "clave-de-prueba-1" }]),
      () => Promise.resolve(true),
      opciones,
    );
    expect(ok).toBe(true);
    expect(await claves()).toEqual([...antes, 3]);
    const a = await rol(ROL_A);
    expect(a?.entra).toBe(true);
    const dias = ((a?.vence?.getTime() ?? 0) - Date.now()) / 86_400_000;
    expect(dias).toBeGreaterThan(89);
    expect(dias).toBeLessThan(91);
    expect((await leerEstadoDeLaConsola(propia.base.dueno)).kidMaximo).toBe(3);
  });

  it("si lo que corre mientras la transacción está abierta devuelve false o falla, no queda NADA: ni la clave ni el login", async () => {
    for (const entreTanto of [
      () => Promise.resolve(false),
      () => Promise.reject(new Error("Vercel cayó")),
    ]) {
      const antes = await claves();
      const resultado = aplicarCambioDeLaConsola(
        propia.base.dueno,
        cambio(4, 2, [{ rol: ROL_B, clave: "clave-de-prueba-2" }]),
        entreTanto,
        opciones,
      );
      await resultado.then(
        (r) => expect(r).toBe(false),
        (e) => expect(String(e)).toContain("Vercel cayó"),
      );
      expect(await claves()).toEqual(antes);
      expect((await rol(ROL_B))?.entra).toBe(false);
    }
  });

  it("repetir la misma clave es idempotente; el mismo kid con OTRO secreto falla y no toca el login", async () => {
    const antes = await claves();
    expect(
      await aplicarCambioDeLaConsola(
        propia.base.dueno,
        cambio(3, 1),
        () => Promise.resolve(true),
        opciones,
      ),
    ).toBe(true);
    expect(await claves()).toEqual(antes);
    await expect(
      aplicarCambioDeLaConsola(
        propia.base.dueno,
        cambio(3, 9, [{ rol: ROL_B, clave: "clave-de-prueba-3" }]),
        () => Promise.resolve(true),
        opciones,
      ),
    ).rejects.toThrow("otro secreto");
    expect((await rol(ROL_B))?.entra).toBe(false);
  });

  it("dos corridas simultáneas con el mismo kid y secretos distintos: una confirma y la otra falla (nunca dos claves para el mismo kid)", async () => {
    const lento = async () => {
      await new Promise((r) => setTimeout(r, 300));
      return true;
    };
    const resultados = await Promise.allSettled([
      aplicarCambioDeLaConsola(propia.base.dueno, cambio(5, 11), lento, opciones),
      aplicarCambioDeLaConsola(propia.base.dueno, cambio(5, 12), lento, opciones),
    ]);
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(resultados.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect((await claves()).filter((k) => k === 5)).toHaveLength(1);
  });

  it("renovar extiende la vigencia sin cerrar el login", async () => {
    const manana = new Date(Date.now() + 86_400_000).toISOString();
    await dueno.query(`ALTER ROLE ${ROL_A} VALID UNTIL '${manana}'`);
    const ok = await aplicarCambioDeLaConsola(
      propia.base.dueno,
      { claveDeContexto: null, loginsNuevos: [], renovar: [ROL_A] },
      () => Promise.resolve(true),
      opciones,
    );
    expect(ok).toBe(true);
    const a = await rol(ROL_A);
    expect(a?.entra).toBe(true);
    expect(((a?.vence?.getTime() ?? 0) - Date.now()) / 86_400_000).toBeGreaterThan(89);
  });
});
