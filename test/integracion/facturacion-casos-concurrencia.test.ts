import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  puntoDeVentaId,
  type CasosDeUsoDeFacturacion,
  type ComprobanteId,
} from "../../src/modulos/fiscal/publico";
import { EmisionFalsa, guionAlAzar } from "../utilidades/emision-falsa";
import { crearBarrera, crearBaseAparte } from "./entorno";
import { crearSerie, usarSerie } from "./fiscal-apoyo";
import {
  RelojDePrueba,
  casosDeFacturacion,
  crearEntornoDeFacturacion,
  crearEscenarioDeCasos,
  facturaManual,
  type EscenarioDeCasos,
} from "./facturacion-casos-apoyo";

/**
 * H7 facturación, tramo F5: concurrencia REAL de los casos de uso de facturación (§D, «Concurrencia»). Con una
 * barrera dentro de cada transacción (en la primera lectura del comprobante o de su clave) se fuerza que todas
 * las llamadas lean el mismo estado antes de que cualquiera escriba. ARCA es el falso, al azar con semilla.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 600_000 });

/** Rondas de las pruebas largas; el CI y la estabilidad local pueden subirlas con la variable. */
const RONDAS = Number(process.env["PEDERNAL_RONDAS_FACTURACION"] ?? "2");

describe.skipIf(base === null)("facturación F5: concurrencia de los casos de uso", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entorno: ReturnType<typeof crearEntornoDeFacturacion>;
  /** Mientras haya una barrera, toda transacción espera en ella al leer el comprobante (o su clave). */
  let barrera: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDeFacturacion(propia.base, 16, (tx) => ({
      ...tx,
      comprobantes: {
        ...tx.comprobantes,
        obtener: async (...args) => {
          const c = await tx.comprobantes.obtener(...args);
          if (barrera !== null) await barrera();
          return c;
        },
        delOrigen: async (...args) => {
          const cs = await tx.comprobantes.delOrigen(...args);
          if (barrera !== null) await barrera();
          return cs;
        },
      },
      series: {
        ...tx.series,
        obtener: async (...args) => {
          const s = await tx.series.obtener(...args);
          if (barrera !== null) await barrera();
          return s;
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

  async function juntas<T>(n: number, llamada: (i: number) => Promise<T>): Promise<T[]> {
    barrera = crearBarrera(n);
    try {
      return await Promise.all(Array.from({ length: n }, (_, i) => llamada(i)));
    } finally {
      barrera = null;
    }
  }

  async function preparar(semilla?: number) {
    const e = await crearEscenarioDeCasos(dueno, propia.base, { rol: "GERENTE" });
    const reloj = new RelojDePrueba(new Date());
    const falsa = new EmisionFalsa(
      semilla === undefined
        ? {}
        : {
            decidir: guionAlAzar(semilla, {
              AUTORIZA: 5,
              RECHAZA: 1,
              INCIERTO: 1,
              NO_ENVIADO: 1,
              AUTORIZA_Y_SE_CAE: 1,
            }),
          },
    );
    const casos = casosDeFacturacion(
      entorno,
      { HOMOLOGACION: falsa, PRODUCCION: new EmisionFalsa() },
      reloj,
    );
    return { e, reloj, falsa, casos };
  }

  const estados = async (e: EscenarioDeCasos) =>
    await filas<{ id: string; estado: string; numero: string | null; cae: string | null }>(
      "select id, estado, numero::text as numero, cae from comprobante where empresa_id = $1 order by numero",
      [e.empresa],
    );

  it("dos emisiones simultáneas con la misma clave: un comprobante, una auditoría, un trabajo; la otra recibe yaExistia con el mismo id", async () => {
    for (let ronda = 0; ronda < RONDAS * 10; ronda++) {
      const { e, reloj, casos } = await preparar();
      const pedido = facturaManual(e);
      const [a, b] = await juntas(2, () =>
        casos.emitirComprobanteManual(e.como(reloj.ahora()), pedido),
      );
      expect(a?.ok && b?.ok, `ronda ${ronda}: ${JSON.stringify([a, b])}`).toBe(true);
      if (!a?.ok || !b?.ok) return;
      expect(a.valor.comprobanteId).toBe(b.valor.comprobanteId);
      expect([a.valor.yaExistia, b.valor.yaExistia].sort()).toEqual([false, true]);
      expect(
        await filas("select 1 from comprobante where empresa_id = $1", [e.empresa]),
      ).toHaveLength(1);
      expect(
        await filas(
          "select 1 from auditoria_empresa where empresa_id = $1 and accion = 'COMPROBANTE_CREADO'",
          [e.empresa],
        ),
      ).toHaveLength(1);
      expect(await filas("select 1 from trabajo where empresa_id = $1", [e.empresa])).toHaveLength(
        1,
      );
    }
  });

  it("dos trabajos de validación del mismo comprobante a la vez: un solo pedido a ARCA y un solo número", async () => {
    for (let ronda = 0; ronda < RONDAS * 3; ronda++) {
      const { e, reloj, falsa, casos } = await preparar();
      const emitido = await casos.emitirComprobanteManual(e.como(reloj.ahora()), facturaManual(e));
      if (!emitido.ok) throw new Error("no emitió");
      const id = emitido.valor.comprobanteId;
      const rs = await juntas(2, () =>
        casos.validarComprobante(e.sistema(reloj.ahora()), { comprobanteId: id }),
      );
      expect(rs.every((r) => r.ok)).toBe(true);
      expect(falsa.pedidos).toHaveLength(1);
      expect(await estados(e)).toMatchObject([{ estado: "AUTORIZADO", numero: "1" }]);
    }
  });

  it("descartar contra validar el mismo comprobante: o DESCARTADO sin número, o validado; nunca los dos", async () => {
    const vistos = new Set<string>();
    for (let ronda = 0; ronda < RONDAS * 4; ronda++) {
      const { e, reloj, falsa, casos } = await preparar();
      const emitido = await casos.emitirComprobanteManual(e.como(reloj.ahora()), facturaManual(e));
      if (!emitido.ok) throw new Error("no emitió");
      const id = emitido.valor.comprobanteId;
      barrera = crearBarrera(2);
      let descarte: Awaited<ReturnType<CasosDeUsoDeFacturacion["descartarComprobante"]>>;
      let validacion: Awaited<ReturnType<CasosDeUsoDeFacturacion["validarComprobante"]>>;
      try {
        [descarte, validacion] = await Promise.all([
          casos.descartarComprobante(e.como(reloj.ahora()), {
            comprobanteId: id,
            motivo: "carrera",
            versionEsperada: 1,
          }),
          casos.validarComprobante(e.sistema(reloj.ahora()), { comprobanteId: id }),
        ]);
      } finally {
        barrera = null;
      }
      const [c] = await estados(e);
      if (c?.estado === "DESCARTADO") {
        expect(c.numero).toBeNull();
        expect(validacion).toMatchObject({ ok: true, valor: { tipo: "NADA_QUE_VALIDAR" } });
        expect(falsa.pedidos).toHaveLength(0);
        vistos.add("DESCARTADO");
      } else {
        expect(c?.estado).toBe("AUTORIZADO");
        expect(descarte.ok).toBe(false);
        vistos.add("VALIDADO");
      }
    }
    expect(vistos.size).toBeGreaterThan(0);
  });

  it("dos resincronizaciones de la misma serie a la vez: una gana, la otra SERIE_NO_BLOQUEADA", async () => {
    for (let ronda = 0; ronda < RONDAS * 2; ronda++) {
      const { e, reloj, casos } = await preparar();
      await crearSerie(dueno, e.empresa, e.pv, e.emisor);
      await usarSerie(dueno, e.pv, "BLOQUEADA");
      const rs = await juntas(2, () =>
        casos.resincronizarSerie(e.como(reloj.ahora()), {
          puntoDeVentaId: puntoDeVentaId(e.pv),
          tipo: "FACTURA_B",
          ambiente: "HOMOLOGACION",
          ultimoVistoEnArca: 0n,
          motivo: "carrera",
        }),
      );
      expect(rs.filter((r) => r.ok)).toHaveLength(1);
      expect(rs.filter((r) => !r.ok)).toEqual([{ ok: false, error: "SERIE_NO_BLOQUEADA" }]);
      expect(
        await filas(
          "select 1 from auditoria_empresa where empresa_id = $1 and accion = 'SERIE_RESINCRONIZADA'",
          [e.empresa],
        ),
      ).toHaveLength(1);
    }
  });

  /** Valida y reconcilia hasta que no queda nada pendiente ni en vuelo. */
  async function hastaResolver(
    e: EscenarioDeCasos,
    reloj: RelojDePrueba,
    casos: CasosDeUsoDeFacturacion,
    ids: readonly ComprobanteId[],
    trabajadores: number,
  ) {
    for (let vuelta = 0; vuelta < 200; vuelta++) {
      const pendientes = (await estados(e))
        .filter((c) => c.estado === "PENDIENTE")
        .map((c) => c.id as ComprobanteId);
      const enVuelo = (await estados(e)).filter(
        (c) => c.estado === "EN_VALIDACION" || c.estado === "INCIERTO",
      );
      if (pendientes.length === 0 && enVuelo.length === 0) return vuelta;
      // Una cola compartida como la de trabajos: cada trabajador toma el siguiente; si la serie está ocupada lo
      // devuelve al final. Cuando todos ven solo series ocupadas (un incierto la retiene), se reconcilia.
      const cola = [...pendientes];
      let ocupadasSeguidas = 0;
      let reintentosPorCarga = 0;
      await Promise.all(
        Array.from({ length: trabajadores }, async () => {
          for (;;) {
            const id = cola.shift();
            if (id === undefined || ocupadasSeguidas > cola.length + trabajadores) return;
            const r = await casos.validarComprobante(e.sistema(reloj.ahora()), {
              comprobanteId: id,
            });
            // `ConcurrenciaAgotada` es una respuesta legítima bajo carga (SERIALIZABLE agotó sus reintentos): un
            // trabajador real devuelve el trabajo a la cola y lo repite, y validar es idempotente. Se acota para que
            // un error persistente no quede disfrazado de «carga»; cualquier otro error sigue siendo un fallo.
            if (
              !r.ok &&
              typeof r.error === "object" &&
              "tipo" in r.error &&
              r.error.tipo === "ConcurrenciaAgotada" &&
              ++reintentosPorCarga <= 200
            ) {
              cola.push(id);
              continue;
            }
            if (!r.ok) throw new Error(`validar falló: ${JSON.stringify(r.error)}`);
            if (r.valor.tipo === "SERIE_OCUPADA") {
              ocupadasSeguidas += 1;
              cola.push(id);
            } else {
              ocupadasSeguidas = 0;
            }
          }
        }),
      );
      if (enVuelo.length > 0 || cola.length > 0) {
        reloj.avanzar(6);
        const r = await casos.reconciliarComprobantes(e.sistema(reloj.ahora()), { limite: 100 });
        if (!r.ok) throw new Error("reconciliar falló");
      }
    }
    throw new Error(`no se resolvieron los ${ids.length} comprobantes`);
  }

  it("8 trabajadores × 50 comprobantes con ARCA al azar: autorizados consecutivos sin huecos ni repetidos, y lo de ARCA = lo de la base", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const { e, reloj, falsa, casos } = await preparar(20261014 + ronda);
      const ids: ComprobanteId[] = [];
      for (let i = 0; i < 50; i++) {
        const r = await casos.emitirComprobanteManual(e.como(reloj.ahora()), facturaManual(e));
        if (!r.ok) throw new Error("no emitió");
        ids.push(r.valor.comprobanteId);
      }
      await hastaResolver(e, reloj, casos, ids, 8);
      const finales = await estados(e);
      const autorizados = finales.filter((c) => c.estado === "AUTORIZADO");
      expect(finales.every((c) => c.estado === "AUTORIZADO" || c.estado === "RECHAZADO")).toBe(
        true,
      );
      const numeros = autorizados
        .map((c) => BigInt(c.numero ?? "0"))
        .sort((a, b) => (a < b ? -1 : 1));
      expect(numeros, `ronda ${ronda}`).toEqual(numeros.map((_, i) => BigInt(i + 1)));
      const [serie] = await filas<{ ultimo: string; estado: string }>(
        "select ultimo_numero::text as ultimo, estado from serie_comprobante where punto_de_venta_id = $1",
        [e.pv],
      );
      expect(serie).toEqual({ ultimo: String(autorizados.length), estado: "LIBRE" });
      // Lo que ARCA tiene autorizado es exactamente lo de la base, con el mismo CAE.
      const pv = { cuit: e.cuit, numero: e.pvNumero } as never;
      expect(await falsa.ultimoAutorizado(pv, "FACTURA_B")).toEqual({
        ok: true,
        valor: BigInt(autorizados.length),
      });
      for (const c of autorizados) {
        const consulta = await falsa.consultar(pv, "FACTURA_B", BigInt(c.numero ?? "0"));
        expect(consulta).toMatchObject({ tipo: "ENCONTRADO", codigo: c.cae });
      }
      // Un número nunca se pidió dos veces con éxito: cada autorizado de ARCA es de un solo comprobante.
      const autorizadosPorArca = new Set(
        falsa.pedidos.filter((s) => s.numero <= BigInt(autorizados.length)).map((s) => s.solicitud),
      );
      expect(autorizadosPorArca.size).toBeGreaterThanOrEqual(autorizados.length);
    }
  });
});
