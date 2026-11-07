import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { crearLecturasDeSistema } from "../../src/adaptadores/postgres/lecturas-de-sistema";
import {
  CONEXIONES_POR_POZO,
  cantidadDePozosAbiertos,
  tomarPozo,
} from "../../src/adaptadores/postgres/pozos";
import { crearTransaccionesPublicas } from "../../src/adaptadores/postgres/transacciones-publicas";
import { armarConexiones } from "../../src/composicion/conexiones";
import { ok } from "../../src/primitivas/resultado/resultado";
import { usuarioAuthId } from "../../src/primitivas/identificadores/marca";
import {
  comoEmpresa,
  comoInvitacion,
  comoSesion,
  crearBaseAparte,
  crearEmpresaActiva,
  crearEntornoDePrueba,
  type EmpresaDePrueba,
} from "./entorno";

/**
 * UN pozo por rol en cada proceso (`pozos.ts`): las puertas que entran con el mismo rol (operativa, invitación, sesión) y las lecturas del
 * sistema comparten conexiones, y compartirlas no mezcla nada de una empresa con otra. Se prueba contra Postgres real y mirando las
 * conexiones DEL SERVIDOR (`pg_stat_activity`), no las que cree tener la aplicación.
 *  - Una conexión que vuelve al pozo NO conserva el contexto de la empresa anterior.
 *  - 40 pedidos a la vez de empresas distintas no se cruzan ni pasan del tope de conexiones.
 *  - Con el pozo agotado el pedido espera su turno o falla cerrado, y nunca se abre una conexión de más.
 *  - Cada pieza que cierra suelta lo suyo; con la última, el pozo se cierra y no queda ninguna conexión.
 */

const base = inject("baseDePruebas");

describe.skipIf(base === null)("un pozo por rol", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let observador: pg.Client;
  let a: EmpresaDePrueba;
  let b: EmpresaDePrueba;
  let c: EmpresaDePrueba;
  let rolDeLaApp = "";
  let nombreDeLaBase = "";

  /** Cuántas conexiones tiene abiertas el rol en la base de la prueba, según el SERVIDOR. */
  async function conexionesDe(rol = rolDeLaApp): Promise<number> {
    const { rows } = await observador.query<{ n: string }>(
      `select count(*)::text as n from pg_stat_activity where datname = $1 and usename = $2`,
      [nombreDeLaBase, rol],
    );
    return Number(rows[0]?.n ?? 0);
  }
  /** Mira las conexiones cada pocos milisegundos mientras corre `trabajo` y devuelve el pico. */
  async function picoDurante(trabajo: () => Promise<unknown>, rol = rolDeLaApp): Promise<number> {
    let pico = 0;
    let midiendo = true;
    const muestreo = (async () => {
      while (midiendo) {
        pico = Math.max(pico, await conexionesDe(rol));
        await new Promise((r) => setTimeout(r, 5));
      }
    })();
    try {
      await trabajo();
    } finally {
      midiendo = false;
      await muestreo;
    }
    return pico;
  }
  const hastaQue = async (condicion: () => Promise<boolean>, ms = 3000): Promise<boolean> => {
    const limite = Date.now() + ms;
    while (Date.now() < limite) {
      if (await condicion()) return true;
      await new Promise((r) => setTimeout(r, 25));
    }
    return condicion();
  };

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    observador = new pg.Client({ connectionString: propia.base.dueno });
    await observador.connect();
    rolDeLaApp = decodeURIComponent(new URL(propia.base.app).username);
    nombreDeLaBase = new URL(propia.base.app).pathname.slice(1);
    const entorno = crearEntornoDePrueba(propia.base, 3);
    a = await crearEmpresaActiva(entorno);
    b = await crearEmpresaActiva(entorno);
    c = await crearEmpresaActiva(entorno);
    await entorno.cerrar();
  });
  afterAll(async () => {
    await observador.end();
    await propia.destruir();
    expect(cantidadDePozosAbiertos()).toBe(0);
  });

  const empresaQueVe = async (
    entorno: ReturnType<typeof crearEntornoDePrueba>,
    contexto: ReturnType<typeof comoEmpresa>,
    espera = 0,
  ) => {
    const r = await entorno.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async ({ db }) => {
        const { rows } = await sql<{
          e: string;
          pid: number;
        }>`select app_empresa_id()::text as e, pg_backend_pid() as pid`.execute(db);
        if (espera > 0) await sql`select pg_sleep(${espera})`.execute(db);
        return ok(rows[0] ?? { e: "", pid: 0 });
      },
    );
    if (!r.ok) throw new Error(`falló la lectura: ${JSON.stringify(r.error)}`);
    return r.valor;
  };

  describe("una conexión reutilizada no conserva nada de la empresa anterior", () => {
    type Fila = { ctx: string | null; e: string | null; pid: number };
    const SUELTA = `select current_setting('app.ctx', true) as ctx, app_empresa_id()::text as e, pg_backend_pid() as pid`;

    it("con un pozo de UNA sola conexión: A, B y una consulta suelta usan la misma y cada una ve lo suyo (nada de A en B)", async () => {
      const entorno = crearEntornoDePrueba(propia.base, 1);
      // La misma cadena y el mismo tope: es el pozo del entorno, para mirar la conexión sin contexto.
      const suelto = tomarPozo({ url: propia.base.app, maximoDeConexiones: 1 });
      try {
        const deA = await empresaQueVe(entorno, comoEmpresa(a.empresa));
        const crudo1 = await suelto.pozo.query<Fila>(SUELTA);
        const deB = await empresaQueVe(entorno, comoEmpresa(b.empresa));
        const crudo2 = await suelto.pozo.query<Fila>(SUELTA);
        expect(deA.e).toBe(a.empresa);
        expect(deB.e).toBe(b.empresa);
        // Es LA MISMA conexión del servidor las cuatro veces...
        const pids = new Set([deA.pid, deB.pid, crudo1.rows[0]?.pid, crudo2.rows[0]?.pid]);
        expect(pids.size).toBe(1);
        // ...y fuera de una transacción no queda contexto ni empresa: lo fijado valía solo dentro de la transacción.
        for (const fila of [crudo1.rows[0], crudo2.rows[0]]) {
          expect(fila?.ctx === null || fila?.ctx === "").toBe(true);
          expect(fila?.e).toBeNull();
        }
      } finally {
        await suelto.soltar();
        await entorno.cerrar();
      }
    });

    it("tampoco queda después de una transacción que se revierte o que falla a mitad de camino", async () => {
      const entorno = crearEntornoDePrueba(propia.base, 1);
      const suelto = tomarPozo({ url: propia.base.app, maximoDeConexiones: 1 });
      try {
        const revertida = await entorno.ejecutar(
          { contexto: comoEmpresa(a.empresa), aislamiento: "read committed" },
          () => Promise.resolve({ ok: false as const, error: "NEGOCIO" }),
        );
        expect(revertida).toEqual({ ok: false, error: "NEGOCIO" });
        const fallida = await entorno.ejecutar(
          { contexto: comoEmpresa(a.empresa), aislamiento: "read committed" },
          async ({ db }) => {
            await sql`select columna_que_no_existe from empresa`.execute(db);
            return ok(1);
          },
        );
        expect(fallida.ok).toBe(false);
        const { rows } = await suelto.pozo.query<{ e: string | null }>(
          `select app_empresa_id()::text as e`,
        );
        expect(rows[0]?.e).toBeNull();
        expect((await empresaQueVe(entorno, comoEmpresa(b.empresa))).e).toBe(b.empresa);
      } finally {
        await suelto.soltar();
        await entorno.cerrar();
      }
    });

    it("sin contexto firmado en la transacción, la conexión que antes sirvió a una empresa no ve ninguna (el aislamiento sigue siendo de la base)", async () => {
      const entorno = crearEntornoDePrueba(propia.base, 1);
      const suelto = tomarPozo({ url: propia.base.app, maximoDeConexiones: 1 });
      try {
        await empresaQueVe(entorno, comoEmpresa(a.empresa));
        const { rows } = await suelto.pozo.query<{ n: string }>(
          `select count(*)::text as n from empresa`,
        );
        expect(rows[0]?.n).toBe("0");
      } finally {
        await suelto.soltar();
        await entorno.cerrar();
      }
    });
  });

  describe("muchos pedidos a la vez", () => {
    it("40 pedidos de tres empresas sobre un pozo de 3 no se cruzan, todos terminan y el servidor nunca ve más de 3 conexiones", async () => {
      const entorno = crearEntornoDePrueba(propia.base, CONEXIONES_POR_POZO);
      try {
        const empresas = [a, b, c];
        let resultados: Array<{ esperada: string; vista: string }> = [];
        const pico = await picoDurante(async () => {
          resultados = await Promise.all(
            Array.from({ length: 40 }, async (_, i) => {
              const e = empresas[i % 3] as EmpresaDePrueba;
              const vista = await empresaQueVe(entorno, comoEmpresa(e.empresa), 0.01);
              return { esperada: e.empresa, vista: vista.e };
            }),
          );
        });
        expect(resultados).toHaveLength(40);
        for (const r of resultados) expect(r.vista).toBe(r.esperada);
        expect(pico).toBeGreaterThan(0);
        expect(pico).toBeLessThanOrEqual(CONEXIONES_POR_POZO);
      } finally {
        await entorno.cerrar();
      }
    });

    it("las puertas con el mismo rol (operativa, sesión e invitación) comparten el pozo: juntas no pasan del tope", async () => {
      const entorno = crearEntornoDePrueba(propia.base, CONEXIONES_POR_POZO);
      try {
        const antes = cantidadDePozosAbiertos();
        const usuario = usuarioAuthId("11111111-1111-4111-8111-111111111111");
        const pico = await picoDurante(async () => {
          await Promise.all(
            Array.from({ length: 30 }, (_, i) => {
              const contexto =
                i % 3 === 0
                  ? comoEmpresa(a.empresa)
                  : i % 3 === 1
                    ? comoSesion(usuario)
                    : comoInvitacion("0".repeat(64));
              return entorno.ejecutar(
                { contexto, aislamiento: "read committed", soloLectura: true },
                async ({ db }) => {
                  await sql`select pg_sleep(0.01)`.execute(db);
                  return ok(1);
                },
              );
            }),
          );
        });
        expect(pico).toBeLessThanOrEqual(CONEXIONES_POR_POZO);
        // Las tres puertas se sirvieron del pozo del rol operativo: ningún pozo propio por puerta.
        expect(cantidadDePozosAbiertos() - antes).toBe(1);
      } finally {
        await entorno.cerrar();
      }
    });
  });

  describe("pozo agotado", () => {
    it("los pedidos de más ESPERAN su turno: terminan todos, tardan lo que toca y el servidor no ve más conexiones que el tope", async () => {
      const entorno = crearEntornoDePrueba(propia.base, 2);
      try {
        const desde = performance.now();
        const pico = await picoDurante(async () => {
          const r = await Promise.all(
            Array.from({ length: 6 }, () => empresaQueVe(entorno, comoEmpresa(a.empresa), 0.1)),
          );
          expect(r.every((x) => x.e === a.empresa)).toBe(true);
        });
        const tardo = performance.now() - desde;
        expect(pico).toBeLessThanOrEqual(2);
        // 6 pedidos de 100 ms por 2 conexiones: al menos 3 tandas.
        expect(tardo).toBeGreaterThanOrEqual(280);
      } finally {
        await entorno.cerrar();
      }
    });

    it("pasado el plazo, el pedido que no consigue conexión FALLA (cerrado) y no abre una de más; al liberarse, el pozo sigue andando", async () => {
      const tomado = tomarPozo({
        url: propia.base.app,
        maximoDeConexiones: 2,
        plazoParaConseguirConexionEnMs: 150,
      });
      try {
        const ocupadas = [await tomado.pozo.connect(), await tomado.pozo.connect()];
        const pico = await picoDurante(async () => {
          await expect(tomado.pozo.query("select 1")).rejects.toThrow(/timeout exceeded/i);
        });
        expect(pico).toBeLessThanOrEqual(2);
        expect(await conexionesDe()).toBeLessThanOrEqual(2);
        for (const conexion of ocupadas) conexion.release();
        const { rows } = await tomado.pozo.query<{ uno: number }>("select 1 as uno");
        expect(rows[0]?.uno).toBe(1);
      } finally {
        await tomado.soltar();
      }
    });
  });

  describe("cierre limpio", () => {
    it("cada pieza suelta lo suyo: las lecturas del sistema siguen andando cuando cierran las transacciones y el pozo se cierra con la última", async () => {
      const antes = cantidadDePozosAbiertos();
      const entorno = crearEntornoDePrueba(propia.base, 3);
      const sistema = crearLecturasDeSistema({ url: propia.base.app });
      // Las dos piezas usan la misma cadena y el mismo tope (3): UN pozo.
      await empresaQueVe(entorno, comoEmpresa(a.empresa));
      await sistema.ping();
      expect(cantidadDePozosAbiertos() - antes).toBe(1);
      expect(CONEXIONES_POR_POZO).toBe(3);
      await entorno.cerrar();
      await sistema.ping(); // sigue andando: el pozo es de las dos
      expect(cantidadDePozosAbiertos() - antes).toBe(1);
      await sistema.cerrar();
      expect(cantidadDePozosAbiertos()).toBe(antes);
      expect(await hastaQue(async () => (await conexionesDe()) === 0)).toBe(true);
    });

    it("al cerrar todo no queda ninguna conexión abierta en el servidor, y cerrar dos veces no rompe nada", async () => {
      const entorno = crearEntornoDePrueba(propia.base, 3);
      await Promise.all([a, b, c].map((e) => empresaQueVe(entorno, comoEmpresa(e.empresa), 0.02)));
      expect(await conexionesDe()).toBeGreaterThan(0);
      await entorno.cerrar();
      await entorno.cerrar();
      expect(await hastaQue(async () => (await conexionesDe()) === 0)).toBe(true);
    });

    it("la puerta pública (otro rol, otra cadena) tiene su propio pozo y también se cierra limpio", async () => {
      const publico = crearTransaccionesPublicas({ url: propia.base.publico, armar: (db) => db });
      const rol = decodeURIComponent(new URL(propia.base.publico).username);
      const antes = cantidadDePozosAbiertos();
      const r = await publico.leer(async (db) => {
        const { rows } = await sql<{ uno: number }>`select 1 as uno`.execute(db);
        return rows[0]?.uno;
      });
      expect(r).toEqual({ ok: true, valor: 1 });
      expect(cantidadDePozosAbiertos() - antes).toBe(1);
      expect(await conexionesDe(rol)).toBeGreaterThan(0);
      await publico.cerrar();
      expect(cantidadDePozosAbiertos()).toBe(antes);
      expect(await hastaQue(async () => (await conexionesDe(rol)) === 0)).toBe(true);
    });
  });

  describe("la composición real", () => {
    it("transacciones de la app y lecturas del sistema: un pozo por rol, ninguno por puerta ni por pieza", async () => {
      const antes = cantidadDePozosAbiertos();
      const conexiones = armarConexiones({
        fuente: () => ({
          PEDERNAL_CLAVE_CONTEXTO: `${propia.base.clave.kid}:${propia.base.clave.secreto.toString("hex")}`,
          PEDERNAL_DB_APP: propia.base.app,
        }),
      });
      try {
        const usuario = usuarioAuthId("22222222-2222-4222-8222-222222222222");
        const lectura = { aislamiento: "read committed", soloLectura: true } as const;
        const transacciones = conexiones.transaccionesDeApp();
        await Promise.all([
          transacciones.ejecutar({ contexto: comoSesion(usuario), ...lectura }, () =>
            Promise.resolve(ok(1)),
          ),
          transacciones.ejecutar({ contexto: comoInvitacion("1".repeat(64)), ...lectura }, () =>
            Promise.resolve(ok(1)),
          ),
          transacciones.ejecutar({ contexto: comoEmpresa(a.empresa), ...lectura }, () =>
            Promise.resolve(ok(1)),
          ),
          conexiones.lecturasDeSistema().ping(),
        ]);
        expect(cantidadDePozosAbiertos() - antes).toBe(1);
        expect(await conexionesDe()).toBeLessThanOrEqual(CONEXIONES_POR_POZO);
      } finally {
        await conexiones.transaccionesDeApp().cerrar();
        await conexiones.lecturasDeSistema().cerrar();
      }
      expect(cantidadDePozosAbiertos()).toBe(antes);
    });
  });
});
