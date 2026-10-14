import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  puntoDeVentaId,
  verificarSecuencia,
  type CasosDeUsoDeFacturacion,
  type ComprobanteId,
  type EmisionElectronica,
  type PuntoDeVentaParaEmision,
} from "../../src/modulos/fiscal/publico";
import { EmisionFalsa } from "../utilidades/emision-falsa";
import { crearBarrera, crearBaseAparte } from "./entorno";
import {
  RelojDePrueba,
  casosDeFacturacion,
  crearEntornoDeFacturacion,
  crearEscenarioDeCasos,
  facturaManual,
  type EscenarioDeCasos,
} from "./facturacion-casos-apoyo";
import { crearSerie } from "./fiscal-apoyo";

/**
 * H7 facturación, pieza F5b: concurrencia REAL del rechazo 10016 con ARCA «adelantado» (otro sistema usó el punto
 * de venta). Con una barrera dentro de cada transacción (en la primera lectura) se fuerza que todas lean el mismo
 * estado antes de que cualquiera escriba. Lo que tiene que valer pase lo que pase: exactamente una serie
 * `BLOQUEADA` y un solo comprobante `RECHAZADO` (el que ARCA rechazó), ningún autorizado de más, ninguna
 * numeración duplicada y ningún estado a medias (ni en vuelo ni con la reserva abierta). ARCA es el falso.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 600_000 });

/** Rondas de las pruebas largas; el CI y la estabilidad local pueden subirlas con la variable. */
const RONDAS = Number(process.env["ZULUHUB_RONDAS_FACTURACION"] ?? "2");

/** El último número que ARCA ya tiene (otro sistema lo usó) cuando empieza cada prueba. */
const ARCA_ADELANTE = 5n;

/** Un valor como texto para un mensaje de falla (JSON no sabe de `bigint`). */
const comoTexto = (valor: unknown): string =>
  JSON.stringify(valor, (_clave, v: unknown) => (typeof v === "bigint" ? v.toString() : v));

describe.skipIf(base === null)(
  "facturación F5b: concurrencia del rechazo 10016 con ARCA adelantado",
  () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let dueno: pg.Client;
    let entorno: ReturnType<typeof crearEntornoDeFacturacion>;
    /** Mientras haya una barrera, toda transacción espera en ella al hacer su primera lectura. */
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

    /** Una empresa con su serie en 0 y ARCA falsa ya en `ARCA_ADELANTE`: otro sistema usó el punto de venta. */
    async function preparar(arcaDe: (falsa: EmisionFalsa) => EmisionElectronica = (f) => f) {
      const e = await crearEscenarioDeCasos(dueno, propia.base, { rol: "GERENTE" });
      await crearSerie(dueno, e.empresa, e.pv, e.emisor);
      const reloj = new RelojDePrueba(new Date());
      const falsa = new EmisionFalsa();
      const pv = { cuit: e.cuit, numero: e.pvNumero } as PuntoDeVentaParaEmision;
      falsa.fijarUltimo(pv, "FACTURA_B", ARCA_ADELANTE);
      const casos = casosDeFacturacion(
        entorno,
        { HOMOLOGACION: arcaDe(falsa), PRODUCCION: new EmisionFalsa() },
        reloj,
      );
      return { e, reloj, falsa, pv, casos };
    }

    const emitir = async (
      p: Awaited<ReturnType<typeof preparar>>,
      n: number,
    ): Promise<ComprobanteId[]> => {
      const ids: ComprobanteId[] = [];
      for (let i = 0; i < n; i++) {
        const r = await p.casos.emitirComprobanteManual(
          p.e.como(p.reloj.ahora()),
          facturaManual(p.e),
        );
        if (!r.ok) throw new Error("no emitió");
        ids.push(r.valor.comprobanteId);
      }
      return ids;
    };

    const validar = (p: Awaited<ReturnType<typeof preparar>>, id: ComprobanteId) =>
      p.casos.validarComprobante(p.e.sistema(p.reloj.ahora()), { comprobanteId: id });

    /**
     * Lo que vale siempre con ARCA adelantado: el único pedido que salió a ARCA fue rechazado, y de ahí en más
     * nada sale. Exactamente una serie, `BLOQUEADA`, sin avanzar y con su reserva cerrada; un solo comprobante
     * `RECHAZADO` sin CAE; los demás `PENDIENTE` sin número; ninguno autorizado, en vuelo ni con número repetido.
     */
    async function afirmarInvariantes(
      e: EscenarioDeCasos,
      falsa: EmisionFalsa,
      total: number,
      contexto: string,
    ) {
      const series = await filas<{
        estado: string;
        ultimo: string;
        en_curso: string | null;
        solicitud: string | null;
        motivo: string | null;
      }>(
        `select estado, ultimo_numero::text as ultimo, numero_en_curso::text as en_curso,
                solicitud_en_curso as solicitud, motivo_bloqueo as motivo
           from serie_comprobante where empresa_id = $1`,
        [e.empresa],
      );
      expect(series, contexto).toEqual([
        {
          estado: "BLOQUEADA",
          ultimo: "0",
          en_curso: null,
          solicitud: null,
          motivo: expect.stringContaining("desfase") as unknown,
        },
      ]);
      const comprobantes = await filas<{
        estado: string;
        reservado: string | null;
        numero: string | null;
        cae: string | null;
      }>(
        `select estado, numero_reservado::text as reservado, numero::text as numero, cae
           from comprobante where empresa_id = $1 order by estado`,
        [e.empresa],
      );
      expect(comprobantes, contexto).toHaveLength(total);
      expect(
        comprobantes.filter((c) => c.estado === "RECHAZADO"),
        contexto,
      ).toEqual([{ estado: "RECHAZADO", reservado: "1", numero: null, cae: null }]);
      expect(
        comprobantes.filter((c) => c.estado === "PENDIENTE"),
        contexto,
      ).toEqual(
        Array.from({ length: total - 1 }, () => ({
          estado: "PENDIENTE",
          reservado: null,
          numero: null,
          cae: null,
        })),
      );
      // Ningún autorizado de más, ningún comprobante en vuelo y ningún número autorizado repetido.
      expect(comprobantes.filter((c) => c.numero !== null || c.cae !== null)).toEqual([]);
      expect(
        await filas(
          `select numero from comprobante where empresa_id = $1 and numero is not null
            group by numero having count(*) > 1`,
          [e.empresa],
        ),
      ).toEqual([]);
      // A ARCA salió un solo pedido, y ARCA sigue donde estaba.
      expect(falsa.pedidos, contexto).toHaveLength(1);
      // La auditoría: una reserva, un bloqueo, un rechazo del comprobante; ninguna autorización.
      const acciones = await filas<{ accion: string; n: string }>(
        `select accion, count(*)::text as n from auditoria_empresa
          where empresa_id = $1 and accion in ('SERIE_BLOQUEADA', 'NUMERO_DE_COMPROBANTE_RESERVADO',
                'NUMERO_DE_COMPROBANTE_RECHAZADO', 'COMPROBANTE_RECHAZADO', 'COMPROBANTE_AUTORIZADO',
                'NUMERO_DE_COMPROBANTE_AUTORIZADO')
          group by accion order by accion`,
        [e.empresa],
      );
      expect(acciones, contexto).toEqual([
        { accion: "COMPROBANTE_RECHAZADO", n: "1" },
        { accion: "NUMERO_DE_COMPROBANTE_RESERVADO", n: "1" },
        { accion: "SERIE_BLOQUEADA", n: "1" },
      ]);
      // Un solo intento de autorizar y una sola consulta del último autorizado.
      expect(
        await filas(
          `select operacion, desenlace, count(*)::text as n from intento_arca where empresa_id = $1
            group by operacion, desenlace order by operacion`,
          [e.empresa],
        ),
        contexto,
      ).toEqual([
        { operacion: "AUTORIZAR", desenlace: "RECHAZADO", n: "1" },
        { operacion: "ULTIMO_AUTORIZADO", desenlace: "RESPONDIDO", n: "1" },
      ]);
    }

    /** Vuelve a validar hasta que ninguno diga que la serie está ocupada (la cola reintenta los ocupados). */
    async function validarHastaQueNoHayaOcupadas(
      p: Awaited<ReturnType<typeof preparar>>,
      ids: readonly ComprobanteId[],
    ) {
      for (let vuelta = 0; vuelta < 50; vuelta++) {
        const rs = await Promise.all(ids.map((id) => validar(p, id)));
        for (const r of rs) {
          if (!r.ok) throw new Error(`validar falló: ${comoTexto(r.error)}`);
        }
        if (!rs.some((r) => r.ok && r.valor.tipo === "SERIE_OCUPADA")) return;
      }
      throw new Error("la serie siguió ocupada");
    }

    it("dos emisiones simultáneas sobre la misma serie con ARCA adelantado: una rechazada, la serie bloqueada una vez, la otra espera", async () => {
      for (let ronda = 0; ronda < RONDAS * 6; ronda++) {
        const p = await preparar();
        const ids = await emitir(p, 2);
        const rs = await juntas(2, (i) => validar(p, ids[i] as ComprobanteId));
        for (const r of rs) expect(r.ok, `ronda ${ronda}: ${comoTexto(rs)}`).toBe(true);
        // Cualquiera que haya quedado esperando se reintenta: la serie ya está bloqueada, nada sale a ARCA.
        await validarHastaQueNoHayaOcupadas(p, ids);
        await afirmarInvariantes(p.e, p.falsa, 2, `ronda ${ronda}`);
        // Y exactamente una dijo que dejó la serie bloqueada.
        expect(
          rs.filter((r) => r.ok && r.valor.tipo === "ENVIADO" && r.valor.serieBloqueada === true),
        ).toHaveLength(1);
      }
    });

    it("cuatro validaciones simultáneas de cuatro comprobantes: un solo pedido a ARCA, un solo rechazado, tres esperando", async () => {
      for (let ronda = 0; ronda < RONDAS * 3; ronda++) {
        const p = await preparar();
        const ids = await emitir(p, 4);
        await juntas(4, (i) => validar(p, ids[i] as ComprobanteId));
        await validarHastaQueNoHayaOcupadas(p, ids);
        await afirmarInvariantes(p.e, p.falsa, 4, `ronda ${ronda}`);
      }
    });

    it("emitir y validar de punta a punta en paralelo (sin barrera): se mantienen las mismas invariantes", async () => {
      for (let ronda = 0; ronda < RONDAS * 3; ronda++) {
        const p = await preparar();
        const ids = await Promise.all(
          Array.from({ length: 3 }, async () => {
            const r = await p.casos.emitirComprobanteManual(
              p.e.como(p.reloj.ahora()),
              facturaManual(p.e),
            );
            if (!r.ok) throw new Error("no emitió");
            const v = await validar(p, r.valor.comprobanteId);
            if (!v.ok) throw new Error(`validar falló: ${comoTexto(v.error)}`);
            return r.valor.comprobanteId;
          }),
        );
        await validarHastaQueNoHayaOcupadas(p, ids);
        await afirmarInvariantes(p.e, p.falsa, 3, `ronda ${ronda}`);
      }
    });

    it("dos trabajos de validación del MISMO comprobante a la vez: un pedido, un rechazo, un bloqueo", async () => {
      for (let ronda = 0; ronda < RONDAS * 3; ronda++) {
        const p = await preparar();
        const [id] = await emitir(p, 1);
        const rs = await juntas(2, () => validar(p, id as ComprobanteId));
        expect(rs.every((r) => r.ok)).toBe(true);
        await afirmarInvariantes(p.e, p.falsa, 1, `ronda ${ronda}`);
      }
    });

    it("la reconciliación gana la carrera mientras el 10016 todavía viaja: el comprobante queda en CONFLICTO y la serie se bloquea UNA vez, sin pisarse", async () => {
      const p = await (async () => {
        // ARCA que retiene la respuesta de `autorizar` hasta que la prueba la suelta.
        let soltar: () => void = () => undefined;
        const gate = new Promise<void>((resolver) => {
          soltar = resolver;
        });
        let llego: () => void = () => undefined;
        const enViaje = new Promise<void>((resolver) => {
          llego = resolver;
        });
        const p = await preparar((falsa) => ({
          ultimoAutorizado: (pv, tipo) => falsa.ultimoAutorizado(pv, tipo),
          autorizar: async (s) => {
            llego();
            await gate;
            return falsa.autorizar(s);
          },
          consultar: (pv, tipo, n) => falsa.consultar(pv, tipo, n),
        }));
        return { ...p, soltar, enViaje };
      })();
      const [id] = await emitir(p, 1);
      const validacion = validar(p, id as ComprobanteId);
      await p.enViaje;
      // Vence la reserva y la reconciliación consulta el número (ARCA ya pasó de él): conflicto, serie bloqueada.
      p.reloj.avanzar(6);
      expect(await p.casos.reconciliarComprobantes(p.e.sistema(p.reloj.ahora()))).toMatchObject({
        ok: true,
        valor: { comprobantes: [{ resultado: { ok: true, valor: "CONFLICTO" } }] },
      });
      // Recién ahora llega el 10016: el cierre encuentra el comprobante ya resuelto y no toca nada.
      p.soltar();
      expect(await validacion).toMatchObject({
        ok: true,
        valor: { tipo: "ENVIADO", desenlace: "RECHAZADO", cerrado: false },
      });
      expect(
        await filas("select estado, cae from comprobante where empresa_id = $1", [p.e.empresa]),
      ).toEqual([{ estado: "CONFLICTO", cae: null }]);
      expect(
        await filas(
          "select estado, ultimo_numero::text as ultimo, motivo_bloqueo as motivo from serie_comprobante where empresa_id = $1",
          [p.e.empresa],
        ),
      ).toEqual([
        {
          estado: "BLOQUEADA",
          ultimo: "0",
          motivo: "el número 1 lo usó otro comprobante en ARCA",
        },
      ]);
      expect(
        await filas(
          "select 1 from auditoria_empresa where empresa_id = $1 and accion = 'SERIE_BLOQUEADA'",
          [p.e.empresa],
        ),
      ).toHaveLength(1);
      expect(
        await filas(
          "select 1 from auditoria_empresa where empresa_id = $1 and accion = 'COMPROBANTE_RECHAZADO'",
          [p.e.empresa],
        ),
      ).toHaveLength(0);
    });

    it("después de bloquear, dos resincronizaciones a la vez: una gana; los pendientes salen con números consecutivos, sin repetir", async () => {
      for (let ronda = 0; ronda < RONDAS * 2; ronda++) {
        const p = await preparar();
        const ids = await emitir(p, 4);
        await juntas(4, (i) => validar(p, ids[i] as ComprobanteId));
        await validarHastaQueNoHayaOcupadas(p, ids);
        await afirmarInvariantes(p.e, p.falsa, 4, `ronda ${ronda}`);

        const resincronizar = (casos: CasosDeUsoDeFacturacion) =>
          casos.resincronizarSerie(p.e.como(p.reloj.ahora()), {
            puntoDeVentaId: puntoDeVentaId(p.e.pv),
            tipo: "FACTURA_B",
            ambiente: "HOMOLOGACION",
            ultimoVistoEnArca: ARCA_ADELANTE,
            motivo: "otro sistema usó el punto de venta",
          });
        const rs = await juntas(2, () => resincronizar(p.casos));
        expect(rs.filter((r) => r.ok)).toHaveLength(1);
        expect(rs.filter((r) => !r.ok)).toEqual([{ ok: false, error: "SERIE_NO_BLOQUEADA" }]);
        expect(
          await filas(
            "select 1 from auditoria_empresa where empresa_id = $1 and accion = 'SERIE_RESINCRONIZADA'",
            [p.e.empresa],
          ),
        ).toHaveLength(1);

        // Los tres pendientes, a la vez: números consecutivos desde el de ARCA y ningún pedido repetido.
        const pendientes = (
          await filas<{ id: string }>(
            "select id from comprobante where empresa_id = $1 and estado = 'PENDIENTE'",
            [p.e.empresa],
          )
        ).map((c) => c.id as ComprobanteId);
        expect(pendientes).toHaveLength(3);
        await juntas(3, (i) => validar(p, pendientes[i] as ComprobanteId));
        await validarHastaQueNoHayaOcupadas(p, pendientes);
        const autorizados = (
          await filas<{ numero: string }>(
            "select numero::text as numero from comprobante where empresa_id = $1 and estado = 'AUTORIZADO'",
            [p.e.empresa],
          )
        ).map((c) => BigInt(c.numero));
        expect(autorizados).toHaveLength(3);
        expect(verificarSecuencia(ARCA_ADELANTE, autorizados)).toEqual({
          ok: true,
          valor: ARCA_ADELANTE + 3n,
        });
        expect(
          await filas(
            "select estado, ultimo_numero::text as ultimo from serie_comprobante where empresa_id = $1",
            [p.e.empresa],
          ),
        ).toEqual([{ estado: "LIBRE", ultimo: String(ARCA_ADELANTE + 3n) }]);
      }
    });
  },
);
