import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearBarrera, crearBaseAparte, crearEntornoDePrueba } from "./entorno";
import {
  armarCaja,
  crearEntornoDeCaja,
  type OpcionesDeMundoDeCaja,
  type TxDeCajaDePrueba,
} from "./caja-configuracion-apoyo";
import {
  claveNueva,
  conAhora,
  crearMundoDeOperacion,
  instanteLocal,
  pesos,
  type MundoDeOperacion,
} from "./caja-operacion-apoyo";

/**
 * A12c (13/11/2026): lo que escribe sobre UNA sesión de caja soporta tantos puestos a la vez como el pozo deja correr (16): ninguna operación
 * termina en `ConcurrenciaAgotada`. Antes (6 reintentos y una espera que no descorrelacionaba) 16 ingresos simultáneos fallaban 12 de cada 320.
 * Es la misma operación y la misma barrera que `caja-operacion-concurrencia.test.ts`; acá con más participantes por ronda.
 * Concurrencia e idempotencia de la operación de caja (E3, tramo 5; e3 §5.2) con una base real, los roles limitados y una barrera: todas
 * las transacciones de la ronda leen la autorización y esperan a que lleguen las demás antes de seguir, así de verdad corren a la vez.
 * Dos aperturas de la misma caja, el doble clic en cada operación, dos anulaciones del mismo movimiento, desactivar la caja contra abrir,
 * abrir contra la «Caja 1» por defecto, abrir contra un cambio del corte, y movimientos contra el cierre (todo confirmado queda contado).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 300_000 });

type Fila = Record<string, unknown>;
type Gancho = (tx: TxDeCajaDePrueba, esperar: () => Promise<void>) => TxDeCajaDePrueba;
const RONDAS = 8;

describe.skipIf(base === null)("operación de caja: concurrencia e idempotencia", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entornoBase: ReturnType<typeof crearEntornoDePrueba>;
  let entorno: ReturnType<typeof crearEntornoDeCaja>;
  let dueno: pg.Client;
  let caja: ReturnType<typeof armarCaja>;
  let barrera: () => Promise<void> = () => Promise.resolve();
  let gancho: Gancho = (tx) => tx;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entornoBase = crearEntornoDePrueba(propia.base, 4);
    entorno = crearEntornoDeCaja(propia.base, 16, (tx) => gancho(tx, () => barrera()));
    caja = armarCaja(entorno);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await entornoBase.cerrar();
    await propia.destruir();
  });

  /** Prepara la ronda: `participantes` transacciones esperan tras su primera lectura de la autorización. */
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
            }
            return r;
          },
        },
      };
    };
  };
  const sinRonda = () => {
    gancho = (tx) => tx;
  };
  /** Corre las tareas a la vez con una barrera, y deja todo como estaba. */
  const aLaVez = async <const T extends readonly (() => Promise<unknown>)[]>(
    tareas: T,
  ): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> => {
    ronda(tareas.length);
    try {
      return (await Promise.all(tareas.map((t) => t()))) as {
        -readonly [K in keyof T]: Awaited<ReturnType<T[K]>>;
      };
    } finally {
      sinRonda();
    }
  };

  const casos = () => caja.casos;
  const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
    (await dueno.query<T>(texto, parametros)).rows;
  const contar = async (texto: string, parametros: unknown[] = []) =>
    Number((await filas<{ n: string }>(texto, parametros))[0]?.n);
  const mundo = (opciones: OpcionesDeMundoDeCaja = {}) =>
    crearMundoDeOperacion(entornoBase, dueno, caja, opciones);
  const en = (dias: number, minutos = 0, hora = "10:00") =>
    new Date(instanteLocal(dias, hora).getTime() + minutos * 60_000);
  const ctxEn = (m: MundoDeOperacion, dias = 1, minutos = 0, hora = "10:00") =>
    conAhora(m.ctx(), en(dias, minutos, hora));
  const resumen = (rs: readonly { ok: boolean; error?: unknown }[]) =>
    rs.map((r) => (r.ok ? "ok" : JSON.stringify(r.error)));
  const abrir = async (m: MundoDeOperacion, dias = 1, minutos = 0) => {
    const r = await casos().abrirSesion(ctxEn(m, dias, minutos), {
      claveDeIdempotencia: claveNueva(),
      sucursalId: m.sucursal,
      cajaId: m.cajaId,
      fondoInicial: pesos("1000.00"),
    });
    if (!r.ok) throw new Error(`no se pudo abrir: ${JSON.stringify(r.error)}`);
    return r.valor.sesionId;
  };
  const ingreso = (
    m: MundoDeOperacion,
    sesionId: string,
    clave = claveNueva(),
    importe = "10.00",
  ) =>
    casos().registrarMovimientoManual(ctxEn(m, 1, 5), {
      claveDeIdempotencia: clave,
      sesionId,
      sentido: "INGRESO",
      importe: pesos(importe),
      motivo: "Cambio",
    });

  it("16 ingresos simultáneos sobre una sola sesión: todos confirman, ninguno agota los reintentos y quedan los 16 movimientos", async () => {
    for (let i = 0; i < RONDAS; i += 1) {
      const m = await mundo();
      const sesion = await abrir(m);
      const rs = await aLaVez(Array.from({ length: 16 }, () => () => ingreso(m, sesion)));
      expect(JSON.stringify(resumen(rs)), `ronda ${String(i)}`).toBe(
        JSON.stringify(Array.from({ length: 16 }, () => "ok")),
      );
      expect(
        await contar(
          "select count(*) as n from movimiento_caja where sesion_id = $1 and clase = 'INGRESO_MANUAL'",
          [sesion],
        ),
      ).toBe(16);
    }
  });
});
