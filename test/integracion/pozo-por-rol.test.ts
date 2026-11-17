import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { crearLecturasDeSistema } from "../../src/adaptadores/postgres/lecturas-de-sistema";
import {
  CONEXIONES_POR_POZO,
  PLAZO_PARA_CONSEGUIR_CONEXION_EN_MS,
  cantidadDePozosAbiertos,
  tomarPozo,
} from "../../src/adaptadores/postgres/pozos";
import { crearTransaccionesPublicas } from "../../src/adaptadores/postgres/transacciones-publicas";
import { armarConexiones } from "../../src/composicion/conexiones";
import { resolverEmpresa, type DependenciasDeSesion } from "../../src/composicion/sesion-y-empresa";
import { crearConsultasDeSesion } from "../../src/modulos/identidad/publico";
import type { SesionAutenticada } from "../../src/puertos/autenticacion";
import { ok } from "../../src/primitivas/resultado/resultado";
import { marcaComercialId, usuarioAuthId } from "../../src/primitivas/identificadores/marca";
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

  /** Cuántas conexiones de OTRAS sesiones (cualquier rol, menos la del observador) tiene la base propia de este archivo, según el SERVIDOR. */
  async function conexionesAjenas(): Promise<number> {
    const { rows } = await observador.query<{ n: string }>(
      `select count(*)::text as n from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
      [nombreDeLaBase],
    );
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Cada prueba arranca con la base propia SIN conexiones ajenas. Por qué: el servidor tarda unos milisegundos en cerrar el backend de una
   * conexión que la prueba anterior ya cerró del lado de la aplicación (`pozo.end()`); si el muestreo de la siguiente la alcanza, suma una
   * conexión de más y falla de forma intermitente (`expected 3 to be less than or equal to 2`). La base es propia de este archivo (nombre
   * único), así que no la comparte ninguna otra suite: lo único que puede sumar son restos de las pruebas de este mismo archivo.
   */
  beforeEach(async () => {
    if (base === null) return;
    const limite = Date.now() + 10_000;
    while ((await conexionesAjenas()) > 0 && Date.now() < limite) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(await conexionesAjenas()).toBe(0);
  });

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
    it("un resto de conexión de la prueba anterior que tarda en irse NO cuenta: la siguiente prueba espera a que desaparezca", async () => {
      // Simula el resto: una conexión del mismo rol y la misma base que se cierra 200 ms después de empezar la prueba.
      const resto = new pg.Client({ connectionString: propia.base.app });
      await resto.connect();
      setTimeout(() => void resto.end(), 200);
      expect(await conexionesDe()).toBe(1);
      // Lo que hace el `beforeEach` de cada prueba: esperar a que el servidor ya no vea conexiones ajenas.
      expect(await hastaQue(async () => (await conexionesAjenas()) === 0)).toBe(true);
      expect(await conexionesDe()).toBe(0);
    });

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

  describe("con el tope de producción (3) y el pozo agotado", () => {
    it("el plazo de espera por una conexión es de 5 s (el plan Hobby de Vercel corta a los 10 s)", () => {
      expect(PLAZO_PARA_CONSEGUIR_CONEXION_EN_MS).toBe(5_000);
    });

    it("un pozo agotado sale como error TIPADO de la persistencia y la capa web lo muestra como el error genérico con referencia, no como excepción cruda", async () => {
      const entorno = crearEntornoDePrueba(propia.base, 1, undefined, 150);
      const ocupante = tomarPozo({ url: propia.base.app, maximoDeConexiones: 1 });
      const conexionOcupada = await ocupante.pozo.connect();
      try {
        const directo = await entorno.ejecutar(
          { contexto: comoEmpresa(a.empresa), aislamiento: "read committed", soloLectura: true },
          () => Promise.resolve(ok(1)),
        );
        expect(directo).toMatchObject({ ok: false, error: { tipo: "Inesperado" } });
        const dentroDelPedido = await entorno.conLecturasCompartidas(comoEmpresa(b.empresa), () =>
          Promise.resolve("sigue"),
        );
        expect(dentroDelPedido).toBe("sigue");
        const registros: string[] = [];
        const dependencias: DependenciasDeSesion = {
          autenticacion: () => {
            throw new Error("no se usa");
          },
          consultasDeSesion: () => crearConsultasDeSesion({ transacciones: entorno }),
          casosDeUsoDeIdentidad: () => {
            throw new Error("no se usa");
          },
          consultasDeEmpresas: () => {
            throw new Error("no se usa");
          },
          lecturasCompartidas: () => entorno,
          ahora: () => new Date(),
          respuesta: { registrar: (d) => registros.push(d) },
        };
        const sesion = {
          usuarioAuth: usuarioAuthId("33333333-3333-4333-8333-333333333333"),
        } as unknown as SesionAutenticada;
        const web = await resolverEmpresa(dependencias, {
          sesion,
          marcaId: marcaComercialId("44444444-4444-4444-8444-444444444444"),
          cookieDeEmpresa: null,
        });
        expect(web).toMatchObject({ ok: false, error: { codigo: "ERROR_INTERNO" } });
        expect(JSON.stringify(web)).not.toMatch(/timeout|pozo|conexi/i);
      } finally {
        conexionOcupada.release();
        await ocupante.soltar();
        await entorno.cerrar();
      }
    });

    it("12 pedidos a la vez sobre un pozo de 3, donde cada uno sostiene una conexión y pide OTRA transacción, terminan todos sin trabarse", async () => {
      const entorno = crearEntornoDePrueba(propia.base, CONEXIONES_POR_POZO);
      try {
        const desde = performance.now();
        const resultados = await picoDurante(async () => {
          const r = await Promise.all(
            Array.from({ length: 12 }, async (_, i) => {
              const e = [a, b, c][i % 3] as EmpresaDePrueba;
              const contexto = comoEmpresa(e.empresa);
              return entorno.conLecturasCompartidas(contexto, async () => {
                const antes = await empresaQueVe(entorno, contexto, 0.01);
                // Una transacción que no puede unirse: la unidad suelta su conexión ANTES de pedir otra.
                const escritura = await entorno.ejecutar({ contexto }, () =>
                  Promise.resolve(ok(1)),
                );
                const despues = await empresaQueVe(entorno, contexto, 0.01);
                return {
                  esperada: e.empresa,
                  antes: antes.e,
                  despues: despues.e,
                  ok: escritura.ok,
                };
              });
            }),
          );
          return r;
        });
        void resultados;
        expect(performance.now() - desde).toBeLessThan(PLAZO_PARA_CONSEGUIR_CONEXION_EN_MS);
      } finally {
        await entorno.cerrar();
      }
    });

    it("si una lectura del pedido pide otra DENTRO de su propio trabajo (espera cruzada), con el pozo de producción termina bien o falla cerrado: nunca queda colgado, y el pozo sigue andando", async () => {
      const entorno = crearEntornoDePrueba(propia.base, CONEXIONES_POR_POZO, undefined, 400);
      try {
        const desde = performance.now();
        const resultados = await Promise.all(
          Array.from({ length: 12 }, (_, i) => {
            const contexto = comoEmpresa(([a, b, c][i % 3] as EmpresaDePrueba).empresa);
            return entorno.conLecturasCompartidas(contexto, () =>
              entorno.ejecutar(
                { contexto, aislamiento: "read committed", soloLectura: true },
                async () => {
                  // Sostiene la conexión de la unidad y pide otra transacción.
                  const adentro = await entorno.ejecutar(
                    { contexto, aislamiento: "read committed", soloLectura: true },
                    () => Promise.resolve(ok(1)),
                  );
                  return ok(adentro.ok ? "salio" : "fallo-cerrado");
                },
              ),
            );
          }),
        );
        // Cada pedido terminó: o bien salió, o bien falló cerrado (error tipado de pozo agotado), pero ninguno se quedó esperando.
        for (const r of resultados) {
          expect(r.ok || r.error.tipo === "Inesperado").toBe(true);
          if (r.ok) expect(["salio", "fallo-cerrado"]).toContain(r.valor);
        }
        expect(performance.now() - desde).toBeLessThan(5_000);
        expect(await empresaQueVe(entorno, comoEmpresa(a.empresa))).toMatchObject({ e: a.empresa });
      } finally {
        await entorno.cerrar();
      }
    });

    it("el `ping` de las lecturas del sistema con el pozo agotado falla a su plazo y la consulta que quedó esperando se descarta sola (no queda cola)", async () => {
      // El pozo de producción (3) y su espera de 200 ms; el `ping` espera 100 ms.
      const ocupante = tomarPozo({ url: propia.base.app, plazoParaConseguirConexionEnMs: 200 });
      const ocupadas = await Promise.all(
        Array.from({ length: CONEXIONES_POR_POZO }, () => ocupante.pozo.connect()),
      );
      const sistema = crearLecturasDeSistema({ url: propia.base.app, plazoEnMs: 100 });
      try {
        const desde = performance.now();
        await expect(sistema.ping()).rejects.toThrow(/a tiempo|timeout/i);
        expect(performance.now() - desde).toBeLessThan(180);
        // El ping ya falló pero su consulta sigue en la cola del pozo hasta que el pozo la descarte por su propio plazo.
        expect(ocupante.pozo.waitingCount).toBeLessThanOrEqual(1);
        expect(await hastaQue(() => Promise.resolve(ocupante.pozo.waitingCount === 0), 1000)).toBe(
          true,
        );
        expect(ocupante.pozo.totalCount).toBe(CONEXIONES_POR_POZO);
      } finally {
        for (const conexion of ocupadas) conexion.release();
        await sistema.cerrar();
        await ocupante.soltar();
      }
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
