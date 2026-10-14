import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  RETENCION_DE_LIMITES_EN_MS,
  crearBarridoDeAutenticacion,
} from "../../src/adaptadores/postgres/barrido-de-autenticacion";
import { crearConexionDeAutenticacion } from "../../src/adaptadores/postgres/conexion-de-autenticacion";
import {
  LIMITES_DE_SESION,
  vigenciaDeSesion,
} from "../../src/capacidades/autenticacion/vigencia-de-sesion";
import { crearBaseAparte } from "./entorno";

/**
 * Autenticación (W3b): el barrido de sesiones, verificaciones y contadores vencidos (lo llamará el cron de W6, que
 * no se crea acá). Con el rol de autenticación, en una transacción corta, idempotente y sin pisarse con otro
 * barrido a la vez. Y coherente con la lógica pura: borra EXACTAMENTE las sesiones que `vigenciaDeSesion` da por
 * vencidas, ni una más ni una menos.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const AHORA = new Date("2026-10-13T12:00:00.000Z");
const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const HOST = "app.marca-a.test";

describe.skipIf(base === null)("autenticación: barrido de lo vencido", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let conexion: ReturnType<typeof crearConexionDeAutenticacion>;
  let dueno: pg.Client;
  let usuario: string;

  const cuenta = async (tabla: string): Promise<number> =>
    Number(
      (await dueno.query<{ n: string }>(`select count(*) as n from autenticacion."${tabla}"`))
        .rows[0]?.n,
    );
  const vaciar = async () => {
    await dueno.query(
      `truncate autenticacion.session, autenticacion.verification, autenticacion."rateLimit"`,
    );
  };
  async function sesion(creada: Date, usada: Date, vence: Date): Promise<string> {
    const id = randomUUID();
    await dueno.query(
      `insert into autenticacion.session (id, token, "userId", host, "createdAt", "updatedAt", "expiresAt")
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [id, randomUUID(), usuario, HOST, creada, usada, vence],
    );
    return id;
  }
  const existe = async (id: string): Promise<boolean> =>
    (await dueno.query(`select 1 from autenticacion.session where id = $1`, [id])).rowCount === 1;
  const en = (ms: number) => new Date(AHORA.getTime() + ms);

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    conexion = crearConexionDeAutenticacion({ url: propia.base.autenticacion });
    usuario = (
      await dueno.query<{ id: string }>(
        `insert into autenticacion."user" (name, email, "emailVerified") values ('Barrido', $1, true) returning id`,
        [`barrido-${randomUUID().slice(0, 8)}@ejemplo.test`],
      )
    ).rows[0]?.id as string;
  });
  afterAll(async () => {
    await conexion.cerrar();
    await dueno.end();
    await propia.destruir();
  });

  it("borra las sesiones vencidas por cada una de las tres razones y deja las vigentes, con el borde exacto", async () => {
    await vaciar();
    const vigente = await sesion(en(-HORA), en(-MINUTO), en(10 * MINUTO));
    const venceJusto = await sesion(en(-HORA), en(-MINUTO), en(0));
    const venceUnMsDespues = await sesion(en(-HORA), en(-MINUTO), en(1));
    const sinUsoJusto = await sesion(en(-HORA), en(-15 * MINUTO), en(10 * MINUTO));
    const sinUsoUnMsAntes = await sesion(en(-HORA), en(-15 * MINUTO + 1), en(10 * MINUTO));
    const toperJusto = await sesion(en(-8 * HORA), en(-MINUTO), en(10 * MINUTO));
    const toperUnMsAntes = await sesion(en(-8 * HORA + 1), en(-MINUTO), en(10 * MINUTO));
    const resumen = await conexion.barrido.barrerVencidos(AHORA);
    expect(resumen).toEqual({ sesiones: 3, verificaciones: 0, limitesDePedidos: 0 });
    expect(await existe(vigente)).toBe(true);
    expect(await existe(venceUnMsDespues)).toBe(true);
    expect(await existe(sinUsoUnMsAntes)).toBe(true);
    expect(await existe(toperUnMsAntes)).toBe(true);
    expect(await existe(venceJusto)).toBe(false);
    expect(await existe(sinUsoJusto)).toBe(false);
    expect(await existe(toperJusto)).toBe(false);
  });

  it("borra EXACTAMENTE las que la lógica pura da por vencidas (rejilla de combinaciones)", async () => {
    await vaciar();
    const creadas = [-30 * MINUTO, -2 * HORA, -7 * HORA - 50 * MINUTO, -8 * HORA - MINUTO];
    const usadas = [-MINUTO, -14 * MINUTO, -15 * MINUTO, -16 * MINUTO];
    const vencen = [-MINUTO, 0, 1, 5 * MINUTO];
    const casos: { id: string; veredicto: string }[] = [];
    for (const c of creadas) {
      for (const u of usadas) {
        for (const v of vencen) {
          const id = await sesion(en(c), en(u), en(v));
          casos.push({
            id,
            veredicto: vigenciaDeSesion(
              { host: HOST, creadaEn: en(c), ultimoUso: en(u), venceEn: en(v) },
              HOST,
              AHORA,
              LIMITES_DE_SESION,
            ),
          });
        }
      }
    }
    await conexion.barrido.barrerVencidos(AHORA);
    for (const { id, veredicto } of casos) {
      expect(await existe(id), `${id}: ${veredicto}`).toBe(veredicto === "VIGENTE");
    }
    expect(casos.some((c) => c.veredicto === "VIGENTE")).toBe(true);
    expect(casos.some((c) => c.veredicto === "VENCIDA")).toBe(true);
  });

  it("borra las verificaciones vencidas y los contadores de pedidos que ya no cuentan, y deja el resto", async () => {
    await vaciar();
    for (const [k, vence] of [
      ["v-viva", en(MINUTO)],
      ["v-justo", en(0)],
      ["v-muerta", en(-HORA)],
    ] as const) {
      await dueno.query(
        `insert into autenticacion.verification (identifier, value, "expiresAt") values ($1, 'x', $2)`,
        [k, vence],
      );
    }
    const limite = AHORA.getTime() - RETENCION_DE_LIMITES_EN_MS;
    for (const [k, ultimo] of [
      ["r-reciente", AHORA.getTime() - MINUTO],
      ["r-justo", limite],
      ["r-viejo", limite - 1],
    ] as const) {
      await dueno.query(
        `insert into autenticacion."rateLimit" (key, count, "lastRequest") values ($1, 1, $2)`,
        [k, ultimo],
      );
    }
    const resumen = await conexion.barrido.barrerVencidos(AHORA);
    expect(resumen).toEqual({ sesiones: 0, verificaciones: 2, limitesDePedidos: 1 });
    const claves = (
      await dueno.query<{ identifier: string }>(`select identifier from autenticacion.verification`)
    ).rows;
    expect(claves.map((f) => f.identifier)).toEqual(["v-viva"]);
    const contadores = (
      await dueno.query<{ key: string }>(`select key from autenticacion."rateLimit" order by key`)
    ).rows;
    expect(contadores.map((f) => f.key)).toEqual(["r-justo", "r-reciente"]);
  });

  it("es idempotente: repetirlo no borra de más ni falla", async () => {
    await vaciar();
    await sesion(en(-HORA), en(-MINUTO), en(-MINUTO));
    const vigente = await sesion(en(-HORA), en(-MINUTO), en(10 * MINUTO));
    expect((await conexion.barrido.barrerVencidos(AHORA)).sesiones).toBe(1);
    for (let i = 0; i < 3; i++) {
      expect(await conexion.barrido.barrerVencidos(AHORA)).toEqual({
        sesiones: 0,
        verificaciones: 0,
        limitesDePedidos: 0,
      });
    }
    expect(await existe(vigente)).toBe(true);
    expect(await cuenta("session")).toBe(1);
  });

  it("tiene un tope de filas por pasada: la pasada siguiente sigue donde quedó", async () => {
    await vaciar();
    for (let i = 0; i < 5; i++) await sesion(en(-HORA), en(-MINUTO), en(-MINUTO - i));
    for (let i = 0; i < 5; i++) {
      await dueno.query(
        `insert into autenticacion.verification (identifier, value, "expiresAt") values ($1, 'x', $2)`,
        [`muerta-${i}`, en(-HORA)],
      );
    }
    const acotado = crearBarridoDeAutenticacion(conexion.db.withTables(), LIMITES_DE_SESION, 2);
    expect(await acotado.barrerVencidos(AHORA)).toEqual({
      sesiones: 2,
      verificaciones: 2,
      limitesDePedidos: 0,
    });
    expect(await acotado.barrerVencidos(AHORA)).toEqual({
      sesiones: 2,
      verificaciones: 2,
      limitesDePedidos: 0,
    });
    expect(await acotado.barrerVencidos(AHORA)).toEqual({
      sesiones: 1,
      verificaciones: 1,
      limitesDePedidos: 0,
    });
    expect(await acotado.barrerVencidos(AHORA)).toEqual({
      sesiones: 0,
      verificaciones: 0,
      limitesDePedidos: 0,
    });
    expect(await cuenta("session")).toBe(0);
  });

  it("varios barridos a la vez no se pisan ni se interbloquean: entre todos borran cada fila una sola vez", async () => {
    await vaciar();
    const TOTAL = 300;
    await dueno.query(
      `insert into autenticacion.session (token, "userId", host, "createdAt", "updatedAt", "expiresAt")
       select gen_random_uuid()::text, $1::uuid, $2, $3::timestamptz - interval '1 hour', $3::timestamptz - interval '20 minutes', $3::timestamptz - interval '5 minutes'
         from generate_series(1, $4)`,
      [usuario, HOST, AHORA, TOTAL],
    );
    const vigente = await sesion(en(-HORA), en(-MINUTO), en(10 * MINUTO));
    const acotado = crearBarridoDeAutenticacion(conexion.db.withTables(), LIMITES_DE_SESION, 40);
    let borradas = 0;
    for (let ronda = 0; ronda < 10 && borradas < TOTAL; ronda++) {
      const resumenes = await Promise.all(
        Array.from({ length: 4 }, () => acotado.barrerVencidos(AHORA)),
      );
      borradas += resumenes.reduce((s, r) => s + r.sesiones, 0);
    }
    expect(borradas).toBe(TOTAL);
    expect(await cuenta("session")).toBe(1);
    expect(await existe(vigente)).toBe(true);
  });

  it("lo hace con el rol de autenticación: otro rol no puede tocar ese esquema", async () => {
    const app = new pg.Client({ connectionString: propia.base.app });
    await app.connect();
    try {
      await expect(app.query(`delete from autenticacion.session`)).rejects.toMatchObject({
        code: "42501",
      });
    } finally {
      await app.end();
    }
  });
});
