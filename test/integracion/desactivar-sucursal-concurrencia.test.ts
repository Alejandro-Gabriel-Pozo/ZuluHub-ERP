import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearBarrera, crearBaseAparte, crearEntornoDePrueba } from "./entorno";
import { armarCaja, crearEntornoDeCaja, type TxDeCajaDePrueba } from "./caja-configuracion-apoyo";
import { crearMundoDeOperacion, type MundoDeOperacion } from "./caja-operacion-apoyo";
import { armarCierreConCaja } from "./caja-cierre-del-dia-apoyo";
import { crearJornada } from "./cierre-apoyo";
import {
  armarEmpresasConCierre,
  contarAuditorias,
  contarSesiones,
  ctxDelDia,
  entradaDeAbrir,
  entradaDelDia,
  fechaDelDia,
  jornadaDe,
  sucursalActiva,
  sumarOtraSucursal,
} from "./desactivar-sucursal-apoyo";

/**
 * Concurrencia e idempotencia de «desactivar una sucursal» (decisión 178; E3, tramo 9) con una base real, los roles limitados y una barrera:
 * todas las transacciones de la ronda leen la autorización y esperan a que lleguen las demás antes de seguir, así corren de verdad a la
 * vez. Desactivar contra abrir una sesión (con la jornada ya creada y sin crear), contra empezar el cierre del día y contra otro desactivar
 * (doble clic). Invariante: nunca queda una sucursal inactiva con una sesión en la jornada que se cerró sola, ni una jornada en auditoría
 * en una sucursal inactiva por esta vía.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 280_000 });
const RONDAS = 30;

type Gancho = (tx: TxDeCajaDePrueba, esperar: () => Promise<void>) => TxDeCajaDePrueba;

const pausa = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

describe.skipIf(base === null)("desactivar una sucursal: concurrencia e idempotencia", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entornoBase: ReturnType<typeof crearEntornoDePrueba>;
  let entorno: ReturnType<typeof crearEntornoDeCaja>;
  let dueno: pg.Client;
  let caja: ReturnType<typeof armarCaja>;
  let cierre: ReturnType<typeof armarCierreConCaja>;
  let empresas: ReturnType<typeof armarEmpresasConCierre>;
  let barrera: () => Promise<void> = () => Promise.resolve();
  let gancho: Gancho = (tx) => tx;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entornoBase = crearEntornoDePrueba(propia.base, 4);
    entorno = crearEntornoDeCaja(propia.base, 16, (tx) => gancho(tx, () => barrera()));
    caja = armarCaja(entorno);
    cierre = armarCierreConCaja(entorno);
    empresas = armarEmpresasConCierre(entorno);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await entornoBase.cerrar();
    await propia.destruir();
  });

  /** Qué participante de la ronda es cada tarea (sigue a la tarea a través de sus esperas). */
  const participante = new AsyncLocalStorage<number>();
  /** Cuánto espera cada participante DESPUÉS de la barrera: con una demora distinta por ronda, a veces sale primero uno y a veces el otro. */
  let demoras: readonly number[] = [];

  /** Cada transacción de la ronda espera, tras su primera lectura de la autorización, a que lleguen todas las demás. */
  const ronda = (participantes: number) => {
    barrera = crearBarrera(participantes);
    gancho = (tx, esperar) => {
      let primera = true;
      const original = tx.autorizacion;
      return {
        ...tx,
        autorizacion: {
          ...original,
          delActor: async (contexto) => {
            const r = await original.delActor(contexto);
            if (primera) {
              primera = false;
              await esperar();
              await pausa(demoras[participante.getStore() ?? 0] ?? 0);
            }
            return r;
          },
        },
      };
    };
  };
  const aLaVez = async <const T extends readonly (() => Promise<unknown>)[]>(
    tareas: T,
    demorasDeLaRonda: readonly number[] = [],
  ): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> => {
    ronda(tareas.length);
    demoras = demorasDeLaRonda;
    try {
      return (await Promise.all(tareas.map((t, i) => participante.run(i, t)))) as {
        -readonly [K in keyof T]: Awaited<ReturnType<T[K]>>;
      };
    } finally {
      gancho = (tx) => tx;
      demoras = [];
    }
  };

  /**
   * Las demoras de la ronda `i`: en las rondas pares espera el primero, en las impares el segundo, y la espera crece de 0 a 45 ms. Así
   * cada orden de llegada (y los intermedios) se ejerce de verdad y no gana siempre el mismo.
   */
  const demorasDe = (i: number): readonly number[] =>
    i % 2 === 0 ? [(i * 3) % 46, 0] : [0, (i * 3) % 46];

  const mundo = async (): Promise<MundoDeOperacion> => {
    const m = await crearMundoDeOperacion(entornoBase, dueno, caja, { plan: ["caja", "cierre"] });
    await sumarOtraSucursal(dueno, m, "c");
    return m;
  };
  const desactivar = (m: MundoDeOperacion, minutos = 50) =>
    empresas.desactivarSucursal(ctxDelDia(m, minutos), { sucursalId: m.sucursal });
  const abrir = (m: MundoDeOperacion) => caja.casos.abrirSesion(ctxDelDia(m), entradaDeAbrir(m));
  const jornada = (m: MundoDeOperacion) => jornadaDe(dueno, m.empresa, m.sucursal, fechaDelDia());
  const activa = (m: MundoDeOperacion) => sucursalActiva(dueno, m.empresa, m.sucursal);
  const sesiones = (m: MundoDeOperacion) => contarSesiones(dueno, m.empresa, m.sucursal);
  const resumen = (rs: readonly { ok: boolean; error?: unknown }[]) =>
    JSON.stringify(rs.map((r) => (r.ok ? "ok" : r.error)));

  /** Gana exactamente una de las dos: o se desactivó (y no hay sesión), o se abrió la sesión (y la sucursal sigue activa). */
  async function comprobarDesactivarContraAbrir(
    m: MundoDeOperacion,
    rs: readonly [{ ok: boolean; error?: unknown }, { ok: boolean; error?: unknown }],
    conJornadaPrevia: boolean,
  ) {
    const [desactivada, abierta] = rs;
    const dicho = resumen(rs);
    expect(desactivada.ok !== abierta.ok, dicho).toBe(true);
    if (desactivada.ok) {
      expect(await activa(m), dicho).toBe(false);
      expect(await sesiones(m), dicho).toBe(0);
      expect((await jornada(m))?.estado ?? null, dicho).toBe(conJornadaPrevia ? "CERRADA" : null);
      expect(await contarAuditorias(dueno, m.empresa, "SUCURSAL_DESACTIVADA"), dicho).toBe(1);
      expect(
        await contarAuditorias(dueno, m.empresa, "JORNADA_CERRADA_AL_DESACTIVAR_SUCURSAL"),
        dicho,
      ).toBe(conJornadaPrevia ? 1 : 0);
    } else {
      expect(desactivada.error, dicho).toBe("SUCURSAL_CON_MOVIMIENTO_EN_LA_JORNADA");
      expect(await activa(m), dicho).toBe(true);
      expect(await sesiones(m), dicho).toBe(1);
      expect((await jornada(m))?.estado, dicho).toBe("ABIERTA");
      expect(await contarAuditorias(dueno, m.empresa, "SUCURSAL_DESACTIVADA"), dicho).toBe(0);
      expect(
        await contarAuditorias(dueno, m.empresa, "JORNADA_CERRADA_AL_DESACTIVAR_SUCURSAL"),
        dicho,
      ).toBe(0);
    }
  }

  it(`desactivar contra abrir una sesión con la jornada ya creada (${RONDAS} rondas): gana una sola, y no queda una sesión en una jornada cerrada sola`, async () => {
    const ganadores = { desactivar: 0, abrir: 0 };
    for (let i = 0; i < RONDAS; i += 1) {
      const m = await mundo();
      await crearJornada(dueno, m, fechaDelDia());
      const rs = await aLaVez([() => desactivar(m), () => abrir(m)], demorasDe(i));
      await comprobarDesactivarContraAbrir(m, rs, true);
      if (rs[0].ok) ganadores.desactivar += 1;
      else ganadores.abrir += 1;
    }
    // Las demoras de cada ronda hacen que se ejerzan los dos órdenes: si siempre ganara el mismo, la carrera no se estaría probando.
    expect(ganadores.desactivar).toBeGreaterThan(0);
    expect(ganadores.abrir).toBeGreaterThan(0);
    expect(ganadores.desactivar + ganadores.abrir).toBe(RONDAS);
  });

  it(`desactivar contra abrir una sesión SIN jornada previa (${RONDAS} rondas): la inserción concurrente de la jornada tampoco deja pasar las dos`, async () => {
    for (let i = 0; i < RONDAS; i += 1) {
      const m = await mundo();
      const rs = await aLaVez([() => desactivar(m), () => abrir(m)], demorasDe(i));
      await comprobarDesactivarContraAbrir(m, rs, false);
    }
  });

  it(`desactivar contra empezar el cierre del día (${RONDAS} rondas): o queda cerrada con la sucursal inactiva, o en auditoría con la sucursal activa`, async () => {
    for (let i = 0; i < RONDAS; i += 1) {
      const m = await mundo();
      await crearJornada(dueno, m, fechaDelDia());
      const rs = await aLaVez(
        [
          () => desactivar(m),
          () => cierre.casos.iniciarAuditoria(ctxDelDia(m, 40), entradaDelDia(m)),
        ],
        demorasDe(i),
      );
      const dicho = resumen(rs);
      const j = await jornada(m);
      if (rs[0].ok) {
        // Desactivar ganó: la jornada se cerró sola y empezar el cierre ya no pudo (o llegó antes y desactivar lo vio... no: entonces habría rechazado).
        expect(await activa(m), dicho).toBe(false);
        expect(j?.estado, dicho).toBe("CERRADA");
        expect(rs[1].ok, dicho).toBe(false);
      } else {
        expect(rs[0].error, dicho).toBe("SUCURSAL_CON_JORNADA_EN_AUDITORIA");
        expect(await activa(m), dicho).toBe(true);
        expect(j?.estado, dicho).toBe("EN_AUDITORIA");
        expect(rs[1].ok, dicho).toBe(true);
      }
      expect(j?.estado === "EN_AUDITORIA" && !(await activa(m)), dicho).toBe(false);
    }
  });

  it(`desactivar dos veces a la vez, doble clic (${RONDAS} rondas): una escritura, una auditoría de cada tipo, y las dos respuestas son ok`, async () => {
    let yaEstaba = 0;
    for (let i = 0; i < RONDAS; i += 1) {
      const m = await mundo();
      await crearJornada(dueno, m, fechaDelDia());
      const rs = await aLaVez([() => desactivar(m), () => desactivar(m)], demorasDe(i));
      const dicho = resumen(rs);
      expect(
        rs.every((r) => r.ok),
        dicho,
      ).toBe(true);
      const repetidas = rs.filter((r) => r.ok && r.valor.yaEstabaInactiva).length;
      expect(repetidas, dicho).toBe(1);
      yaEstaba += repetidas;
      expect(await activa(m), dicho).toBe(false);
      expect((await jornada(m))?.estado, dicho).toBe("CERRADA");
      expect(await contarAuditorias(dueno, m.empresa, "SUCURSAL_DESACTIVADA"), dicho).toBe(1);
      expect(
        await contarAuditorias(dueno, m.empresa, "JORNADA_CERRADA_AL_DESACTIVAR_SUCURSAL"),
        dicho,
      ).toBe(1);
    }
    expect(yaEstaba).toBe(RONDAS);
  });

  it(`con una sesión ya abierta, desactivar contra cobrar o cerrar la caja a la vez (${RONDAS / 3} rondas): siempre se rechaza y la sesión queda intacta`, async () => {
    for (let i = 0; i < RONDAS / 3; i += 1) {
      const m = await mundo();
      const abierta = await abrir(m);
      if (!abierta.ok) throw new Error(`no se pudo abrir: ${JSON.stringify(abierta.error)}`);
      const [desactivada, ingreso] = await aLaVez(
        [
          () => desactivar(m),
          () =>
            caja.casos.registrarMovimientoManual(ctxDelDia(m, 5), {
              claveDeIdempotencia: crypto.randomUUID(),
              sesionId: abierta.valor.sesionId,
              sentido: "INGRESO",
              importe: { moneda: "ARS", monto: "10.00" },
              motivo: "Cambio",
            }),
        ],
        demorasDe(i),
      );
      const dicho = resumen([desactivada, ingreso]);
      expect(desactivada, dicho).toEqual({
        ok: false,
        error: "SUCURSAL_CON_MOVIMIENTO_EN_LA_JORNADA",
      });
      expect(ingreso.ok, dicho).toBe(true);
      expect(await activa(m), dicho).toBe(true);
      expect((await jornada(m))?.estado, dicho).toBe("ABIERTA");
    }
  });
});
