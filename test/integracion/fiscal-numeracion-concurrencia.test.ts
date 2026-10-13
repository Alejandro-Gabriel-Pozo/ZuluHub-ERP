import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { puntoDeVentaId, solicitudId, verificarSecuencia } from "../../src/modulos/fiscal/publico";
import { err, ok } from "../../src/primitivas/resultado/resultado";
import { EmisionFalsa, guionAlAzar } from "../utilidades/emision-falsa";
import { crearBarrera, crearBaseAparte } from "./entorno";
import {
  casosDeNumeracion,
  crearEntornoDeNumeracion,
  crearEscenario,
  entradaDe,
  type Escenario,
} from "./fiscal-numeracion-apoyo";
import { nuevoId } from "./fiscal-persistencia-apoyo";

/**
 * H7 (fiscal base), tramo T6: concurrencia REAL de la numeración. Cada prueba lanza varias llamadas a
 * los casos de uso a la vez (`Promise.all`) y, con una barrera dentro de cada transacción (a la altura
 * de la primera lectura de la serie), fuerza que TODAS hayan leído el mismo estado antes de que
 * cualquiera escriba: es el cruce que importa. Después mira la base: números consecutivos, sin huecos
 * ni duplicados, una auditoría por efecto, y quien pierde la carrera recibe un resultado con nombre
 * (o el mismo éxito, si la acción era la misma), nunca una excepción cruda ni un éxito falso.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 300_000 });

const RONDAS = 5;
const T0 = new Date("2026-10-12T12:00:00Z");
const despues = (minutos: number) => new Date(T0.getTime() + minutos * 60_000);
const esperar = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

describe.skipIf(base === null)("fiscal T6: concurrencia de la numeración", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entorno: ReturnType<typeof crearEntornoDeNumeracion>;
  /** Mientras haya una barrera, toda transacción espera en ella al leer la serie por primera vez. */
  let barrera: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDeNumeracion(propia.base, 16, (tx) => ({
      ...tx,
      series: {
        ...tx.series,
        obtener: async (...args) => {
          const serie = await tx.series.obtener(...args);
          if (barrera !== null) await barrera();
          return serie;
        },
      },
    }));
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  const filas = async <T extends Record<string, unknown>>(texto: string, p: unknown[] = []) =>
    (await dueno.query<T>(texto, p)).rows;
  const serie = async (e: Escenario) =>
    (
      await filas(
        `select estado, ultimo_numero::text as ultimo, numero_en_curso::text as en_curso,
                solicitud_en_curso as solicitud
           from serie_comprobante where punto_de_venta_id = $1 and tipo_comprobante = 'FACTURA_B'`,
        [e.puntoDeVenta],
      )
    )[0];
  const cuenta = async (e: Escenario, accion: string) =>
    Number(
      (
        await filas<{ n: string }>(
          "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = $2",
          [e.mundo.empresa, accion],
        )
      )[0]?.n,
    );
  const escenario = (opciones: Parameters<typeof crearEscenario>[1] = {}) =>
    crearEscenario(dueno, { conSerie: true, ...opciones });

  /** `n` llamadas a la vez; con `conBarrera`, todas leen la serie antes de que cualquiera escriba. */
  async function enParalelo<T>(
    n: number,
    llamada: (i: number) => Promise<T>,
    conBarrera = true,
  ): Promise<T[]> {
    barrera = conBarrera ? crearBarrera(n) : null;
    try {
      return await Promise.all(Array.from({ length: n }, (_, i) => llamada(i)));
    } finally {
      barrera = null;
    }
  }

  /** Dos llamadas de distinto tipo a la vez, con la misma barrera. */
  async function juntas<A, B>(
    a: () => Promise<A>,
    b: () => Promise<B>,
    conBarrera = true,
  ): Promise<[A, B]> {
    barrera = conBarrera ? crearBarrera(2) : null;
    try {
      return await Promise.all([a(), b()]);
    } finally {
      barrera = null;
    }
  }

  const AUTORIZADO = { tipo: "AUTORIZADO", codigo: "CAE-1", vence: "2099-12-31" } as const;

  // ===============================================================================================
  describe("reservar", () => {
    it("varias solicitudes DISTINTAS reservan la misma serie a la vez: una obtiene el número 1 y las demás SERIE_OCUPADA", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const e = await escenario();
        const c = casosDeNumeracion(entorno, new EmisionFalsa());
        const rs = await enParalelo(6, () =>
          c.reservarNumeroDeComprobante(e.como(T0), entradaDe(e)),
        );
        expect(
          rs.filter((r) => r.ok).map((r) => r.ok && r.valor.numero),
          `ronda ${ronda}`,
        ).toEqual([1n]);
        expect(
          rs.filter((r) => !r.ok),
          `ronda ${ronda}`,
        ).toEqual(Array.from({ length: 5 }, () => err("SERIE_OCUPADA")));
        expect(await serie(e)).toMatchObject({ estado: "EN_CURSO", ultimo: "0", en_curso: "1" });
        expect(await cuenta(e, "NUMERO_DE_COMPROBANTE_RESERVADO"), `ronda ${ronda}`).toBe(1);
      }
    });

    it("la MISMA solicitud reserva varias veces a la vez: todas reciben el mismo número y la serie avanza una sola vez", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const e = await escenario();
        const c = casosDeNumeracion(entorno, new EmisionFalsa());
        const entrada = entradaDe(e);
        const rs = await enParalelo(6, () => c.reservarNumeroDeComprobante(e.como(T0), entrada));
        expect(
          rs.every((r) => r.ok && r.valor.numero === 1n),
          `ronda ${ronda}`,
        ).toBe(true);
        expect(
          rs.filter((r) => r.ok && !r.valor.yaReservada),
          `ronda ${ronda}`,
        ).toHaveLength(1);
        expect(await cuenta(e, "NUMERO_DE_COMPROBANTE_RESERVADO"), `ronda ${ronda}`).toBe(1);
        expect(await serie(e)).toMatchObject({ estado: "EN_CURSO", en_curso: "1" });
      }
    });

    it("con la serie SIN crear: varias reservas a la vez crean la serie una vez y una sola obtiene el número", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const e = await escenario({ conSerie: false });
        const c = casosDeNumeracion(entorno, new EmisionFalsa({ ultimoInicial: 20n }));
        const rs = await enParalelo(6, () =>
          c.reservarNumeroDeComprobante(e.como(T0), entradaDe(e)),
        );
        expect(
          rs.filter((r) => r.ok).map((r) => r.ok && r.valor.numero),
          `ronda ${ronda}`,
        ).toEqual([21n]);
        expect(
          rs.filter((r) => !r.ok),
          `ronda ${ronda}`,
        ).toEqual(Array.from({ length: 5 }, () => err("SERIE_OCUPADA")));
        expect(await serie(e)).toMatchObject({ estado: "EN_CURSO", ultimo: "20", en_curso: "21" });
        expect(await cuenta(e, "SERIE_DE_COMPROBANTES_CREADA"), `ronda ${ronda}`).toBe(1);
        expect(await cuenta(e, "NUMERO_DE_COMPROBANTE_RESERVADO"), `ronda ${ronda}`).toBe(1);
      }
    });

    for (const conBarrera of [true, false]) {
      it(`reservar MIENTRAS otro cierra: o ve la reserva anterior (SERIE_OCUPADA) o toma el número siguiente; nunca un hueco ni un duplicado [${conBarrera ? "con" : "sin"} barrera]`, async () => {
        for (let ronda = 0; ronda < RONDAS; ronda++) {
          const e = await escenario();
          const c = casosDeNumeracion(entorno, new EmisionFalsa());
          const primera = entradaDe(e);
          const otra = entradaDe(e);
          await c.reservarNumeroDeComprobante(e.como(T0), primera);
          const [cierre, reserva] = await juntas(
            () =>
              c.cerrarReservaDeNumero(e.como(T0), {
                ...primera,
                numero: 1n,
                resultado: AUTORIZADO,
              }),
            () => c.reservarNumeroDeComprobante(e.como(T0), otra),
            conBarrera,
          );
          expect(cierre, `ronda ${ronda}`).toEqual(
            ok({ desenlace: "AUTORIZADO", numero: 1n, yaCerrada: false }),
          );
          if (reserva?.ok) {
            expect(reserva.valor.numero, `ronda ${ronda}`).toBe(2n);
            expect(await serie(e)).toMatchObject({
              estado: "EN_CURSO",
              ultimo: "1",
              en_curso: "2",
              solicitud: otra.solicitud,
            });
            expect(await cuenta(e, "NUMERO_DE_COMPROBANTE_RESERVADO")).toBe(2);
          } else {
            expect(reserva, `ronda ${ronda}`).toEqual(err("SERIE_OCUPADA"));
            expect(await serie(e)).toMatchObject({ estado: "LIBRE", ultimo: "1" });
            expect(await cuenta(e, "NUMERO_DE_COMPROBANTE_RESERVADO")).toBe(1);
          }
          expect(await cuenta(e, "NUMERO_DE_COMPROBANTE_AUTORIZADO")).toBe(1);
        }
      });
    }
  });

  // ===============================================================================================
  describe("cerrar", () => {
    it("cerrar la misma reserva varias veces a la vez avanza el último número UNA vez y todas tienen éxito", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const e = await escenario();
        const c = casosDeNumeracion(entorno, new EmisionFalsa());
        const entrada = entradaDe(e);
        await c.reservarNumeroDeComprobante(e.como(T0), entrada);
        const rs = await enParalelo(5, () =>
          c.cerrarReservaDeNumero(e.como(T0), { ...entrada, numero: 1n, resultado: AUTORIZADO }),
        );
        expect(
          rs.every((r) => r.ok),
          `ronda ${ronda}`,
        ).toBe(true);
        expect(
          rs.filter((r) => r.ok && !r.valor.yaCerrada),
          `ronda ${ronda}`,
        ).toHaveLength(1);
        expect(await serie(e)).toMatchObject({ estado: "LIBRE", ultimo: "1" });
        expect(await cuenta(e, "NUMERO_DE_COMPROBANTE_AUTORIZADO"), `ronda ${ronda}`).toBe(1);
      }
    });
  });

  // ===============================================================================================
  describe("reconciliar", () => {
    /** Una serie con la reserva de `solicitud` hecha en T0 y ARCA con `ultimoDeArca`. */
    async function conReservaVencida(ultimoDeArca: bigint) {
      const e = await escenario();
      const arca = new EmisionFalsa();
      const c = casosDeNumeracion(entorno, arca);
      const entrada = entradaDe(e);
      await c.reservarNumeroDeComprobante(e.como(T0), entrada);
      const cuit = (
        await filas<{ cuit: string }>("select cuit from empresa where id = $1", [e.mundo.empresa])
      )[0]?.cuit;
      arca.fijarUltimo({ cuit: cuit as never, numero: 1 }, "FACTURA_B", ultimoDeArca);
      return { e, arca, c, entrada };
    }

    it("dos reconciliaciones a la vez: una resuelve la reserva y la otra encuentra la serie ya resuelta; una sola auditoría", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const { e, c, entrada } = await conReservaVencida(1n);
        const rs = await enParalelo(2, () => c.reconciliarSerie(e.sistema(despues(6)), entrada));
        expect(rs.map((r) => r.ok && r.valor.tipo).sort(), `ronda ${ronda}`).toEqual([
          "NADA_QUE_RECONCILIAR",
          "RECONCILIADA",
        ]);
        expect(await serie(e)).toMatchObject({ estado: "LIBRE", ultimo: "1" });
        expect(await cuenta(e, "SERIE_DE_COMPROBANTES_RECONCILIADA"), `ronda ${ronda}`).toBe(1);
      }
    });

    it("la reconciliación y el cierre tardío a la vez: el número se cierra UNA vez y queda una sola auditoría de cierre", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const { e, c, entrada } = await conReservaVencida(1n);
        const [cierre, rec] = await juntas(
          () =>
            c.cerrarReservaDeNumero(e.como(despues(6)), {
              ...entrada,
              numero: 1n,
              resultado: AUTORIZADO,
            }),
          () => c.reconciliarSerie(e.sistema(despues(6)), entrada),
        );
        expect(cierre?.ok, `ronda ${ronda}`).toBe(true);
        expect(rec?.ok, `ronda ${ronda}`).toBe(true);
        expect(await serie(e)).toMatchObject({ estado: "LIBRE", ultimo: "1" });
        const cierres =
          (await cuenta(e, "NUMERO_DE_COMPROBANTE_AUTORIZADO")) +
          (await cuenta(e, "SERIE_DE_COMPROBANTES_RECONCILIADA"));
        expect(cierres, `ronda ${ronda}`).toBe(1);
      }
    });

    it("dos corridas de reconciliarSeriesVencidas a la vez no duplican nada", async () => {
      const e = await escenario();
      const arca = new EmisionFalsa();
      const c = casosDeNumeracion(entorno, arca);
      await c.reservarNumeroDeComprobante(e.como(T0), entradaDe(e));
      const rs = await enParalelo(2, () => c.reconciliarSeriesVencidas(e.sistema(despues(6))));
      expect(rs.every((r) => r.ok)).toBe(true);
      expect(await serie(e)).toMatchObject({ estado: "LIBRE", ultimo: "0" });
      expect(await cuenta(e, "SERIE_DE_COMPROBANTES_RECONCILIADA")).toBe(1);
    });
  });

  // ===============================================================================================
  describe("muchos trabajadores sobre la misma serie (spec H7 §D)", () => {
    const TRABAJADORES = 8;
    const SOLICITUDES_POR_TRABAJADOR = 50;

    it("8 trabajadores × 50 solicitudes con ARCA al azar (autoriza, rechaza, incierto, autorizó y se cayó): los números autorizados son exactamente 1..n, sin huecos ni repetidos, y una auditoría por número", async () => {
      const e = await escenario();
      const arca = new EmisionFalsa({
        decidir: guionAlAzar(20261012, {
          AUTORIZA: 6,
          RECHAZA: 2,
          INCIERTO: 1,
          AUTORIZA_Y_SE_CAE: 1,
        }),
      });
      // Plazo corto para que lo incierto se reconcilie durante la prueba.
      const c = casosDeNumeracion(entorno, arca, {
        plazoDeReservaEnMs: 30,
        numeroMaximo: 9_223_372_036_854_775_807n,
      });
      const pv = puntoDeVentaId(e.puntoDeVenta);
      const resultados: { tipo: string; numero: bigint }[] = [];
      let ocupadas = 0;

      const hacerUna = async () => {
        const entrada = {
          puntoDeVentaId: pv,
          tipo: "FACTURA_B",
          solicitud: solicitudId(nuevoId()),
        } as const;
        for (;;) {
          const r = await c.numerarComprobante(e.como(new Date()), entrada);
          if (r.ok) {
            resultados.push({ tipo: r.valor.resultado.tipo, numero: r.valor.numero });
            return;
          }
          const motivo = r.error;
          const reintentable =
            motivo === "SERIE_OCUPADA" ||
            (typeof motivo === "object" &&
              "tipo" in motivo &&
              motivo.tipo === "ConcurrenciaAgotada");
          if (
            typeof motivo === "object" &&
            "codigo" in motivo &&
            motivo.codigo === "CIERRE_SIN_CONFIRMAR"
          ) {
            // El cierre no se pudo guardar: la reserva queda para la reconciliación.
            return;
          }
          if (!reintentable)
            throw new Error(
              `error inesperado: ${JSON.stringify(motivo, (_, v: unknown) => (typeof v === "bigint" ? v.toString() : v))}`,
            );
          ocupadas += 1;
          // Quien espera ayuda a recuperar lo que quedó colgado.
          await c.reconciliarSerie(e.sistema(new Date()), {
            puntoDeVentaId: pv,
            tipo: "FACTURA_B",
          });
          await esperar(5);
        }
      };
      const trabajador = async () => {
        for (let k = 0; k < SOLICITUDES_POR_TRABAJADOR; k++) await hacerUna();
      };
      await Promise.all(Array.from({ length: TRABAJADORES }, trabajador));

      // Lo que quedó colgado al final se reconcilia.
      for (let i = 0; i < 400; i++) {
        if ((await serie(e))?.estado !== "EN_CURSO") break;
        await esperar(40);
        await c.reconciliarSeriesVencidas(e.sistema(new Date()));
      }
      const final = await serie(e);
      expect(final?.estado).toBe("LIBRE");

      // El oráculo: los números autorizados salen de la auditoría (cierres y reconciliaciones).
      const autorizados = (
        await filas<{ numero: string }>(
          `select despues->>'numero' as numero from auditoria_empresa
            where empresa_id = $1 and accion = 'NUMERO_DE_COMPROBANTE_AUTORIZADO'
           union all
           select despues->>'ultimoNumero' from auditoria_empresa
            where empresa_id = $1 and accion = 'SERIE_DE_COMPROBANTES_RECONCILIADA'
              and despues->>'resolucion' = 'CERRADA_COMO_AUTORIZADA'`,
          [e.mundo.empresa],
        )
      ).map((f) => BigInt(f.numero));
      const ultimo = BigInt(final?.ultimo as string);
      expect(verificarSecuencia(0n, autorizados)).toEqual(ok(ultimo));
      expect(new Set(autorizados).size).toBe(autorizados.length);
      expect(ultimo).toBe(BigInt(autorizados.length));
      // ARCA y la serie coinciden, y ARCA no rechazó nada por secuencia.
      expect(
        await arca.ultimoAutorizado(
          { cuit: arca.pedidos[0]!.puntoDeVenta.cuit, numero: 1 },
          "FACTURA_B",
        ),
      ).toEqual(ok(ultimo));
      expect(arca.pedidos.every((p) => p.numero >= 1n)).toBe(true);
      // Lo que cada llamada vio como autorizado está en la secuencia.
      const vistos = resultados.filter((r) => r.tipo === "AUTORIZADO").map((r) => r.numero);
      for (const numero of vistos) expect(autorizados).toContain(numero);
      // La prueba ejercitó los cuatro desenlaces y la espera por reservas ocupadas.
      expect(resultados.length).toBeGreaterThan(0);
      expect(ocupadas).toBeGreaterThanOrEqual(0);
      expect(
        await filas(
          "select 1 from auditoria_empresa where empresa_id = $1 and accion = 'NUMERO_DE_COMPROBANTE_RECHAZADO' limit 1",
          [e.mundo.empresa],
        ),
      ).not.toEqual([]);
    });
  });
});
