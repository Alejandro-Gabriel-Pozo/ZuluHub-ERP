import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { ganchoDeSucursalDeCaja } from "../../src/modulos/caja/publico";
import { crearBarrera, crearBaseAparte, crearEntornoDePrueba } from "./entorno";
import {
  armarCaja,
  armarEmpresasConGanchos,
  crearEntornoDeCaja,
  otraSucursalDeCaja,
  type OpcionesDeMundoDeCaja,
  type TxDeCajaDePrueba,
} from "./caja-configuracion-apoyo";
import {
  CERO,
  claveNueva,
  conAhora,
  crearMundoDeOperacion,
  fechaLocal,
  instanteLocal,
  pesos,
  type MundoDeOperacion,
} from "./caja-operacion-apoyo";

/**
 * Concurrencia e idempotencia de la operación de caja (E3, tramo 5; e3 §5.2) con una base real, los roles limitados y una barrera: todas
 * las transacciones de la ronda leen la autorización y esperan a que lleguen las demás antes de seguir, así de verdad corren a la vez.
 * Dos aperturas de la misma caja, el doble clic en cada operación, dos anulaciones del mismo movimiento, desactivar la caja contra abrir,
 * abrir contra la «Caja 1» por defecto, abrir contra un cambio del corte, y movimientos contra el cierre (todo confirmado queda contado).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

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
  const consultas = () => caja.consultas;
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
  const auditorias = (m: MundoDeOperacion, accion: string) =>
    contar("select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = $2", [
      m.empresa,
      accion,
    ]);
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

  // =============================================================================================
  describe("abrirSesion", () => {
    it("dos aperturas de la misma caja a la vez con claves distintas: una abre y la otra recibe CAJA_YA_ABIERTA con la sesión abierta", async () => {
      for (let i = 0; i < RONDAS; i += 1) {
        const m = await mundo();
        const abrirCon = () =>
          casos().abrirSesion(ctxEn(m), {
            claveDeIdempotencia: claveNueva(),
            sucursalId: m.sucursal,
            cajaId: m.cajaId,
            fondoInicial: pesos("100.00"),
          });
        const rs = await aLaVez([abrirCon, abrirCon]);
        const abierta = (
          await filas<{ id: string }>("select id from sesion_caja where empresa_id = $1", [
            m.empresa,
          ])
        ).map((s) => s.id);
        expect(abierta, JSON.stringify(resumen(rs))).toHaveLength(1);
        const gano = rs.filter((r) => r.ok);
        const perdio = rs.filter((r) => !r.ok);
        expect(gano).toHaveLength(1);
        expect(perdio[0]).toEqual({
          ok: false,
          error: { codigo: "CAJA_YA_ABIERTA", sesionId: abierta[0] },
        });
        expect(await auditorias(m, "SESION_CAJA_ABIERTA")).toBe(1);
        // Un solo fondo inicial.
        expect(
          await contar(
            "select count(*) as n from movimiento_caja where empresa_id = $1 and clase = 'FONDO_INICIAL'",
            [m.empresa],
          ),
        ).toBe(1);
      }
    });

    it("dos aperturas con la MISMA clave a la vez (doble clic): una sesión, y la otra devuelve yaExistia", async () => {
      for (let i = 0; i < RONDAS; i += 1) {
        const m = await mundo();
        const entrada = {
          claveDeIdempotencia: claveNueva(),
          sucursalId: m.sucursal,
          cajaId: m.cajaId,
          fondoInicial: pesos("100.00"),
        };
        const rs = await aLaVez([
          () => casos().abrirSesion(ctxEn(m), entrada),
          () => casos().abrirSesion(ctxEn(m), entrada),
          () => casos().abrirSesion(ctxEn(m), entrada),
        ]);
        expect(
          rs.every((r) => r.ok),
          JSON.stringify(resumen(rs)),
        ).toBe(true);
        expect(
          await contar("select count(*) as n from sesion_caja where empresa_id = $1", [m.empresa]),
        ).toBe(1);
        expect(rs.filter((r) => r.ok && r.valor.yaExistia)).toHaveLength(2);
        expect(new Set(rs.map((r) => (r.ok ? r.valor.sesionId : ""))).size).toBe(1);
        expect(await auditorias(m, "SESION_CAJA_ABIERTA")).toBe(1);
      }
    });

    it("desactivarCaja contra abrirSesion: o la sesión abre antes y la desactivación da CAJA_CON_SESION_VIGENTE, o la caja se desactiva y no abre", async () => {
      const resultados = new Set<string>();
      for (let i = 0; i < RONDAS * 2; i += 1) {
        const m = await mundo();
        const [apertura, desactivacion] = await aLaVez([
          () =>
            casos().abrirSesion(ctxEn(m), {
              claveDeIdempotencia: claveNueva(),
              sucursalId: m.sucursal,
              cajaId: m.cajaId,
              fondoInicial: pesos("100.00"),
            }),
          () => casos().desactivarCaja(m.ctx(), { cajaId: m.cajaId }),
        ] as const);
        const sesiones = await contar(
          "select count(*) as n from sesion_caja where empresa_id = $1",
          [m.empresa],
        );
        const activa = (
          await filas<{ activa: boolean }>("select activa from caja where id = $1", [m.cajaId])
        )[0]?.activa;
        if (apertura?.ok) {
          // Abrió: la caja tiene su sesión sin cerrar y NO quedó desactivada.
          expect(sesiones).toBe(1);
          expect(activa).toBe(true);
          expect(desactivacion).toMatchObject({ ok: false, error: "CAJA_CON_SESION_VIGENTE" });
          resultados.add("abre antes");
        } else {
          // No abrió: la caja quedó desactivada y no hay sesión.
          expect(sesiones).toBe(0);
          expect(activa).toBe(false);
          expect(desactivacion).toMatchObject({ ok: true });
          expect(apertura).toEqual({ ok: false, error: "CAJA_INACTIVA" });
          resultados.add("desactiva antes");
        }
      }
      expect(resultados.size).toBeGreaterThan(0);
    });

    it("abrirSesion con cajaId null contra asegurarCajaPorDefecto a la vez: una sola «Caja 1» y una sola sesión", async () => {
      for (let i = 0; i < RONDAS; i += 1) {
        const m = await mundo();
        const sucursal = await otraSucursalDeCaja(dueno, m.empresa, `Nueva ${i}`);
        const [apertura, asegurada, otraApertura] = await aLaVez([
          () =>
            casos().abrirSesion(ctxEn(m), {
              claveDeIdempotencia: claveNueva(),
              sucursalId: sucursal,
              cajaId: null,
              fondoInicial: pesos("100.00"),
            }),
          () => casos().asegurarCajaPorDefecto(m.ctx(), { sucursalId: sucursal }),
          () => casos().asegurarCajaPorDefecto(m.ctx(), { sucursalId: sucursal }),
        ] as const);
        expect(
          asegurada.ok && otraApertura.ok,
          JSON.stringify(resumen([apertura, asegurada, otraApertura])),
        ).toBe(true);
        expect(
          await contar(
            "select count(*) as n from caja where empresa_id = $1 and sucursal_id = $2",
            [m.empresa, sucursal],
          ),
        ).toBe(1);
        expect(
          await contar(
            "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = 'CAJA_CREADA' and despues->>'sucursalId' = $2",
            [m.empresa, sucursal],
          ),
        ).toBe(1);
        // La apertura abrió, o la recibió una caja ya existente con CAJA_REQUERIDA (otra transacción la creó antes): nunca dos sesiones.
        expect(
          await contar(
            "select count(*) as n from sesion_caja s join caja c on c.id = s.caja_id where s.empresa_id = $1 and c.sucursal_id = $2",
            [m.empresa, sucursal],
          ),
        ).toBe(apertura.ok ? 1 : 0);
        if (!apertura.ok) expect(apertura.error).toBe("CAJA_REQUERIDA");
      }
    });

    it("abrir y cambiar la hora de corte a la vez: la sesión nace con el corte viejo o con el nuevo, siempre con su sello y con la fecha que da la fórmula", async () => {
      const empresas = armarEmpresasConGanchos(entorno, [ganchoDeSucursalDeCaja]);
      const vistos = new Set<string>();
      for (let i = 0; i < RONDAS * 2; i += 1) {
        const m = await mundo();
        const [sucursal] = await filas<{ version: number; nombre: string }>(
          "select version, nombre from sucursal where id = $1",
          [m.sucursal],
        );
        // 05:30 en Buenos Aires: con corte 00:00 es la jornada de hoy; con corte 06:00, la de ayer.
        const ahora = en(1, 0, "05:30");
        const [apertura, cambio] = await aLaVez([
          () =>
            casos().abrirSesion(conAhora(m.ctx(), ahora), {
              claveDeIdempotencia: claveNueva(),
              sucursalId: m.sucursal,
              cajaId: m.cajaId,
              fondoInicial: pesos("100.00"),
            }),
          () =>
            empresas.editarSucursal(m.ctx(), {
              sucursalId: m.sucursal,
              versionEsperada: sucursal?.version as number,
              nombre: sucursal?.nombre as string,
              horaDeCorte: "06:00",
            }),
        ] as const);
        expect(cambio.ok, JSON.stringify(cambio)).toBe(true);
        expect(apertura.ok, JSON.stringify(apertura)).toBe(true);
        const [fila] = await filas<{ corte: string; fecha: string }>(
          "select to_char(hora_de_corte, 'HH24:MI') as corte, fecha_negocio::text as fecha from sesion_caja where empresa_id = $1",
          [m.empresa],
        );
        const esperada =
          fila?.corte === "06:00"
            ? fechaLocal(new Date(ahora.getTime() - 24 * 3_600_000))
            : fechaLocal(ahora);
        expect(fila?.fecha).toBe(esperada);
        expect(["00:00", "06:00"]).toContain(fila?.corte);
        vistos.add(fila?.corte ?? "");
        // Lo que se abra después ya lleva el corte nuevo.
        const despues = await casos().abrirSesion(ctxEn(m, 2, 0, "05:30"), {
          claveDeIdempotencia: claveNueva(),
          sucursalId: m.sucursal,
          cajaId: m.cajaId,
          fondoInicial: pesos("1.00"),
        });
        // La primera sigue abierta: una caja, una sesión sin cerrar.
        expect(despues).toMatchObject({ ok: false, error: { codigo: "CAJA_YA_ABIERTA" } });
      }
      expect(vistos.size).toBeGreaterThan(0);
    });
  });

  // =============================================================================================
  describe("cerrar", () => {
    it("el doble clic en cerrar con el mismo conteo: una cierra y la otra devuelve yaEstabaCerrada; un solo arqueo", async () => {
      for (let i = 0; i < RONDAS; i += 1) {
        const m = await mundo();
        const sesion = await abrir(m);
        const pedido = {
          sesionId: sesion,
          conteo: { billetes: [{ denominacion: 1000, cantidad: 1 }], monedas: CERO },
          otros: [],
          conformeGeneral: false,
          observacion: null,
        };
        const rs = await aLaVez([
          () => casos().cerrarSesion(ctxEn(m, 1, 30), pedido),
          () => casos().cerrarSesion(ctxEn(m, 1, 30), pedido),
        ]);
        expect(
          rs.every((r) => r.ok),
          JSON.stringify(resumen(rs)),
        ).toBe(true);
        expect(rs.map((r) => (r.ok ? r.valor.yaEstabaCerrada : null)).sort()).toEqual([
          false,
          true,
        ]);
        expect(
          await contar("select count(*) as n from arqueo_caja where sesion_id = $1", [sesion]),
        ).toBe(1);
        expect(
          await contar("select count(*) as n from arqueo_billete where sesion_id = $1", [sesion]),
        ).toBe(1);
        expect(await auditorias(m, "SESION_CAJA_CERRADA")).toBe(1);
      }
    });

    it("dos cierres a la vez con conteos distintos: uno cierra y el otro recibe SESION_CERRADA", async () => {
      for (let i = 0; i < RONDAS; i += 1) {
        const m = await mundo();
        const sesion = await abrir(m);
        const conBilletes = (cantidad: number) => ({
          sesionId: sesion,
          conteo: { billetes: [{ denominacion: 1000, cantidad }], monedas: CERO },
          otros: [],
          conformeGeneral: false,
          observacion: null,
        });
        const rs = await aLaVez([
          () => casos().cerrarSesion(ctxEn(m, 1, 30), conBilletes(1)),
          () => casos().cerrarSesion(ctxEn(m, 1, 30), conBilletes(2)),
        ]);
        expect(
          rs.filter((r) => r.ok),
          JSON.stringify(resumen(rs)),
        ).toHaveLength(1);
        expect(rs.find((r) => !r.ok)).toEqual({ ok: false, error: "SESION_CERRADA" });
        expect(
          await contar("select count(*) as n from arqueo_caja where sesion_id = $1", [sesion]),
        ).toBe(1);
        // Quedó el conteo del que ganó.
        const ganadora = rs.findIndex((r) => r.ok) + 1;
        expect(
          (
            await filas<{ cantidad: number }>(
              "select cantidad from arqueo_billete where sesion_id = $1",
              [sesion],
            )
          )[0]?.cantidad,
        ).toBe(ganadora);
      }
    });

    it("iniciar el cierre dos veces a la vez: uno lo inicia y el otro devuelve yaEstabaEnCierre, con una sola auditoría", async () => {
      for (let i = 0; i < RONDAS; i += 1) {
        const m = await mundo();
        const sesion = await abrir(m);
        const rs = await aLaVez([
          () => casos().iniciarCierre(ctxEn(m, 1, 10), { sesionId: sesion }),
          () => casos().iniciarCierre(ctxEn(m, 1, 10), { sesionId: sesion }),
        ]);
        expect(
          rs.every((r) => r.ok),
          JSON.stringify(resumen(rs)),
        ).toBe(true);
        expect(rs.map((r) => (r.ok ? r.valor.yaEstabaEnCierre : null)).sort()).toEqual([
          false,
          true,
        ]);
        expect(await auditorias(m, "SESION_CAJA_CIERRE_INICIADO")).toBe(1);
      }
    });

    it("ingresos a la vez contra el cierre: todo lo confirmado queda contado en el esperado del arqueo; lo rechazado no escribe", async () => {
      let confirmados = 0;
      let rechazados = 0;
      for (let i = 0; i < RONDAS * 2; i += 1) {
        const m = await mundo();
        const sesion = await abrir(m);
        const rs = await aLaVez([
          () =>
            casos().cerrarSesion(ctxEn(m, 1, 30), {
              sesionId: sesion,
              conteo: { billetes: [{ denominacion: 1000, cantidad: 1 }], monedas: CERO },
              otros: [],
              conformeGeneral: false,
              observacion: null,
            }),
          ...Array.from({ length: 5 }, () => () => ingreso(m, sesion)),
        ] as const);
        const [cierre, ...ingresos] = rs;
        expect(cierre.ok, JSON.stringify(resumen(rs))).toBe(true);
        const buenos = ingresos.filter((r) => r.ok);
        const malos = ingresos.filter((r) => !r.ok);
        for (const r of malos)
          expect(["SESION_EN_CIERRE", "SESION_CERRADA"]).toContain(r.ok ? "" : r.error);
        confirmados += buenos.length;
        rechazados += malos.length;
        // Cada ingreso confirmado está en el esperado del arqueo, al centavo; ninguno quedó fuera de la cuenta.
        const [linea] = await filas<{ esperado: string }>(
          "select esperado::text from arqueo_caja where sesion_id = $1",
          [sesion],
        );
        expect(linea?.esperado).toBe((1000 + 10 * buenos.length).toFixed(2));
        expect(
          await contar(
            "select count(*) as n from movimiento_caja where sesion_id = $1 and clase = 'INGRESO_MANUAL'",
            [sesion],
          ),
        ).toBe(buenos.length);
      }
      expect(confirmados + rechazados).toBe(RONDAS * 2 * 5);
    });
  });

  // =============================================================================================
  describe("movimientos, ajustes y anulaciones: la misma clave dos veces a la vez", () => {
    it("ingresos con la misma clave a la vez (doble clic): una fila, el resto yaExistia", async () => {
      for (let i = 0; i < RONDAS; i += 1) {
        const m = await mundo();
        const sesion = await abrir(m);
        const clave = claveNueva();
        const rs = await aLaVez([
          () => ingreso(m, sesion, clave),
          () => ingreso(m, sesion, clave),
          () => ingreso(m, sesion, clave),
        ]);
        expect(
          rs.every((r) => r.ok),
          JSON.stringify(resumen(rs)),
        ).toBe(true);
        expect(rs.filter((r) => r.ok && r.valor.yaExistia)).toHaveLength(2);
        expect(new Set(rs.map((r) => (r.ok ? r.valor.movimientoId : ""))).size).toBe(1);
        expect(
          await contar(
            "select count(*) as n from movimiento_caja where sesion_id = $1 and clase = 'INGRESO_MANUAL'",
            [sesion],
          ),
        ).toBe(1);
        expect(await auditorias(m, "MOVIMIENTO_MANUAL_REGISTRADO")).toBe(1);
      }
    });

    it("egresos con la misma clave a la vez: una fila, una auditoría de egreso que supera el efectivo, el resto yaExistia", async () => {
      for (let i = 0; i < RONDAS; i += 1) {
        const m = await mundo();
        const sesion = await abrir(m);
        const entrada = {
          claveDeIdempotencia: claveNueva(),
          sesionId: sesion,
          sentido: "EGRESO" as const,
          importe: pesos("5000.00"),
          motivo: "Retiro",
        };
        const rs = await aLaVez([
          () => casos().registrarMovimientoManual(ctxEn(m, 1, 5), entrada),
          () => casos().registrarMovimientoManual(ctxEn(m, 1, 5), entrada),
        ]);
        expect(
          rs.every((r) => r.ok),
          JSON.stringify(resumen(rs)),
        ).toBe(true);
        expect(
          await contar(
            "select count(*) as n from movimiento_caja where sesion_id = $1 and clase = 'EGRESO_MANUAL'",
            [sesion],
          ),
        ).toBe(1);
        expect(await auditorias(m, "EGRESO_SUPERA_EFECTIVO")).toBe(1);
      }
    });

    it("ajustes con la misma clave a la vez: una fila, el resto yaExistia", async () => {
      for (let i = 0; i < RONDAS; i += 1) {
        const m = await mundo();
        const sesion = await abrir(m);
        const efectivo = (
          await filas<{ id: string }>(
            "select id from medio_de_pago where empresa_id = $1 and tipo = 'EFECTIVO'",
            [m.empresa],
          )
        )[0]?.id as string;
        const entrada = {
          claveDeIdempotencia: claveNueva(),
          sesionId: sesion,
          medioDePagoId: efectivo,
          cuentaDeCobroId: null,
          importe: pesos("-7.00"),
          motivo: "Faltante",
          corrigeJornada: null,
        };
        const rs = await aLaVez([
          () => casos().registrarAjuste(ctxEn(m, 1, 5), entrada),
          () => casos().registrarAjuste(ctxEn(m, 1, 5), entrada),
          () => casos().registrarAjuste(ctxEn(m, 1, 5), entrada),
        ]);
        expect(
          rs.every((r) => r.ok),
          JSON.stringify(resumen(rs)),
        ).toBe(true);
        expect(rs.filter((r) => r.ok && r.valor.yaExistia)).toHaveLength(2);
        expect(
          await contar(
            "select count(*) as n from movimiento_caja where sesion_id = $1 and clase = 'AJUSTE'",
            [sesion],
          ),
        ).toBe(1);
        expect(await auditorias(m, "AJUSTE_REGISTRADO")).toBe(1);
      }
    });

    it("dos anulaciones del mismo movimiento a la vez con claves distintas: una anula y la otra recibe MOVIMIENTO_YA_ANULADO", async () => {
      for (let i = 0; i < RONDAS; i += 1) {
        const m = await mundo();
        const sesion = await abrir(m);
        const ingresado = await ingreso(m, sesion);
        const movimientoId = ingresado.ok ? ingresado.valor.movimientoId : "";
        const anular = () =>
          casos().anularMovimientoDeCaja(ctxEn(m, 1, 20), {
            claveDeIdempotencia: claveNueva(),
            movimientoId,
            motivo: "Me equivoqué",
          });
        const rs = await aLaVez([anular, anular]);
        expect(
          rs.filter((r) => r.ok),
          JSON.stringify(resumen(rs)),
        ).toHaveLength(1);
        expect(rs.find((r) => !r.ok)).toEqual({ ok: false, error: "MOVIMIENTO_YA_ANULADO" });
        expect(
          await contar("select count(*) as n from movimiento_caja where anula_a = $1", [
            movimientoId,
          ]),
        ).toBe(1);
        expect(await auditorias(m, "MOVIMIENTO_ANULADO")).toBe(1);
        const [esperado] = await filas<{ e: string }>(
          "select sum(importe)::text as e from movimiento_caja where sesion_id = $1",
          [sesion],
        );
        expect(esperado?.e).toBe("1000.00");
      }
    });

    it("dos anulaciones del mismo movimiento con la MISMA clave a la vez: una anulación, la otra yaExistia", async () => {
      for (let i = 0; i < RONDAS; i += 1) {
        const m = await mundo();
        const sesion = await abrir(m);
        const ingresado = await ingreso(m, sesion);
        const entrada = {
          claveDeIdempotencia: claveNueva(),
          movimientoId: ingresado.ok ? ingresado.valor.movimientoId : "",
          motivo: "Me equivoqué",
        };
        const rs = await aLaVez([
          () => casos().anularMovimientoDeCaja(ctxEn(m, 1, 20), entrada),
          () => casos().anularMovimientoDeCaja(ctxEn(m, 1, 20), entrada),
        ]);
        expect(
          rs.every((r) => r.ok),
          JSON.stringify(resumen(rs)),
        ).toBe(true);
        expect(rs.map((r) => (r.ok ? r.valor.yaExistia : null)).sort()).toEqual([false, true]);
        expect(await auditorias(m, "MOVIMIENTO_ANULADO")).toBe(1);
      }
    });
  });

  it("las consultas durante las escrituras no fallan ni escriben (read committed, solo lectura)", async () => {
    const m = await mundo();
    const sesion = await abrir(m);
    const rs = await aLaVez([
      () => ingreso(m, sesion),
      () => ingreso(m, sesion),
      async () => consultas().resumenDeSesion(ctxEn(m, 1, 30), { sesionId: sesion }),
      async () => consultas().movimientosDeSesion(ctxEn(m, 1, 30), { sesionId: sesion }),
    ]);
    expect(
      rs.every((r) => r.ok),
      JSON.stringify(resumen(rs)),
    ).toBe(true);
  });
});
